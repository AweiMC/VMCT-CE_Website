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
import html as html_mod
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

# Upstream keeps template/dev notes next to real entries. They are not archive
# records: `modpacks/example.md` is the page-template demo, and the per-pack
# `*/secret.md` notes are config scribbles whose body is a raw GitHub blob URL.
SKIP_RELS = {"modpacks/example.md"}


def skip_rel(rel: str) -> bool:
    return rel in SKIP_RELS or rel.endswith("/secret.md")


TAG_STRIP_RE = re.compile(r"<[^>]+>")
# placeholder captions are chrome, not prose ("IMG // BODY-01", "NO SIGNAL")
PLACEHOLDER_RE = re.compile(r"<span class=\"img-slot-mark\">.*?</span>", re.S)


def plain_text(html_text: str) -> str:
    """Searchable plain text of an article: tags out, entities decoded and
    whitespace collapsed. Stored in the index so full-text search never needs
    the (lazily loaded) article HTML."""
    if not html_text:
        return ""
    text = PLACEHOLDER_RE.sub(" ", html_text)
    text = TAG_STRIP_RE.sub(" ", text)
    text = html_mod.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


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


def build_body_slots(body_html, item_slug, site_root, repo_root):
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
            # Repo-owned asset: copy locally (part of the upstream source, no
            # extra download) so the site stays self-contained for these.
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
            # Remote image: keep ONLY the sizing hint + original URL. The image
            # bytes are served by the upstream site on demand (remote state),
            # so no bandwidth or disk is spent caching whole files at build.
            target_rel = src
            source = src

        if target_rel and str(target_rel).startswith("http"):
            statev = "remote"   # served by upstream site; no local bytes cached
        else:
            statev = "ready" if ready else "pending"
        slot = {
            "slot": sid,
            "role": "body",
            "target": target_rel,
            "source": source,
            "alt": alt,
            "state": statev,
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


def clean_body(raw, site_root, repo_root, item_slug):
    body = raw or ""
    body = COMPONENT_RE.sub(lambda m: DOWNLOAD_SLOT if m.group(1).lower() == "downloadlinks" else "", body)
    body = convert_admonions(body)
    body = re.sub(r"!\[([^\]]*?)\s*=\s*\d+x([^\]]*)\]", r"![\1\2]", body)
    body = re.sub(r"\{\{[^}]*\}\}", "", body)
    body_html = markdown.markdown(body, extensions=["extra", "sane_lists", "toc", "tables"])
    body_html, slots = build_body_slots(body_html, item_slug, site_root, repo_root)
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


def dedupe_downloads(dl_list):
    """Seeds sometimes repeat one mirror (a bare `link` copy of an earlier
    lanzou entry pointing at the same file). Keep one entry per destination
    and fold any extra mirror (quark) into the entry that stays, so the
    detail page never renders the same button twice."""
    out, index = [], {}
    for d in dl_list:
        if not isinstance(d, dict):
            continue
        primary = str(d.get("link") or d.get("lanzouLink") or "")
        quark = str(d.get("quarkLink") or "")
        if primary and primary in index:
            kept = index[primary]
            if quark and not kept.get("quarkLink"):
                kept["quarkLink"] = quark
            continue
        if not primary and quark and quark in index:
            continue
        if primary:
            index[primary] = d
        if quark:
            index.setdefault(quark, d)
        out.append(d)
    return out


# Covers ship from upstream at full size (up to 2 MB each) but the UI paints
# them in a 68 px list box or a grid card. Downscaling + re-encoding is the
# single biggest bandwidth win: 12 MB of covers becomes well under 1 MB.
# Idempotent — files already inside the cap are skipped, so a repeated sync
# only pays for newly downloaded originals.
ICON_MAX_PX = 512
IMG_MAX_PX = 1600
IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif", ".webp")

try:
    from PIL import Image as _PILImage
    from PIL import ImageFile as _PILImageFile
except Exception:                                     # pillow is optional
    _PILImage = None
    _PILImageFile = None


def _fit(im, cap):
    w, h = im.size
    longest = max(w, h)
    if longest <= cap:
        return im
    s = cap / longest
    return im.resize((max(1, round(w * s)), max(1, round(h * s))), _PILImage.LANCZOS)


def optimize_images(items, site_root: Path, quality=82):
    """Re-encode cached covers + article images as WebP and downscale them to the
    size the UI actually paints. Upstream ships 512 px RGBA PNGs (300-400 KB of
    photo content in a format that cannot compress photos) and even 2 MB GIFs;
    the same picture as WebP lands at 20-60 KB. Referenced paths are rewritten
    in memory before the dataset is serialised, so the output stays valid.
    """
    if _PILImage is None:
        print("pillow not installed: images left unoptimized (pip install pillow)")
        return
    _PILImage.MAX_IMAGE_PIXELS = 40_000_000
    _PILImageFile.LOAD_TRUNCATED_IMAGES = True
    changes, saved = {}, 0
    for folder, cap in (("icons", ICON_MAX_PX), ("imgs", IMG_MAX_PX)):
        base = site_root / "assets" / folder
        if not base.exists():
            continue
        for src in sorted(base.rglob("*")):
            if not src.is_file() or src.suffix.lower() not in IMAGE_SUFFIXES:
                continue
            dst = src if src.suffix.lower() == ".webp" else src.with_suffix(".webp")
            tmp = src.with_name(src.stem + "__opt.webp")
            before = src.stat().st_size
            try:
                with _PILImage.open(src) as im:
                    # files we produced are already webp and inside the cap:
                    # never recompress them lossily on the next sync
                    if src.suffix.lower() == ".webp" and max(im.size) <= cap:
                        continue
                    if getattr(im, "is_animated", False):
                        frames, durations = [], []
                        for i in range(getattr(im, "n_frames", 1)):
                            im.seek(i)
                            frames.append(_fit(im.convert("RGBA"), cap))
                            durations.append(int(im.info.get("duration") or 80))
                        frames[0].save(tmp, format="WEBP", save_all=True,
                                       append_images=frames[1:], duration=durations,
                                       loop=int(im.info.get("loop") or 0),
                                       quality=70, method=4)
                    else:
                        _fit(im, cap).save(tmp, format="WEBP", quality=quality, method=6)
                if tmp.exists() and tmp.stat().st_size < before:
                    after = tmp.stat().st_size
                    tmp.replace(dst)
                    if dst != src:
                        src.unlink()
                    saved += before - after
                    if src != dst:
                        changes[src.relative_to(site_root).as_posix()] = \
                            dst.relative_to(site_root).as_posix()
                elif tmp.exists():
                    tmp.unlink()
            except Exception as exc:
                if tmp.exists():
                    tmp.unlink()
                print("  skipped", src.name, "-", exc)

    if changes:
        def fix(value):
            return changes.get(value, value) if isinstance(value, str) else value

        for item in items:
            item["icon"] = fix(item.get("icon"))
            for slot in item.get("media", []):
                if slot.get("target"):
                    slot["target"] = fix(slot["target"])
            body = item.get("bodyHtml") or ""
            for old, new in changes.items():
                if old in body:
                    body = body.replace(old, new)
            item["bodyHtml"] = body
    print("images optimized: saved %.1f MB, %d files converted" % (saved / 1_048_576, len(changes)))


def build(repo_root: Path, site_root: Path, source_url: str, do_icons: bool, do_optimize: bool = True):
    downloads = read_downloads(repo_root)
    pages_root = repo_root / "src" / "pages"

    items = []
    md_files = sorted(pages_root.rglob("*.md"))
    for path in md_files:
        rel = path.relative_to(pages_root).as_posix()
        if rel.startswith("admin/") or skip_rel(rel):
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
        body_html, body_slots = clean_body(body, site_root, repo_root, item_slug)
        media = [cover] + body_slots
        dl_list = dedupe_downloads(downloads.get(item_slug, []))
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
        # child pages (fc5-wiki chapters) get a parent pointer
        if "/" in item_slug:
            item["parent"] = item_slug.rsplit("/", 1)[0]
        items.append(item)

    items.sort(key=lambda x: (x["kind"], x["title"]))

    if do_icons:
        # cache remote icons BEFORE serializing so rewritten paths land in output
        cache_remote_icons(items, site_root / "assets" / "icons")
    if do_optimize:
        # shrink the cached bytes to what the UI actually paints
        optimize_images(items, site_root)

    # Split the payload: lists and search need metadata, an excerpt and the
    # searchable text; the full article HTML ships as one small file per entry
    # and is fetched when its detail page opens. Nobody reads 100 pages, so
    # there is no reason to hand the browser all of them up front.
    bodies_dir = site_root / "data" / "bodies"
    if bodies_dir.exists():
        shutil.rmtree(bodies_dir)
    bodies_dir.mkdir(parents=True, exist_ok=True)
    body_bytes = 0
    for item in items:
        body_html = item.pop("bodyHtml", "")
        item["media"] = [m for m in item.get("media", []) if m.get("role") == "cover"]
        text = plain_text(body_html)
        item["searchText"] = text
        item["excerpt"] = item["description"] or (text[:160] + ("…" if len(text) > 160 else ""))
        target = bodies_dir / (item["id"].replace("/", "__") + ".js")
        target.write_text(
            "window.VMCT_BODY=window.VMCT_BODY||{};window.VMCT_BODY[" +
            json.dumps(item["id"], ensure_ascii=False) + "]=" +
            json.dumps(body_html, ensure_ascii=False) + ";\n",
            encoding="utf-8",
        )
        body_bytes += target.stat().st_size
    print("bodies:", len(items), "files,", round(body_bytes / 1024, 1), "KB")

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
        # already converted to webp by the image optimizer: reuse, don't refetch
        webp = target.with_suffix(".webp")
        if webp.exists() and webp.stat().st_size > 0:
            item["icon"] = "assets/icons/" + webp.name
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
    ap.add_argument("--no-optimize", action="store_true", help="skip downscaling cached images")
    args = ap.parse_args()
    # Body images are never downloaded: only sizing hints + upstream URLs are
    # recorded; the browser loads them from the original site on demand.
    build(Path(args.repo).resolve(), Path(args.site).resolve(), args.source_url,
          not args.no_icons, not args.no_optimize)


if __name__ == "__main__":
    main()
