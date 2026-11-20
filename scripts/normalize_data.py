#!/usr/bin/env python3
"""Normalize the upstream wiki repository into a single static dataset.

Reads : repo/ (a checkout of the source repository)
Writes: site/data/catalog.json  + site/data/catalog.js
        site/assets/imgs/       (local images copied from repo/public/imgs)
        site/assets/icons/      (cached remote icons, best-effort)

Only repository-relative paths are recorded in the output. No absolute paths,
no author/agent metadata of the machine running this script is ever emitted.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import markdown
import yaml

LINK_DEFAULTS = {
    "i18n": "https://cdn.modrinth.com/data/PWERr14M/versions/4ihDUjWs/I18nUpdateMod-3.7.0-all.jar",
    "i18nupdate": "https://cdn.modrinth.com/data/PWERr14M/versions/4ihDUjWs/I18nUpdateMod-3.7.0-all.jar",
}

LINK_LABELS = {
    "bilibili": "B 站介绍",
    "github": "GitHub",
    "paratranz": "ParaTranz",
    "modrinth": "Modrinth",
    "curseforge": "CurseForge",
    "planetminecraft": "PlanetMinecraft",
    "minecraftmaps": "MinecraftMaps",
    "i18n": "I18nUpdateMod",
    "wiki": "资料页",
    "xisumavoid": "原作者",
    "gitee": "Gitee",
    "discord": "Discord",
    "qq": "QQ 群",
}

STATUS_LABELS = {
    "maintaining": "维护中",
    "translating": "翻译中",
    "stopped": "已完结",
}

LOADER_LABELS = {
    "forge": "Forge",
    "fabric": "Fabric",
    "neoforge": "NeoForge",
    "vanilla": "原版",
}

COMPONENT_RE = re.compile(r"<\s*/?\s*(DownloadLayout|DocLayout|DownloadLinks|DocSupport|DonateLayout|JoinGroupCard)[^>]*>", re.I)
DOWNLOAD_SLOT = "\n\n<!--DOWNLOAD_SLOT-->\n\n"

# image placeholder slots. A slot always carries: where it goes (slot id),
# what should replace it (target/source), how big it is (w/h) and sync state.
IMG_TAG_RE = re.compile(r'<img\s+([^>]*?)/?>', re.I)
ATTR_RE = re.compile(r'([\w-]+)\s*=\s*"([^"]*)"')
DEFAULT_BODY_RATIO = (16, 9)   # fallback aspect when source has no size hint
COVER_RATIO = (4, 3)


def parse_date(raw):
    if not raw:
        return None
    raw = str(raw).strip()
    if raw in ("待定", "TBD", "-", "—"):
        return None
    m = re.match(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", raw)
    if m:
        return "%04d-%02d-%02d" % (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return raw


def split_frontmatter(text):
    if not text.startswith("---"):
        return {}, text
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text
    try:
        meta = yaml.safe_load(parts[1]) or {}
    except Exception:
        meta = {}
    return meta, parts[2].strip()


def localize_path(value, repo_root, site_root):
    """Copy a repo-relative image into site assets; return a site-relative URL."""
    if not value:
        return value
    value = str(value)
    if value.startswith("/imgs/"):
        rel = value[1:]
        src = repo_root / "public" / rel
        dst = site_root / "assets" / rel
        if src.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            if not dst.exists() or dst.stat().st_size != src.stat().st_size:
                shutil.copy2(src, dst)
        return "assets/" + rel
    return value


def normalize_links(meta, extra_links=None):
    out = []
    seen = set()
    raw = list(meta.get("links") or []) + list(extra_links or [])
    for item in raw:
        if not isinstance(item, dict):
            continue
        lid = str(item.get("id") or "").strip().lower()
        if not lid or lid in seen:
            continue
        url = (item.get("link") or "").strip()
        if not url and lid in LINK_DEFAULTS:
            url = LINK_DEFAULTS[lid]
        project = item.get("project")
        if not url and lid == "paratranz" and project:
            url = "https://paratranz.cn/projects/%s" % project
        if not url:
            continue
        seen.add(lid)
        out.append({
            "id": lid,
            "label": str(item.get("text") or LINK_LABELS.get(lid, lid)),
            "url": url,
        })
    return out


def convert_admonions(md_text):
    """Convert ::: info/warning/details blocks into HTML divs."""
    pattern = re.compile(r"^:::\s*(\w+)(?:\s+(.*))?\s*$(.*?)^:::\s*$", re.M | re.S)

    def repl(m):
        kind = m.group(1).lower()
        title = (m.group(2) or "").strip() or kind.upper()
        inner = m.group(3).strip()
        inner_html = markdown.markdown(inner, extensions=["extra", "sane_lists", "toc"])
        if kind == "details":
            return '<details class="admonition admonition-%s"><summary>%s</summary><div class="admonition-body">%s</div></details>' % (kind, title, inner_html)
        return '<div class="admonition admonition-%s"><div class="admonition-title">%s</div><div class="admonition-body">%s</div></div>' % (kind, title, inner_html)

    prev = None
    while prev != md_text:
        prev = md_text
        md_text = pattern.sub(repl, md_text)
    return md_text


def _cache_image(src, target, proxies=True):
    """Best-effort download of a remote image into site assets. Returns bool."""
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and target.stat().st_size > 256:
            return True
        req = urllib.request.Request(src, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = resp.read(3_000_000)
        if len(data) > 256:
            target.write_bytes(data)
            return True
    except Exception:
        pass
    return False


def _ext_of(url):
    m = re.search(r"\.(png|jpe?g|webp|gif|ico|svg)(?:\?|$)", url, re.I)
    return "." + m.group(1).lower() if m else ".img"


def build_body_slots(body_html, item_slug, site_root, repo_root, do_cache):
    """Rewrite <img> tags into placeholder figures and return (html, slots).

    Each slot records slot-id, local target, original source, aspect ratio and
    a sync state so a later SYNC can fill it without touching layout.
    """
    slots = []
    counter = [0]

    def repl(m):
        attrs = dict(ATTR_RE.findall(m.group(1)))
        src = attrs.get("src", "")
        if not src:
            return m.group(0)
        counter[0] += 1
        sid = "body-%02d" % counter[0]
        alt = attrs.get("alt", "")
        # size hint from "=400x" captions already stripped; use alt digits if any
        mw = re.search(r"(\d{2,4})", alt)
        w = int(mw.group(1)) if mw else DEFAULT_BODY_RATIO[0] * 40
        h = DEFAULT_BODY_RATIO[1] * 40
        target_rel, source = None, src
        ready = False

        if src.startswith("/imgs/"):
            rel = src[1:]
            src_file = repo_root / "public" / rel
            dst = site_root / "assets" / rel
            if src_file.exists():
                dst.parent.mkdir(parents=True, exist_ok=True)
                if not dst.exists() or dst.stat().st_size != src_file.stat().st_size:
                    shutil.copy2(src_file, dst)
                target_rel = "assets/" + rel
                ready = True
        elif src.startswith("http"):
            ext = _ext_of(src)
            target_rel = "assets/media/%s__%s%s" % (item_slug.replace("/", "__"), sid, ext)
            if do_cache:
                ready = _cache_image(src, site_root / target_rel)

        slot = {
            "slot": sid,
            "role": "body",
            "target": target_rel,
            "source": source,
            "alt": alt,
            "state": "ready" if ready else "pending",
            "w": w, "h": h,
        }
        slots.append(slot)
        # placeholder figure: fixed ratio box; renderer fills when state=ready
        return ('<figure class="img-slot" data-img-slot="%s" data-img-state="%s" '
                'data-img-target="%s" data-img-source="%s" style="--slot-w:%d;--slot-h:%d"'
                '><span class="img-slot-mark">IMG // %s</span></figure>'
                % (sid, slot["state"], target_rel or "", source, w, h, sid.upper()))

    html = IMG_TAG_RE.sub(repl, body_html)
    return html, slots


def clean_body(raw, site_root, repo_root, item_slug, do_cache=True):
    body = raw or ""
    body = COMPONENT_RE.sub(lambda m: DOWNLOAD_SLOT if m.group(1).lower() == "downloadlinks" else "", body)
    body = convert_admonions(body)
    body = re.sub(r"!\[([^\]]*?)\s*=\s*\d+x([^\]]*)\]", r"![\1\2]", body)
    body = re.sub(r"\{\{[^}]*\}\}", "", body)
    body_html = markdown.markdown(body, extensions=["extra", "sane_lists", "toc", "tables"])
    body_html, slots = build_body_slots(body_html, item_slug, site_root, repo_root, do_cache)
    return body_html.strip(), slots


def infer_kind(rel):
    if rel.startswith("modpacks/fc5-wiki/"):
        return "wiki"
    if rel.startswith("modpacks/"):
        return "modpack"
    if rel.startswith("map/"):
        return "map"
    return "page"


def title_from_slug(slug):
    s = slug.split("/")[-1].replace("-", " ").replace("_", " ")
    return s[:1].upper() + s[1:] if s else slug


def collect_credits(repo_root):
    out = []
    base = repo_root / "src" / "components" / "Credit"
    labels = {"staff-web.json": "站点开发", "staff-vm.json": "VM 汉化组", "staff-community.json": "社区贡献"}
    for name, label in labels.items():
        path = base / name
        if not path.exists():
            continue
        try:
            people = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            people = []
        for p in people:
            out.append({
                "group": label,
                "name": p.get("name", ""),
                "title": p.get("title", ""),
                "uid": p.get("uid"),
            })
    return out


def read_downloads(repo_root):
    path = repo_root / "database" / "download-seeds.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def build(repo_root: Path, site_root: Path, source_url: str, do_icons: bool, do_cache: bool = True):
    downloads = read_downloads(repo_root)
    pages_root = repo_root / "src" / "pages"

    items = []
    md_files = sorted(pages_root.rglob("*.md"))
    for path in md_files:
        rel = path.relative_to(pages_root).as_posix()
        if rel.startswith("admin/"):
            continue
        text = path.read_text(encoding="utf-8")
        meta, body = split_frontmatter(text)
        slug = rel[:-3]
        kind = infer_kind(rel)
        is_index = slug.endswith("/index")
        item_slug = slug[:-6] if is_index else slug

        compat = meta.get("compatibility") or {}
        status = meta.get("status") or {}
        if isinstance(status, dict):
            status_type = str(status.get("type") or "").lower()
        else:
            status_type = str(status or "").lower()

        icon = localize_path(meta.get("icon"), repo_root, site_root)
        # cover slot — always present so the layout never shifts after SYNC
        cover_source = str(meta.get("icon") or "") if icon else ""
        cover_target = icon if str(icon).startswith("assets/") else None
        cover = {
            "slot": "cover", "role": "cover",
            "target": cover_target, "source": cover_source,
            "alt": str(meta.get("title") or ""),
            "state": "ready" if icon else "pending",
            "w": COVER_RATIO[0] * 100, "h": COVER_RATIO[1] * 100,
        }
        body_html, body_slots = clean_body(body, site_root, repo_root, item_slug, do_cache)
        media = [cover] + body_slots
        dl_list = downloads.get(item_slug, [])
        for dl in dl_list:
            if isinstance(dl, dict) and dl.get("icon"):
                dl["icon"] = localize_path(dl["icon"], repo_root, site_root)
        item = {
            "id": item_slug,
            "kind": kind,
            "slug": item_slug.split("/")[-1],
            "title": str(meta.get("title") or title_from_slug(item_slug)).strip(),
            "originalName": str(meta.get("originalName") or "").strip(),
            "description": str(meta.get("description") or "").strip().replace("\n", " "),
            "icon": icon,
            "updateDate": parse_date(meta.get("updateDate")),
            "updateDateRaw": str(meta.get("updateDate") or ""),
            "status": status_type,
            "statusLabel": STATUS_LABELS.get(status_type, status_type or "未标注"),
            "loader": str(compat.get("loader") or "").lower(),
            "loaderLabel": LOADER_LABELS.get(str(compat.get("loader") or "").lower(), str(compat.get("loader") or "")),
            "minecraft": str(compat.get("minecraft") or ""),
            "packVersion": str(compat.get("pack") or ""),
            "authors": [str(a) for a in (meta.get("authors") or [])],
            "links": normalize_links(meta),
            "downloads": dl_list,
            "featured": bool(meta.get("featured")),
            "sidebar": meta.get("sidebar", True) is not False,
            "path": "src/pages/" + rel,
            "media": media,
            "bodyHtml": body_html,
        }
        # child pages (fc5-wiki, sb4/secret, rad/secret) get a parent pointer
        if "/" in item_slug:
            item["parent"] = item_slug.rsplit("/", 1)[0]
        items.append(item)

    items.sort(key=lambda x: (x["kind"], x["title"]))

    if do_icons:
        # cache remote icons BEFORE serializing so rewritten paths land in output
        cache_remote_icons(items, site_root / "assets" / "icons")

    nav = [
        {"id": "modpacks", "label": "整合包", "kind": "modpack"},
        {"id": "map", "label": "地图", "kind": "map"},
        {"id": "wiki", "label": "资料库", "kind": "wiki"},
        {"id": "credits", "label": "致谢", "kind": "credits"},
        {"id": "community", "label": "社区", "kind": "page"},
    ]

    dataset = {
        "schema": 1,
        "meta": {
            "title": "VM 中文翻译组 · 社区资料站",
            "source": source_url,
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "counts": {
                "modpack": sum(1 for i in items if i["kind"] == "modpack"),
                "map": sum(1 for i in items if i["kind"] == "map"),
                "wiki": sum(1 for i in items if i["kind"] == "wiki"),
                "page": sum(1 for i in items if i["kind"] == "page"),
                "total": len(items),
            },
        },
        "nav": nav,
        "statusLabels": STATUS_LABELS,
        "loaderLabels": LOADER_LABELS,
        "items": items,
        "credits": collect_credits(repo_root),
    }

    out_json = site_root / "data" / "catalog.json"
    out_js = site_root / "data" / "catalog.js"
    out_json.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(dataset, ensure_ascii=False, separators=(",", ":"))
    out_json.write_text(json.dumps(dataset, ensure_ascii=False, indent=2), encoding="utf-8")
    out_js.write_text("window.VMCT_DATA=" + payload + ";\n", encoding="utf-8")

    print("items:", len(items))
    print("counts:", dataset["meta"]["counts"])
    print("json KB:", round(out_json.stat().st_size / 1024, 1))
    print("js   KB:", round(out_js.stat().st_size / 1024, 1))
    return dataset


def cache_remote_icons(items, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    seen = set()
    for item in items:
        url = item.get("icon")
        if not url or not str(url).startswith("http") or url in seen:
            continue
        seen.add(url)
        ext = ".png"
        m = re.search(r"\.(png|jpe?g|webp|gif|ico)(?:\?|$)", url, re.I)
        if m:
            ext = "." + m.group(1).lower()
        target = out_dir / (item["id"].replace("/", "__") + ext)
        if target.exists() and target.stat().st_size > 0:
            item["icon"] = "assets/icons/" + target.name
            continue
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=12) as resp:
                data = resp.read(2_000_000)
            if len(data) > 256:
                target.write_bytes(data)
                item["icon"] = "assets/icons/" + target.name
        except Exception:
            pass
    # keep the cover slot in sync with the final (possibly cached) icon path
    for item in items:
        icon = item.get("icon")
        for slot in item.get("media", []):
            if slot.get("role") == "cover":
                if icon and str(icon).startswith("assets/"):
                    slot["target"] = icon
                    slot["state"] = "ready"
                else:
                    slot["target"] = None
                    slot["state"] = "pending"
    print("icons cached:", len([i for i in items if str(i.get("icon", "")).startswith("assets/icons/")]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True, help="path to source repository checkout")
    ap.add_argument("--site", required=True, help="path to static site directory")
    ap.add_argument("--source-url", default="https://github.com/VM-Chinese-translate-group/vmct-website-v4")
    ap.add_argument("--no-icons", action="store_true", help="skip caching cover icons")
    ap.add_argument("--no-cache", action="store_true", help="skip caching body images (leave slots pending)")
    args = ap.parse_args()
    build(Path(args.repo).resolve(), Path(args.site).resolve(), args.source_url, not args.no_icons, not args.no_cache)


if __name__ == "__main__":
    main()
