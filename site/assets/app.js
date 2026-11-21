/* ==========================================================================
   VMCT Community Archive — application / router / renderers
   ========================================================================== */
(function () {
  'use strict';
  var DATA = window.VMCT_DATA;
  var ICONS = window.LOADER_ICONS || {};
  var M = window.VMMotion;
  var main = document.getElementById('main');
  var searchEl = document.getElementById('globalSearch');
  var lastKind = null; // last rendered non-detail view; drives cross-view filter reset
  var PAGE_SIZES = [12, 24, 48, 96];
  var savedPageSize = 24;
  try {
    var storedSize = parseInt(localStorage.getItem('vmct.pageSize'), 10);
    if (PAGE_SIZES.indexOf(storedSize) >= 0) savedPageSize = storedSize;
  } catch (e) { /* private mode / storage disabled: keep the default */ }
  var state = {
    kind: 'home',
    q: '',
    loader: null,
    status: null,
    version: null,
    sort: 'updated',
    view: 'list',
    page: 1,
    pageSize: savedPageSize
  };

  var MOBILE_Q = '(max-width: 860px)';
  function isMobile() {
    return !!(window.matchMedia && window.matchMedia(MOBILE_Q).matches);
  }

  var KIND_META = {
    modpack: { label: '整合包', num: '01', desc: '经过汉化的 Minecraft 整合包档案' },    map: { label: '地图', num: '02', desc: '汉化地图与冒险存档档案' },
    wiki: { label: '资料库', num: '03', desc: '整合包配套资料与攻略文档' },
    credits: { label: '致谢', num: '04', desc: '贡献者与社区成员名录' },
    page: { label: '其他', num: '05', desc: '社区公告与说明文档' }
  };

  function esc(s) {    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /* ---------- Marathon UI glyphs --------------------------------------
     Inline SVG only: square caps, mitred joins, 16px box — the same geometry
     language as .mar-cross / .mar-corner. UI chrome never uses font glyphs
     (↗ → ← ◷ ✕ ↤ ▾), which render differently on every platform. */
  function gi(body) {
    return '<svg class="gi" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"' +
      ' stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false">' + body + '</svg>';
  }
  var GI = {
    arrowUR: gi('<path d="M4.5 11.5 11.5 4.5"/><path d="M5.5 4.5h6v6"/>'),
    arrowR:  gi('<path d="M2.5 8h11"/><path d="M10 4.5 13.5 8 10 11.5"/>'),
    arrowL:  gi('<path d="M13.5 8h-11"/><path d="M6 4.5 2.5 8 6 11.5"/>'),
    clock:   gi('<circle cx="8" cy="8" r="5.5"/><path d="M8 4.5V8h3.2"/>'),
    close:   gi('<path d="M4 4l8 8M12 4 4 12"/>'),
    download: gi('<path d="M8 2.5v7.5"/><path d="M4.5 7 8 10.5 11.5 7"/><path d="M3 13.5h10"/>'),
    plus:    gi('<path d="M8 3.5v9M3.5 8h9"/>'),
    chevron: gi('<path d="M3.5 6 8 10.5 12.5 6"/>'),
    // reticle search: circle + crosshair + handle, one glyph used in both
    // the top bar (index.html) and the list toolbar
    search:  gi('<circle cx="7" cy="7" r="5"/><path d="M7 4.2v5.6M4.2 7h5.6"/><path d="M10.9 10.9 14.5 14.5"/>')
  };

  // Search is metadata-only: title, original name, description, excerpt and
  // authors — all of which already ship in the index. Article text is lazily
  // loaded and never indexed, which is why no separate search payload exists.
  function excerptOf(it, max) {
    if (it.description) return it.description;
    if (it.excerpt) return it.excerpt;
    return '';
  }
  function searchHaystack(it) {
    return [it.title, it.originalName, it.description, it.excerpt,
      (it.authors || []).join(' '), loaderText(it), statusText(it),
      it.minecraft, it.packVersion].join(' ').toLowerCase();
  }
  function loaderSvg(loader) {
    var raw = ICONS[loader];
    return raw ? '<span class="loader-ico" title="' + esc(loader) + '">' + raw + '</span>' : '';
  }
  // A media slot reserves a fixed-ratio box up front. The renderer never
  // changes the box size — a later SYNC only swaps the image source/target.
  function mediaSlot(slot, variant) {
    slot = slot || { slot: 'cover', target: null, source: '', state: 'pending', alt: '', w: 400, h: 300 };
    var isRemote = slot.state === 'remote' && (slot.target || slot.source);
    var isReady = slot.state === 'ready' && slot.target;
    var hasImage = isReady || isRemote;
    var imageUrl = isReady ? slot.target : (isRemote ? (slot.target || slot.source) : '');
    // A real <img> rather than a CSS background: backgrounds cannot be lazily
    // loaded, so one list paint used to pull every cover (12 MB of upstream
    // originals). Native lazy loading fetches only what enters the viewport.
    var img = hasImage
      ? '<img class="media-slot-img" src="' + esc(imageUrl) + '" alt="' + esc(slot.alt || '') + '" loading="lazy" decoding="async">'
      : '';
    var cls = 'media-slot ' + (variant === 'cover' ? 'media-slot-cover' : 'media-slot-body') +
      (hasImage ? ' is-ready' : ' is-pending');
    var label = hasImage ? '' : '<span class="media-slot-mark">NO SIGNAL<br><small>IMG // ' + esc(slot.slot.toUpperCase()) + '</small></span>';
    return '<div class="' + cls + '" data-img-slot="' + esc(slot.slot) + '" data-img-state="' + slot.state + '"' +
      ' data-img-target="' + esc(slot.target || '') + '" data-img-source="' + esc(slot.source || '') + '"' +
      ' role="img" aria-label="' + esc(slot.alt || slot.slot) + '">' + img + label + '</div>';
  }
  function coverOf(item) {
    // Derived, not shipped: the cover is just the icon file. Remote icons are
    // shown straight from the source URL; no file means a pending plate.
    var icon = item.icon || '';
    if (!icon) return { role: 'cover', slot: 'cover', state: 'pending', target: null, source: '', alt: item.title || '' };
    if (icon.indexOf('http') === 0) return { role: 'cover', slot: 'cover', state: 'remote', target: icon, source: icon, alt: item.title || '' };
    return { role: 'cover', slot: 'cover', state: 'ready', target: icon, source: '', alt: item.title || '' };
  }
  function statusText(it) { return (DATA.statusLabels || {})[it.status] || it.status || ''; }
  function loaderText(it) { return (DATA.loaderLabels || {})[it.loader] || it.loader || ''; }
  // Hydrate placeholder figures emitted by the normalizer into fixed-ratio
  // media boxes. Boxes are sized by CSS var(--slot-w/h); only the fill changes.
  function hydrateMedia() {
    main.querySelectorAll('figure.img-slot').forEach(function (fig) {
      var target = fig.getAttribute('data-img-target') || '';
      var statev = fig.getAttribute('data-img-state');
      var source = fig.getAttribute('data-img-source') || '';
      // remote: upstream URL is shown directly (no local bytes); ready: local file
      var isRemote = statev === 'remote' && (target || source);
      var isReady = statev === 'ready' && target;
      var hasImage = isReady || isRemote;
      var imageUrl = isReady ? target : (isRemote ? (target || source) : '');
      fig.classList.add('media-slot', 'media-slot-body', hasImage ? 'is-ready' : 'is-pending');
      if (hasImage) {
        var stale = fig.querySelector('.img-slot-mark');
        if (stale) stale.remove();
        var img = fig.querySelector('.media-slot-img');
        if (!img) {
          img = document.createElement('img');
          img.className = 'media-slot-img';
          img.loading = 'lazy';
          img.decoding = 'async';
          img.alt = fig.getAttribute('aria-label') || '';
          fig.insertBefore(img, fig.firstChild);
        }
        img.src = imageUrl;
        M.mediaReveal(fig);
      } else {
        var old = fig.querySelector('.img-slot-mark');
        if (old) old.remove();
        var mark = document.createElement('span');
        mark.className = 'media-slot-mark';
        mark.innerHTML = 'NO SIGNAL<br><small>IMG // ' + esc((fig.getAttribute('data-img-slot') || '').toUpperCase()) + '</small>';
        fig.appendChild(mark);
      }
      fig.setAttribute('role', 'img');
      fig.setAttribute('aria-label', fig.querySelector('img') ? fig.querySelector('img').alt : (source || '图片占位'));
    });
  }
  function iconFor(item) {
    var s = coverOf(item);
    if (!s || !((s.state === 'ready' && s.target) || (s.state === 'remote' && (s.target || s.source)))) return '';
    var slot = mediaSlot(s, 'cover');
    // keep the card-icon class so existing hover rules keep working
    return slot.replace('class="media-slot ', 'class="card-icon media-slot ');
  }
  function allItems() { return DATA.items; }
  function byId(id) { return DATA.items.find(function (x) { return x.id === id; }); }

  // Offsite targets (links/downloads) and the credit roll are not needed to
  // render lists, so they ship as separate payloads and load on demand.
  // Counts (lc/dc) stay in the index so cards show them without the payload.
  var DETAILS = null, detailsState = 'idle';
  var CREDITS = null, creditsState = 'idle';

  function loadSideScript(src, onReady) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = onReady;
    s.onerror = function () {};
    document.head.appendChild(s);
  }
  function ensureDetails() {
    if (DETAILS) return true;
    if (detailsState !== 'idle') return false;
    detailsState = 'loading';
    loadSideScript('data/details.js', function () {
      DETAILS = window.VMCT_DETAILS || {};
      detailsState = 'ready';
      var host = main.querySelector('[data-side-extra]');
      if (host) {
        var it = byId(host.getAttribute('data-side-extra'));
        if (it) host.innerHTML = sideExtraHtml(it);
      }
    });
    return false;
  }
  function ensureCredits() {
    if (CREDITS) return true;
    if (creditsState !== 'idle') return false;
    creditsState = 'loading';
    loadSideScript('data/credits.js', function () {
      CREDITS = window.VMCT_CREDITS || [];
      creditsState = 'ready';
      if (parseHash().kind === 'credits') render();
    });
    return false;
  }
  function detailData(it) {
    return (DETAILS && DETAILS[it.id]) || { links: it.links || [], downloads: it.downloads || [] };
  }
  function linkCount(it) {
    if (typeof it.lc === 'number' || typeof it.dc === 'number') return (it.lc || 0) + (it.dc || 0);
    var d = detailData(it);
    return (d.links || []).length + (d.downloads || []).length;
  }

  /* ---------- tabs ----------------------------------------------------- */
  // Counts live in exactly one place (the hero stat plate). Duplicating them
  // into the nav made every number appear three times on the home screen.
  function renderTabs() {
    var tabs = document.getElementById('tabs');
    var defs = [
      { id: 'home', label: '总览' },
      { id: 'modpack', label: '整合包' },
      { id: 'map', label: '地图' },
      { id: 'wiki', label: '资料库' },
      { id: 'credits', label: '致谢' },
      { id: 'page', label: '其他' }
    ];
    tabs.innerHTML = defs.map(function (d) {
      return '<button class="tab' + (state.kind === d.id ? ' active' : '') + '" data-kind="' + d.id + '">' +
        d.label + '</button>';
    }).join('');
    tabs.querySelectorAll('.tab').forEach(function (b) {
      b.addEventListener('click', function () { navigate('#/' + b.dataset.kind); });
    });
  }

  /* ---------- home ----------------------------------------------------- */
  function viewHome() {
    var c = DATA.meta.counts;
    // Counts are shown once, in the hero stat plate — the module tiles carry
    // only their index so the same numbers never repeat down the page.
    var modules = [
      { kind: 'modpack', t: '整合包', d: '版本 / 加载器 / 状态一目了然的汉化档案。' },
      { kind: 'map', t: '地图', d: '建筑、解谜、角色扮演——汉化地图存档档案。' },
      { kind: 'wiki', t: '资料库', d: '配套攻略、机制说明与词条索引。' },
      { kind: 'credits', t: '致谢', d: '所有让资料得以存在的贡献者。' }
    ];
    var featured = DATA.items.filter(function (i) { return i.featured; }).slice(0, 6);
    return '' +
      '<section class="hero">' +
        '<div class="hero-grid"></div>' +
        '<canvas class="hero-glyph" id="heroGlyph" aria-hidden="true"></canvas>' +
        '<div class="wrap hero-inner">' +
          '<div class="hero-plate"><span class="line"></span><span class="plate">ARCHIVE // 索引终端 04</span></div>' +
          '<h1>COMMUNITY<br><span class="acid">ARCHIVE</span></h1>' +
          '<p class="hero-tagline">VM 中文翻译组 · 整合包 / 地图 / 资料静态镜像</p>' +
          '<div class="hero-meta">' +
            '<div><span class="k">整合包</span><span class="v">' + c.modpack + '</span></div>' +
            '<div><span class="k">地图</span><span class="v">' + c.map + '</span></div>' +
            '<div><span class="k">资料页</span><span class="v">' + c.wiki + '</span></div>' +
            '<div><span class="k">总档案</span><span class="v">' + c.total + '</span></div>' +
          '</div>' +
          '<div class="hero-actions">' +
            '<button class="btn primary" data-goto="modpack">进入整合包索引 <span class="arrow">' + GI.arrowUR + '</span></button>' +
            '<button class="btn" data-goto="map">浏览地图档案 <span class="arrow">' + GI.arrowR + '</span></button>' +
          '</div>' +
        '</div>' +
      '</section>' +
      '<div class="wrap">' +
        '<div class="section-head"><h2>数据模块</h2><span class="idx">SELECT A MODULE</span></div>' +
        '<div class="modules">' + modules.map(function (m, i) {
          return '<div class="module" data-goto="' + m.kind + '"><span class="num">' + String(i + 1).padStart(2, '0') + '</span>' +
            '<span class="go">' + GI.arrowUR + '</span><h3>' + m.t + '</h3><p>' + m.d + '</p></div>';
        }).join('') + '</div>' +
        (featured.length ? '<div class="section-head"><h2>精选档案</h2><span class="idx">FEATURED</span></div>' +
          '<div class="cards grid featured-grid">' + featured.map(cardHtml).join('') + '</div>' : '') +
      '</div>';
  }

  /* ---------- catalog -------------------------------------------------- */
  function itemMatches(it) {
    if (state.q) {
      var q = state.q.toLowerCase();
      if (searchHaystack(it).indexOf(q) < 0) return false;
    }
    if (state.loader && it.loader !== state.loader) return false;
    if (state.status && it.status !== state.status) return false;
    if (state.version && it.minecraft !== state.version) return false;
    return true;
  }
  function sorted(list) {
    var arr = list.slice();
    if (state.sort === 'title') arr.sort(function (a, b) { return a.title.localeCompare(b.title, 'zh'); });
    else if (state.sort === 'status') arr.sort(function (a, b) { return a.status.localeCompare(b.status); });
    else arr.sort(function (a, b) {
      var da = a.updateDate || '0000', db = b.updateDate || '0000';
      return db.localeCompare(da);
    });
    return arr;
  }
  function facetCounts(kindItems, key) {
    var m = {};
    kindItems.forEach(function (i) { var v = i[key] || ''; if (v) m[v] = (m[v] || 0) + 1; });
    return m;
  }
  function optRow(value, label, count, extra, selected, iconHtml) {
    var nameHtml = iconHtml
      ? '<span class="fopt-label">' + iconHtml + '<span class="fname">' + esc(label) + '</span></span>'
      : '<span class="fname">' + esc(label) + '</span>';
    return '<div class="fopt' + (selected ? ' sel' : '') + '" data-facet="' + extra + '" data-value="' + esc(value) + '">' +
      '<span class="box"></span>' + nameHtml +
      '<span class="fcount">' + count + '</span></div>';
  }
  // The rail only exists when there is something to filter on. Kinds whose
  // records carry no compatibility metadata (wiki chapters, community pages)
  // render a plain single-column list instead of an empty sidebar.
  // Filter groups collapse by default on phones: the rail otherwise fills the
  // whole first screen before any card appears.
  function filterGroup(title, plate, body) {
    var collapsed = isMobile();
    return '<div class="filter-group"><h3>' + title +
      '<span class="caret' + (collapsed ? ' up' : '') + '">' + GI.chevron + '</span>' +
      '<span class="plate">' + plate + '</span></h3>' +
      '<div class="filter-body' + (collapsed ? ' collapsed' : '') + '">' + body + '</div></div>';
  }

  function filterRail(kindItems) {
    var versions = facetCounts(kindItems, 'minecraft');
    var loaders = facetCounts(kindItems, 'loader');
    var statuses = facetCounts(kindItems, 'status');
    var groups = [];
    if (Object.keys(versions).length) {
      var verOpts = Object.keys(versions).sort(function (a, b) { return b.localeCompare(a, undefined, { numeric: true }); })
        .slice(0, 12).map(function (v) { return optRow(v, v, versions[v], 'version', state.version === v); }).join('');
      groups.push(filterGroup('游戏版本', 'VERSION',
        '<input class="filter-search" placeholder="搜索版本…" data-filter-search="version">' + verOpts));
    }
    if (Object.keys(loaders).length) {
      var loaderOpts = Object.keys(loaders).sort().map(function (v) {
        var label = DATA.loaderLabels[v] || v;
        var ico = ICONS[v] ? '<span class="fopt-ico">' + ICONS[v] + '</span>' : '';
        return optRow(v, label, loaders[v], 'loader', state.loader === v, ico);
      }).join('');
      groups.push(filterGroup('加载器', 'LOADER', loaderOpts));
    }
    if (Object.keys(statuses).length) {
      var statusOpts = Object.keys(statuses).map(function (v) {
        var lbl = DATA.statusLabels[v] || v;
        return optRow(v, lbl, statuses[v], 'status', state.status === v);
      }).join('');
      groups.push(filterGroup('状态', 'STATUS', statusOpts));
    }
    if (!groups.length) return '';
    return '<aside class="filter-rail">' + groups.join('') +
      '<button class="btn" id="clearFilters" style="justify-content:center"' + (state.loader || state.status || state.version || state.q ? '' : ' hidden') + '>清除筛选 <span class="arrow">' + GI.close + '</span></button>' +
      '</aside>';
  }
  // Only render what the record actually has: a wiki chapter has no status,
  // date or links, and empty placeholders ("未标注" / "待定" / "↗ 0") are noise.
  function cardHtml(it) {
    var tags = '';
    if (it.status) tags += '<span class="tag' + (it.status === 'maintaining' ? ' accent' : '') + (it.status === 'stopped' ? ' stopped' : '') + '">' + esc(statusText(it)) + '</span>';
    if (it.loader) tags += '<span class="tag">' + loaderSvg(it.loader) + esc(loaderText(it)) + '</span>';
    if (it.minecraft) tags += '<span class="tag">MC ' + esc(it.minecraft) + '</span>';
    var meta = '';
    var bits = [];
    if (it.updateDate) bits.push('<span>' + GI.clock + esc(it.updateDate) + '</span>');
    if (linkCount(it)) bits.push('<span>' + GI.arrowUR + linkCount(it) + '</span>');
    if (bits.length) meta = '<div class="card-meta">' + bits.join('') + '</div>';
    var desc = excerptOf(it, 120);
    var cover = iconFor(it);
    return '<article class="card" data-detail="' + esc(it.id) + '">' + cover +
      '<div class="card-body"><div class="card-head"><h3 class="card-title">' + esc(it.title) + '</h3></div>' +
      (it.originalName ? '<div class="card-author">原题 <b>' + esc(it.originalName) + '</b></div>' : '') +
      (desc ? '<p class="card-desc">' + esc(desc) + '</p>' : '') +
      ((tags || meta) ? '<div class="card-foot">' + tags + meta + '</div>' : '') +
      '</div></article>';
  }
  // A wiki entry is a chapter of one upstream document, not a packaged mod:
  // no cover, no status, no date. Render it as a numbered document index —
  // parent page first as the overview, then chapters with a text excerpt.
  function docRow(it, num) {
    var excerpt = excerptOf(it, 160);
    return '<article class="card doc-row" data-detail="' + esc(it.id) + '">' +
      '<span class="doc-num">' + (num || '§') + '</span>' +
      '<div class="card-body"><div class="card-head"><h3 class="card-title">' + esc(it.title) + '</h3></div>' +
      (excerpt ? '<p class="card-desc">' + esc(excerpt) + '</p>' : '') +
      '</div><span class="doc-go" aria-hidden="true">' + GI.arrowUR + '</span></article>';
  }
  // One card per document source: the root page carries its chapters folded
  // inside as jump links. Chapters are never rows of their own — the index
  // stays scannable while every chapter stays one click away, and opening
  // the card itself leads to the source's detail page.
  function docGroupHtml(root, kids) {
    var excerpt = excerptOf(root, 160);
    var chips = kids.map(function (k) {
      return '<a class="kid" href="#/detail/' + encodeURIComponent(k.id) + '">' + esc(k.title) + '</a>';
    }).join('');
    return '<article class="card doc-row doc-group" data-detail="' + esc(root.id) + '">' +
      '<span class="doc-num">§</span>' +
      '<div class="card-body"><div class="card-head"><h3 class="card-title">' + esc(root.title) + '</h3>' +
      (kids.length ? '<span class="doc-count">' + String(kids.length).padStart(2, '0') + ' 章</span>' : '') + '</div>' +
      (excerpt ? '<p class="card-desc">' + esc(excerpt) + '</p>' : '') +
      (kids.length ? '<div class="doc-kids">' + chips + '</div>' : '') +
      '</div><span class="doc-go" aria-hidden="true">' + GI.arrowUR + '</span></article>';
  }
  // `visible` is the filtered list, `universe` every wiki item: a chapter that
  // matches a search still shows its source card even when the root does not.
  function docListHtml(visible, universe) {
    var byId = {}, isRoot = {};
    universe.forEach(function (i) {
      byId[i.id] = i;
      if (i.parent) isRoot[i.parent] = true;
    });
    var emitted = {}, out = [], n = 0;
    visible.forEach(function (i) {
      var kids = visible.filter(function (k) { return k.parent === i.id && k.id !== i.id; });
      if (kids.length) {                       // source with chapters visible
        if (emitted[i.id]) return;
        emitted[i.id] = true;
        out.push(docGroupHtml(i, kids));
        return;
      }
      var p = i.parent && byId[i.parent];
      if (p && p.kind === 'wiki') {            // chapter: fold into its source
        if (emitted[p.id]) return;
        emitted[p.id] = true;
        out.push(docGroupHtml(p, visible.filter(function (k) {
          return k.parent === p.id && k.id !== p.id;
        })));
        return;
      }
      n += 1;                                  // a standalone document
      out.push(docRow(i, isRoot[i.id] ? '§' : String(n).padStart(2, '0')));
    });
    var pg = pageOf(out.length);
    var shown = out.slice(pg.start, pg.start + pg.per);
    return '<div class="cards doc-list">' + shown.join('') + '</div>' +
      pageBar(out.length, pg, shown.length);
  }

  /* ---------- paging ---------------------------------------------------
     Every list shows at most one page of cards; the size is user-selectable
     and remembered. Paging is client-side over the filtered list, so the
     filters and search keep operating on the full set. */
  function pageOf(total) {
    var per = state.pageSize;
    var pages = Math.max(1, Math.ceil(total / per));
    var page = Math.min(Math.max(1, state.page), pages);
    return { page: page, pages: pages, per: per, start: (page - 1) * per };
  }
  function pageBar(total, pg, shown) {
    if (!total) return '';
    var opts = PAGE_SIZES.map(function (n) {
      return '<option value="' + n + '"' + (n === state.pageSize ? ' selected' : '') + '>每页 ' + n + '</option>';
    }).join('');
    return '<div class="page-bar">' +
      '<span class="page-range">' + (pg.start + 1) + '–' + (pg.start + shown) + ' / ' + total + '</span>' +
      '<span class="page-size"><span class="select-wrap"><select id="pageSize" aria-label="每页条数">' + opts + '</select></span></span>' +
      '<div class="page-nav">' +
        '<button class="page-btn" data-page="' + (pg.page - 1) + '"' + (pg.page <= 1 ? ' disabled' : '') + ' aria-label="上一页">' + GI.arrowL + '</button>' +
        '<span class="page-num"><b>' + String(pg.page).padStart(2, '0') + '</b> / ' + String(pg.pages).padStart(2, '0') + '</span>' +
        '<button class="page-btn" data-page="' + (pg.page + 1) + '"' + (pg.page >= pg.pages ? ' disabled' : '') + ' aria-label="下一页">' + GI.arrowR + '</button>' +
      '</div></div>';
  }

  // Render just the cards/empty region of the list column.
  function cardsRegion(kind) {
    var kindItems = allItems().filter(function (i) { return i.kind === kind; });
    // the document index keeps upstream order (root page, then chapters)
    if (kind === 'wiki') {
      var docs = kindItems.filter(itemMatches);
      return '<div class="list-region">' + (docs.length ? docListHtml(docs, kindItems) : emptyRegion()) + '</div>';
    }
    var list = sorted(kindItems.filter(itemMatches));
    if (!list.length) return '<div class="list-region">' + emptyRegion() + '</div>';
    var pg = pageOf(list.length);
    var slice = list.slice(pg.start, pg.start + pg.per);
    var gridCls = state.view === 'grid' ? ' grid' : '';
    return '<div class="list-region">' +
      '<div class="cards' + gridCls + '">' + slice.map(cardHtml).join('') + '</div>' +
      pageBar(list.length, pg, slice.length) + '</div>';
  }
  function emptyRegion() {
    return '<div class="empty"><div class="cross mar-cross"><i class="h"></i><i class="v"></i><i class="d"></i></div><h3>无匹配档案</h3><p>调整筛选条件或清除检索词</p></div>';
  }

  // Scoped refresh: repaint only the list column, keep toolbar/filter rail intact.
  function updateScoped() {
    var kind = state.kind;
    var listCol = main.querySelector('.list-col');
    if (!listCol) { render(); return; }
    var region = listCol.querySelector('.list-region');
    if (region) region.outerHTML = cardsRegion(kind);
    var rl = listCol.querySelector('.result-line');
    var kindItems = allItems().filter(function (i) { return i.kind === kind; });
    var n = sorted(kindItems.filter(itemMatches)).length;
    if (rl) rl.textContent = 'SHOWING ' + n + ' RESULTS';
    var cnt = main.querySelector('.catalog-title .count');
    var meta = KIND_META[kind] || { label: kind, desc: '' };
    if (cnt) cnt.textContent = n + ' / ' + kindItems.length + ' ENTRIES · ' + meta.desc;
    // sync facet highlight without rebuilding the rail
    main.querySelectorAll('.fopt').forEach(function (o) {
      o.classList.toggle('sel', state[o.dataset.facet] === o.dataset.value);
    });
    var clearBtn = document.getElementById('clearFilters');
    if (clearBtn) clearBtn.hidden = !(state.loader || state.status || state.version || state.q);
    bindListRegion();
    bindPaging();
  }

  function viewCatalog(kind) {
    var kindItems = allItems().filter(function (i) { return i.kind === kind; });
    var meta = KIND_META[kind] || { label: kind, num: '--', desc: '' };
    var rail = filterRail(kindItems);
    // Only offer sorts that mean something for this kind: a wiki chapter has
    // neither a date nor a status, so those options would be dead controls.
    // Also heal state.sort when arriving from a kind that had that option.
    var hasDate = kindItems.some(function (i) { return !!i.updateDate; });
    var hasStatus = kindItems.some(function (i) { return !!i.status; });
    if (state.sort === 'status' && !hasStatus) state.sort = hasDate ? 'updated' : 'title';
    if (state.sort === 'updated' && !hasDate) state.sort = 'title';
    var list = sorted(kindItems.filter(itemMatches));
    var sortSel = '';
    if (kind !== 'wiki') {
      var sortOpts = '';
      if (hasDate) sortOpts += '<option value="updated"' + (state.sort === 'updated' ? ' selected' : '') + '>排序：更新时间</option>';
      sortOpts += '<option value="title"' + (state.sort === 'title' ? ' selected' : '') + '>排序：标题</option>';
      if (hasStatus) sortOpts += '<option value="status"' + (state.sort === 'status' ? ' selected' : '') + '>排序：状态</option>';
      sortSel = '<div class="select-wrap"><select id="sortSel">' + sortOpts + '</select></div>';
    }
    // list/grid toggle only applies to cover cards, not to the document index
    var showViewToggle = kind !== 'wiki';
    return '<div class="wrap">' +
      '<div class="catalog-top"><div class="crumb">INDEX / <b>' + esc(meta.label) + '</b></div>' +
        '<div class="catalog-title"><h2>' + esc(meta.label) + '</h2><span class="count">' + list.length + ' / ' + kindItems.length + ' ENTRIES · ' + esc(meta.desc) + '</span></div>' +
      '</div>' +
      '<div class="catalog-layout' + (rail ? '' : ' no-rail') + '">' + rail +
        '<div class="list-col">' +
          '<div class="list-toolbar">' +
            '<div class="search-box"><span class="search-icon" aria-hidden="true">' + GI.search + '</span><input id="listSearch" type="search" placeholder="筛选当前列表…" value="' + esc(state.q) + '"><kbd>/</kbd></div>' +
            sortSel +
            (showViewToggle ?
            '<div class="view-toggle"><button data-view="list" class="' + (state.view === 'list' ? 'active' : '') + '" title="列表"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor"><path d="M2 3h12M2 8h12M2 13h12"/></svg></button>' +
              '<button data-view="grid" class="' + (state.view === 'grid' ? 'active' : '') + '" title="网格"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor"><rect x="2" y="2" width="5" height="5"/><rect x="9" y="2" width="5" height="5"/><rect x="2" y="9" width="5" height="5"/><rect x="9" y="9" width="5" height="5"/></svg></button></div>' : '') +
            '<span class="result-line">SHOWING ' + list.length + ' RESULTS</span>' +
          '</div>' +
          cardsRegion(kind) +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ---------- detail --------------------------------------------------- */
  /* ---------- on-demand article payload -------------------------------
     The index carries metadata, an excerpt and the searchable plain text
     only; a detail page pulls its article HTML from data/bodies/<id>.js on
     first open. Initial transfer stays at list size while every entry keeps
     its full page. */
  var bodyToken = 0;
  function loadBody(id) {
    var token = ++bodyToken;
    var host = main.querySelector('[data-body-for]');
    if (!host || !id) return;
    var inject = function (html) {
      if (token !== bodyToken || !document.body.contains(host)) return;
      host.innerHTML = String(html).replace(/<!--DOWNLOAD_SLOT-->/g, '');
      hydrateMedia();
    };
    var cache = window.VMCT_BODY;
    if (cache && typeof cache[id] === 'string') { inject(cache[id]); return; }
    var s = document.createElement('script');
    s.src = 'data/bodies/' + id.replace(/\//g, '__') + '.js';
    s.onload = function () {
      if (token !== bodyToken || !document.body.contains(host)) return;
      var body = (window.VMCT_BODY || {})[id];
      if (typeof body === 'string') { inject(body); return; }
      host.innerHTML = '<div class="body-loading">正文同步失败 // NO BODY</div>';
    };
    s.onerror = function () {
      if (token !== bodyToken || !document.body.contains(host)) return;
      host.innerHTML = '<div class="body-loading">正文同步失败 // NO BODY</div>';
    };
    document.head.appendChild(s);
  }

  // Download buttons / link chips are built from data/details.js, which is
  // fetched after first paint (or when a detail page opens).
  function dlHtmlFor(it) {
    var seenUrl = {};
    return (detailData(it).downloads || []).map(function (d) {
      if (!d.link && !d.lanzouLink && !d.quarkLink) return '';   // no destination
      var url = d.link || d.lanzouLink || d.quarkLink || '#';
      var out = '';
      if (!seenUrl[url]) {
        seenUrl[url] = 1;
        var ico = d.icon ? '<img class="dl-ico" src="' + esc(d.icon) + '" alt="" onerror="this.style.display=\'none\'">' :
          '<span class="dl-ico dl-ico-gi" style="display:grid;place-items:center;color:var(--accent)">' + GI.download + '</span>';
        var label = d.text || (d.lanzouLink && d.quarkLink ? '蓝奏云 / 夸克网盘' : '下载汉化');
        out = '<a class="dl-btn" href="' + esc(url) + '" target="_blank" rel="noopener">' + ico +
          '<span class="dl-name">' + esc(label) + '</span><span class="dl-arrow">' + GI.arrowUR + '</span></a>';
      }
      if (d.quarkLink && !seenUrl[d.quarkLink]) {
        seenUrl[d.quarkLink] = 1;
        out += '<a class="dl-btn" href="' + esc(d.quarkLink) + '" target="_blank" rel="noopener">' +
          '<span class="dl-ico dl-ico-gi" style="display:grid;place-items:center;color:var(--accent)">' + GI.download + '</span>' +
          '<span class="dl-name">夸克网盘</span><span class="dl-arrow">' + GI.arrowUR + '</span></a>';
      }
      return out;
    }).join('');
  }
  function linksHtmlFor(it) {
    var linkIcons = { github: 'assets/imgs/svg/github.svg', bilibili: 'assets/imgs/svg/bilibili.svg', modrinth: 'assets/imgs/svg/modrinth.svg', curseforge: 'assets/imgs/svg/curseforge.svg', paratranz: 'assets/imgs/svg/paratranz.svg', planetminecraft: 'assets/imgs/svg/planetminecraft.svg' };
    return (detailData(it).links || []).map(function (l) {
      var ico = linkIcons[l.id] ? '<img class="ico" src="' + linkIcons[l.id] + '" alt="">' : '<span class="ico">' + GI.arrowUR + '</span>';
      return '<a class="link-chip" href="' + esc(l.url) + '" target="_blank" rel="noopener">' + ico + esc(l.label) + '<span class="chip-go">' + GI.arrowUR + '</span></a>';
    }).join('');
  }
  function sideExtraHtml(it) {
    var dls = detailData(it).downloads || [];
    var lks = detailData(it).links || [];
    var waiting = !DETAILS && (detailsState === 'loading');
    var html = '';
    if (dls.length) {
      html += '<div class="side-card"><h3>获取汉化 <span>DOWNLOAD</span></h3><div class="side-body">' + dlHtmlFor(it) + '</div></div>';
    } else if (waiting && it.dc > 0) {
      html += '<div class="side-card"><h3>获取汉化 <span>DOWNLOAD</span></h3><div class="side-body"><div class="body-loading">同步中 // SYNC</div></div></div>';
    }
    if (lks.length) {
      html += '<div class="side-card"><h3>相关链接 <span>LINKS</span></h3><div class="side-body">' + linksHtmlFor(it) + '</div></div>';
    } else if (waiting && it.lc > 0) {
      html += '<div class="side-card"><h3>相关链接 <span>LINKS</span></h3><div class="side-body"><div class="body-loading">同步中 // SYNC</div></div></div>';
    }
    return html;
  }

  function viewDetail(id) {
    var it = byId(id);
    if (!it) return '<div class="wrap"><div class="empty"><h3>档案不存在</h3><p>' + esc(id) + '</p></div></div>';
    var tags = '';
    if (it.status) tags += '<span class="tag' + (it.status === 'maintaining' ? ' accent' : '') + (it.status === 'stopped' ? ' stopped' : '') + '">' + esc(statusText(it)) + '</span>';
    if (it.loader) tags += '<span class="tag">' + loaderSvg(it.loader) + esc(loaderText(it)) + '</span>';
    if (it.minecraft) tags += '<span class="tag">MC ' + esc(it.minecraft) + '</span>';
    if (it.packVersion) tags += '<span class="tag">v' + esc(it.packVersion) + '</span>';

    // Drop rows that have no value: a wiki chapter would otherwise show a
    // column of "—" placeholders for loader / MC version / pack version.
    var kvPairs = [['档案编号', it.id], ['原始名称', it.originalName], ['更新时间', it.updateDate],
      ['加载器', loaderText(it)], ['MC 版本', it.minecraft], ['包版本', it.packVersion]]
      .filter(function (p) { return p[1]; });
    var kv = kvPairs.map(function (p) { return '<div class="kv"><dt>' + esc(p[0]) + '</dt><dd>' + esc(p[1]) + '</dd></div>'; }).join('');

    var cover = coverOf(it);
    var hasCover = cover && ((cover.state === 'ready' && cover.target) || (cover.state === 'remote' && (cover.target || cover.source)));
    // No cover art → skip the hero thumbnail entirely rather than showing an
    // empty "NO SIGNAL" plate next to the title.
    var heroIcon = hasCover
      ? mediaSlot(cover, 'cover').replace('class="media-slot ', 'class="detail-icon media-slot ')
      : '';

    return '<div class="wrap">' +
      '<a class="detail-back" href="#/' + it.kind + '">' + GI.arrowL + '返回 ' + esc(KIND_META[it.kind].label) + '索引</a>' +
      '<div class="detail">' +
        '<div class="detail-main">' +
          '<div class="detail-hero"><div class="detail-hd">' +
            heroIcon +
            '<div><h1>' + esc(it.title) + '</h1>' + (it.originalName ? '<div class="detail-original">' + esc(it.originalName) + '</div>' : '') +
            (tags ? '<div class="detail-tags">' + tags + '</div>' : '') + '</div>' +
          '</div>' + (it.description ? '<p class="detail-desc">' + esc(it.description) + '</p>' : '') + '</div>' +
          // article HTML is fetched on demand — see loadBody(). The empty
          // host is what it patches once the payload arrives.
          '<article class="prose" data-body-for="' + esc(it.id) + '">' +
          (it.bodyHtml
            ? it.bodyHtml.replace(/<!--DOWNLOAD_SLOT-->/g, '')
            : '<div class="body-loading">正文按需加载 // SYNC BODY</div>') + '</article>' +
        '</div>' +
        '<aside class="detail-side">' +
          '<div class="side-card"><h3>档案参数 <span>DATA</span></h3><div class="side-body">' + kv + '</div></div>' +
          '<div data-side-extra="' + esc(it.id) + '">' + sideExtraHtml(it) + '</div>' +
          (it.authors.length ? '<div class="side-card"><h3>贡献者 <span>CREDITS</span></h3><div class="side-body"><div class="people">' + it.authors.map(function (a) { return '<span class="person">' + esc(a) + '</span>'; }).join('') + '</div></div></div>' : '') +
        '</aside>' +
      '</div>' +
    '</div>';
  }

  /* ---------- credits -------------------------------------------------- */
  function viewCredits() {
    var list = CREDITS || DATA.credits || [];
    if (!list.length) {
      ensureCredits();   // credit roll ships separately (data/credits.js)
      return '<div class="wrap"><div class="catalog-top"><div class="crumb">INDEX / <b>致谢</b></div>' +
        '<div class="catalog-title"><h2>贡献者名录</h2><span class="count">SYNC…</span></div></div>' +
        '<div class="empty"><div class="cross mar-cross"><i class="h"></i><i class="v"></i><i class="d"></i></div><h3>载入中</h3><p>SYNC CREDITS</p></div></div>';
    }
    var groups = {};
    list.forEach(function (p) { (groups[p.group] = groups[p.group] || []).push(p); });
    // Site-level attribution lives in the renderer, not the synced dataset, so
    // an upstream sync can never drop it.
    var site = {
      group: '站点镜像',
      people: [
        { name: 'AweiMC', title: '站点维护', url: 'https://github.com/AweiMC' },
        { name: 'vmct-ce-site', title: '源码仓库（MIT）', url: 'https://github.com/AweiMC/vmct-ce-site' },
        { name: 'VM 中文翻译组', title: '上游数据与内容', url: 'https://github.com/VM-Chinese-translate-group' }
      ]
    };
    function person(p) {
      var body = esc(p.name) + (p.title ? '<small>' + esc(p.title) + '</small>' : '');
      return p.url
        ? '<a class="credit-person is-link" href="' + esc(p.url) + '" target="_blank" rel="noopener">' + body + '</a>'
        : '<div class="credit-person">' + body + '</div>';
    }
    return '<div class="wrap"><div class="catalog-top"><div class="crumb">INDEX / <b>致谢</b></div>' +
      '<div class="catalog-title"><h2>贡献者名录</h2><span class="count">' + (list.length + site.people.length) + ' ENTRIES</span></div></div>' +
      '<div class="credits-grid">' +
      '<section class="credit-col"><h3>' + esc(site.group) + '<span>' + site.people.length + '</span></h3><div class="credit-list">' +
      site.people.map(person).join('') + '</div></section>' +
      Object.keys(groups).map(function (g) {
        return '<section class="credit-col"><h3>' + esc(g) + '<span>' + groups[g].length + '</span></h3><div class="credit-list">' +
          groups[g].map(person).join('') +
          '</div></section>';
      }).join('') + '</div></div>';
  }

  /* ---------- router --------------------------------------------------- */
  function parseHash() {
    var h = location.hash.replace(/^#\/?/, '');
    if (!h) return { kind: 'home' };
    var parts = h.split('/');
    if (parts[0] === 'detail' && parts.length > 1)
      return { kind: 'detail', id: decodeURIComponent(parts.slice(1).join('/')) };
    if (KIND_META[parts[0]]) return { kind: parts[0] };
    return { kind: 'home' };
  }
  function navigate(hash) {
    var doRender = function () { if (location.hash === hash) render(); else location.hash = hash; };
    M.viewTransition(doRender);
  }
  function render() {
    var r = parseHash();
    // Switching between catalog views clears any active filters, so a loader /
    // version chosen in one category never empties a different category.
    // Use lastKind (updated only from the real route) instead of state.kind,
    // which the global search may pre-set without changing the hash.
    if (r.kind !== 'detail' && r.kind !== lastKind) {
      state.q = ''; state.loader = null; state.status = null; state.version = null;
      if (searchEl) searchEl.value = '';
    }
    if (r.kind !== 'detail' && r.kind !== state.kind) state.page = 1;   // new view: back to page 1
    if (r.kind !== 'detail') { state.kind = r.kind; lastKind = r.kind; }
    document.body.dataset.view = r.kind;
    var html;
    if (r.kind === 'home') html = viewHome();
    else if (r.kind === 'credits') html = viewCredits();
    else if (r.kind === 'detail') html = viewDetail(r.id);
    else html = viewCatalog(r.kind);
    main.innerHTML = '<div class="view">' + html + '</div>';
    hydrateMedia();
    if (r.kind === 'home') M.initHeroGlyph(main.querySelector('#heroGlyph'));
    if (r.kind === 'detail') {
      var hero = main.querySelector('.detail-hero');
      M.detailIntro(hero);
      ensureDetails();
      loadBody(r.id);
    }
    renderTabs();
    bindView();
    document.getElementById('footerStat').textContent =
      'RECORDS ' + DATA.meta.counts.total + ' // SYNC ' + (DATA.meta.generatedAt || '').slice(0, 10);
    window.scrollTo({ top: 0, behavior: M.reduced() ? 'auto' : 'instant' });
  }

  /* ---------- delegated interactions ---------------------------------- */
  // Scoped refresh helper: confine the slice transition to the list column.
  function refreshScoped() {
    var listCol = main.querySelector('.list-col');
    if (!listCol || M.reduced()) { updateScoped(); return; }
    M.scopedTransition(listCol, updateScoped);
  }

  // Bind all detail cards: both catalog rows and home featured cards share
  // the same data-detail contract, so bind them from one place.
  function bindListRegion() {
    main.querySelectorAll('[data-detail]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (e.target.closest('a')) return;
        navigate('#/detail/' + encodeURIComponent(el.dataset.detail));
      });
    });
  }

  // Paging is client-side: a page button repaints only the list region.
  // Direct update (no transition): paging should feel instant and must not
  // depend on animation frames being delivered.
  function bindPaging() {
    main.querySelectorAll('[data-page]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.disabled) return;
        var next = parseInt(b.dataset.page, 10);
        if (!next || next === state.page) return;
        state.page = next;
        updateScoped();
        var top = main.querySelector('.catalog-top');
        if (top) window.scrollTo({ top: top.getBoundingClientRect().top + window.scrollY, behavior: M.reduced() ? 'auto' : 'instant' });
      });
    });
    var ps = document.getElementById('pageSize');
    if (ps) ps.addEventListener('change', function () {
      var v = parseInt(ps.value, 10);
      if (PAGE_SIZES.indexOf(v) < 0) return;
      state.pageSize = v;
      state.page = 1;
      try { localStorage.setItem('vmct.pageSize', String(v)); } catch (e) { /* ignore */ }
      updateScoped();
    });
  }

  function bindView() {
    main.querySelectorAll('[data-goto]').forEach(function (el) {
      el.addEventListener('click', function () { navigate('#/' + el.dataset.goto); });
    });
    bindListRegion();
    bindPaging();
    var ls = document.getElementById('listSearch');
    if (ls) ls.addEventListener('input', function () {
      state.q = ls.value.trim();
      state.page = 1;
      refreshScoped();   // toolbar input is preserved, focus stays put
    });
    var sortSel = document.getElementById('sortSel');
    if (sortSel) sortSel.addEventListener('change', function () {
      state.sort = sortSel.value; state.page = 1; refreshScoped();
    });
    main.querySelectorAll('[data-view]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.view = b.dataset.view;
        state.page = 1;
        main.querySelectorAll('[data-view]').forEach(function (x) { x.classList.toggle('active', x === b); });
        refreshScoped();
      });
    });
    main.querySelectorAll('[data-facet]').forEach(function (el) {
      el.addEventListener('click', function () {
        var key = el.dataset.facet, val = el.dataset.value;
        state[key] = state[key] === val ? null : val;
        state.page = 1;
        refreshScoped();
      });
    });
    main.querySelectorAll('[data-filter-search]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var v = inp.value.toLowerCase();
        inp.parentElement.querySelectorAll('.fopt').forEach(function (o) {
          o.style.display = o.dataset.value.toLowerCase().indexOf(v) >= 0 ? '' : 'none';
        });
      });
    });
    var clear = document.getElementById('clearFilters');
    if (clear) clear.addEventListener('click', function () {
      state.q = ''; state.loader = null; state.status = null; state.version = null;
      state.page = 1;
      if (searchEl) searchEl.value = '';
      var lsEl = document.getElementById('listSearch');
      if (lsEl) lsEl.value = '';
      refreshScoped();
    });
    main.querySelectorAll('.filter-group > h3').forEach(function (h) {
      h.addEventListener('click', function () {
        var body = h.nextElementSibling;
        body.classList.toggle('collapsed');
        var c = h.querySelector('.caret');
        if (c) c.classList.toggle('up', body.classList.contains('collapsed'));
      });
    });
  }

  /* ---------- search palette (Marathon dialog) ------------------------- */
  var searchModal = null, searchInput = null, searchResults = null, searchCount = null;
  var searchActive = -1, searchLastFocus = null;

  function buildSearchModal() {
    if (searchModal) return;
    var wrap = document.createElement('div');
    wrap.className = 'search-modal';
    wrap.id = 'searchModal';
    wrap.hidden = true;
    wrap.innerHTML =
      '<div class="search-backdrop" data-search-close></div>' +
      '<div class="search-panel" role="dialog" aria-modal="true" aria-label="检索档案">' +
        '<div class="search-field">' +
          '<span class="search-icon" aria-hidden="true">' + GI.search + '</span>' +
          '<input id="searchModalInput" type="search" autocomplete="off" spellcheck="false" placeholder="检索标题 / 简介 / 作者…">' +
          '<kbd>ESC</kbd>' +
        '</div>' +
        '<div class="search-meta"><span id="searchCount">输入关键词开始检索</span><span class="plate">SEARCH // ARCHIVE</span></div>' +
        '<div class="search-results" id="searchResults"></div>' +
        '<div class="search-foot"><span>↑ ↓ 选择</span><span>↵ 打开</span><span>ESC 关闭</span></div>' +
      '</div>';
    document.body.appendChild(wrap);
    searchModal = wrap;
    searchInput = wrap.querySelector('#searchModalInput');
    searchResults = wrap.querySelector('#searchResults');
    searchCount = wrap.querySelector('#searchCount');

    wrap.addEventListener('click', function (e) {
      if (e.target.closest('[data-search-close]')) closeSearch();
    });
    searchInput.addEventListener('input', renderSearchResults);
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSearchActive(searchActive + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSearchActive(searchActive - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); openSearchActive(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSearch(); }
    });
  }

  function openSearch() {
    buildSearchModal();
    if (!searchModal.hidden) { searchInput.focus(); return; }
    searchLastFocus = document.activeElement;
    searchModal.hidden = false;
    document.body.classList.add('search-open');
    renderSearchResults();
    searchInput.focus();
    searchInput.select();
  }
  function closeSearch() {
    if (!searchModal || searchModal.hidden) return;
    searchModal.hidden = true;
    document.body.classList.remove('search-open');
    var back = searchLastFocus;
    if (back && back !== searchEl && back.focus) back.focus();
    else if (document.activeElement === searchInput) searchInput.blur();
  }
  function isSearchOpen() { return !!(searchModal && !searchModal.hidden); }

  // A phone-sized trigger box cannot fit the desktop placeholder.
  function syncSearchPlaceholder() {
    if (!searchEl) return;
    var w = window.innerWidth || 0;
    searchEl.placeholder = w <= 400 ? '检索'
      : isMobile() ? '检索 / SEARCH'
      : '检索档案 / SEARCH ARCHIVE';
  }

  // Ranked metadata search: title beats original name, which beats description.
  function searchHits(q) {
    var needle = q.trim().toLowerCase();
    if (!needle) {
      var feat = DATA.items.filter(function (i) { return i.featured; }).slice(0, 6);
      return { items: feat, total: feat.length };
    }
    var scored = [];
    DATA.items.forEach(function (it) {
      var title = (it.title || '').toLowerCase();
      var orig = (it.originalName || '').toLowerCase();
      var desc = (it.description || '').toLowerCase();
      var exc = (it.excerpt || '').toLowerCase();
      var authors = (it.authors || []).join(' ').toLowerCase();
      var score = 0;
      if (title.indexOf(needle) === 0) score = 100;
      else if (title.indexOf(needle) >= 0) score = 80;
      else if (orig.indexOf(needle) >= 0) score = 60;
      else if (desc.indexOf(needle) >= 0) score = 40;
      else if (exc.indexOf(needle) >= 0) score = 30;
      else if (authors.indexOf(needle) >= 0) score = 20;
      if (score) scored.push({ it: it, s: score });
    });
    scored.sort(function (a, b) {
      return b.s - a.s || String(a.it.title).localeCompare(String(b.it.title));
    });
    return { items: scored.slice(0, 30).map(function (x) { return x.it; }), total: scored.length };
  }

  function renderSearchResults() {
    if (!searchInput) return;
    var q = searchInput.value.trim();
    var hit = searchHits(q);
    searchCount.textContent = q ? hit.total + ' 条匹配 // ' + hit.total + ' HITS' : '精选档案 // FEATURED';
    if (!hit.items.length) {
      searchResults.innerHTML = '<div class="search-empty"><span class="se-mark">NO MATCH</span>无匹配档案 — 试试标题、原名或简介中的词</div>';
      searchActive = -1;
      return;
    }
    searchResults.innerHTML = hit.items.map(function (it, idx) {
      var cover = coverOf(it);
      var url = cover.target || cover.source || '';
      var meta = KIND_META[it.kind] || { label: it.kind, num: '--' };
      var bits = [];
      if (it.loader) bits.push(loaderText(it));
      if (it.minecraft) bits.push('MC ' + it.minecraft);
      if (it.status) bits.push(statusText(it));
      var excerpt = excerptOf(it, 120);
      return '<button type="button" class="sr-item' + (idx === 0 ? ' active' : '') + '" data-search-id="' + esc(it.id) + '">' +
        '<span class="sr-thumb">' + (url ? '<img src="' + esc(url) + '" alt="" loading="lazy" decoding="async">' : '') + '</span>' +
        '<span class="sr-body">' +
          '<span class="sr-kind">' + esc(meta.num) + ' ' + esc(meta.label) + '</span>' +
          '<span class="sr-title">' + esc(it.title) +
            (it.originalName ? '<span class="sr-orig">' + esc(it.originalName) + '</span>' : '') + '</span>' +
          (excerpt ? '<span class="sr-desc">' + esc(excerpt) + '</span>' : '') +
          (bits.length ? '<span class="sr-meta">' + esc(bits.join(' · ')) + '</span>' : '') +
        '</span><span class="sr-go" aria-hidden="true">' + GI.arrowUR + '</span>' +
      '</button>';
    }).join('');
    searchActive = 0;
    searchResults.querySelectorAll('[data-search-id]').forEach(function (b, idx) {
      b.addEventListener('click', function () { pickSearch(b.dataset.searchId); });
      b.addEventListener('mousemove', function () { setSearchActive(idx); });
    });
  }
  function setSearchActive(i) {
    var rows = searchResults.querySelectorAll('.sr-item');
    if (!rows.length) { searchActive = -1; return; }
    if (i < 0) i = rows.length - 1;
    if (i >= rows.length) i = 0;
    searchActive = i;
    rows.forEach(function (r, n) { r.classList.toggle('active', n === i); });
    if (rows[i].scrollIntoView) rows[i].scrollIntoView({ block: 'nearest' });
  }
  function openSearchActive() {
    var rows = searchResults.querySelectorAll('.sr-item');
    if (searchActive >= 0 && rows[searchActive]) pickSearch(rows[searchActive].dataset.searchId);
  }
  function pickSearch(id) {
    closeSearch();
    navigate('#/detail/' + encodeURIComponent(id));
  }

  /* ---------- global --------------------------------------------------- */
  // The header input is a trigger: focus/click opens the search palette.
  searchEl.addEventListener('focus', function () { openSearch(); });
  searchEl.addEventListener('click', function (e) { e.preventDefault(); openSearch(); });
  document.addEventListener('keydown', function (e) {
    var typing = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault(); openSearch(); return;
    }
    if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
      e.preventDefault(); openSearch(); return;
    }
    if (e.key === 'Escape') {
      if (isSearchOpen()) { closeSearch(); return; }
      searchEl.value = ''; state.q = ''; state.page = 1; render();
    }
  });
  // The hash actually changed, so the view must re-render. Comparing against
  // state.kind is wrong here: entering a detail page keeps the previous kind,
  // so navigating back to that same kind would (wrongly) skip the render and
  // leave the detail page up until a second click.
  addEventListener('hashchange', function () { render(); });
  document.getElementById('menuToggle').addEventListener('click', function () {
    var t = document.getElementById('tabs'), open = t.classList.toggle('open');
    this.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  var footerToggle = document.getElementById('footerToggle');
  footerToggle.addEventListener('click', function () {
    var more = document.getElementById('footerMore');
    var open = more.classList.toggle('open');
    this.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  function clock() {
    var d = new Date();
    document.getElementById('sysClock').textContent =
      [d.getHours(), d.getMinutes(), d.getSeconds()].map(function (n) { return String(n).padStart(2, '0'); }).join(':') + ' LT';
  }

  function init() {
    M.boot();
    M.initDotField();
    buildSearchModal();
    syncSearchPlaceholder();
    addEventListener('resize', syncSearchPlaceholder);
    render();
    clock(); setInterval(clock, 1000);
    // warm the offsite-target payload while idle: detail pages then open with
    // their download/link sections already available
    if (!(navigator.connection && navigator.connection.saveData)) {
      var warm = function () { ensureDetails(); };
      if (window.requestIdleCallback) requestIdleCallback(warm, { timeout: 2500 });
      else setTimeout(warm, 1200);
    }
  }
  init();
})();
