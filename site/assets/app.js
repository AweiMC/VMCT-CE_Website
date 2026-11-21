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
  var state = {
    kind: 'home',
    q: '',
    loader: null,
    status: null,
    version: null,
    sort: 'updated',
    view: 'list'
  };

  var KIND_META = {
    modpack: { label: '整合包', num: '01', desc: '经过汉化的 Minecraft 整合包档案' },
    map: { label: '地图', num: '02', desc: '汉化地图与冒险存档档案' },
    wiki: { label: '资料库', num: '03', desc: '整合包配套资料与攻略文档' },
    credits: { label: '致谢', num: '04', desc: '贡献者与社区成员名录' },
    page: { label: '其他', num: '05', desc: '社区公告与说明文档' }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
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

  // Plain text of an item's body, cached. Used for search matches and for a
  // real excerpt when an entry carries no frontmatter description. The
  // normalizer ships this text inside the index so full-text search does not
  // need the (lazy) article HTML; the fallback covers stale cached data.
  var TEXT_CACHE = Object.create(null);
  function plainText(it) {
    if (typeof it.searchText === 'string') return it.searchText;
    if (TEXT_CACHE[it.id] === undefined) {
      var d = document.createElement('div');
      d.innerHTML = it.bodyHtml || '';
      // drop the "IMG // BODY-01" placeholder captions — they are chrome,
      // not prose, and would otherwise open every excerpt
      d.querySelectorAll('.img-slot-mark').forEach(function (n) { n.remove(); });
      TEXT_CACHE[it.id] = (d.textContent || '').replace(/\s+/g, ' ').trim();
    }
    return TEXT_CACHE[it.id];
  }
  function excerptOf(it, max) {
    if (it.description) return it.description;
    if (it.excerpt) return it.excerpt;
    var t = plainText(it);
    if (!t) return '';
    return t.length > max ? t.slice(0, max) + '…' : t;
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
    return (item.media || []).find(function (m) { return m.role === 'cover'; }) || null;
  }
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
      var hay = (it.title + ' ' + it.originalName + ' ' + it.description + ' ' +
        it.authors.join(' ') + ' ' + plainText(it)).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
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
  function filterRail(kindItems) {
    var versions = facetCounts(kindItems, 'minecraft');
    var loaders = facetCounts(kindItems, 'loader');
    var statuses = facetCounts(kindItems, 'status');
    var groups = [];
    if (Object.keys(versions).length) {
      var verOpts = Object.keys(versions).sort(function (a, b) { return b.localeCompare(a, undefined, { numeric: true }); })
        .slice(0, 12).map(function (v) { return optRow(v, v, versions[v], 'version', state.version === v); }).join('');
      groups.push('<div class="filter-group"><h3>游戏版本 <span class="caret">' + GI.chevron + '</span><span class="plate">VERSION</span></h3><div class="filter-body">' +
        '<input class="filter-search" placeholder="搜索版本…" data-filter-search="version">' + verOpts + '</div></div>');
    }
    if (Object.keys(loaders).length) {
      var loaderOpts = Object.keys(loaders).sort().map(function (v) {
        var label = DATA.loaderLabels[v] || v;
        var ico = ICONS[v] ? '<span class="fopt-ico">' + ICONS[v] + '</span>' : '';
        return optRow(v, label, loaders[v], 'loader', state.loader === v, ico);
      }).join('');
      groups.push('<div class="filter-group"><h3>加载器 <span class="plate">LOADER</span></h3><div class="filter-body">' + loaderOpts + '</div></div>');
    }
    if (Object.keys(statuses).length) {
      var statusOpts = Object.keys(statuses).map(function (v) {
        var lbl = DATA.statusLabels[v] || v;
        return optRow(v, lbl, statuses[v], 'status', state.status === v);
      }).join('');
      groups.push('<div class="filter-group"><h3>状态 <span class="plate">STATUS</span></h3><div class="filter-body">' + statusOpts + '</div></div>');
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
    if (it.status) tags += '<span class="tag' + (it.status === 'maintaining' ? ' accent' : '') + (it.status === 'stopped' ? ' stopped' : '') + '">' + esc(it.statusLabel) + '</span>';
    if (it.loader) tags += '<span class="tag">' + loaderSvg(it.loader) + esc(it.loaderLabel || it.loader) + '</span>';
    if (it.minecraft) tags += '<span class="tag">MC ' + esc(it.minecraft) + '</span>';
    var meta = '';
    var bits = [];
    if (it.updateDate) bits.push('<span>' + GI.clock + esc(it.updateDate) + '</span>');
    if (it.links.length + it.downloads.length) bits.push('<span>' + GI.arrowUR + (it.links.length + it.downloads.length) + '</span>');
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
    return '<div class="cards doc-list">' + out.join('') + '</div>';
  }

  // Render just the cards/empty region of the list column.
  function cardsRegion(kind) {
    var kindItems = allItems().filter(function (i) { return i.kind === kind; });
    // the document index keeps upstream order (root page, then chapters)
    if (kind === 'wiki') {
      var docs = kindItems.filter(itemMatches);
      return docs.length ? docListHtml(docs, kindItems) : emptyRegion();
    }
    var list = sorted(kindItems.filter(itemMatches));
    if (!list.length) return emptyRegion();
    var gridCls = state.view === 'grid' ? ' grid' : '';
    return '<div class="cards' + gridCls + '">' + list.map(cardHtml).join('') + '</div>';
  }
  function emptyRegion() {
    return '<div class="empty"><div class="cross mar-cross"><i class="h"></i><i class="v"></i><i class="d"></i></div><h3>无匹配档案</h3><p>调整筛选条件或清除检索词</p></div>';
  }

  // Scoped refresh: repaint only the list column, keep toolbar/filter rail intact.
  function updateScoped() {
    var kind = state.kind;
    var listCol = main.querySelector('.list-col');
    if (!listCol) { render(); return; }
    var region = listCol.querySelector('.cards, .empty');
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

  function viewDetail(id) {
    var it = byId(id);
    if (!it) return '<div class="wrap"><div class="empty"><h3>档案不存在</h3><p>' + esc(id) + '</p></div></div>';
    var tags = '';
    if (it.status) tags += '<span class="tag' + (it.status === 'maintaining' ? ' accent' : '') + (it.status === 'stopped' ? ' stopped' : '') + '">' + esc(it.statusLabel) + '</span>';
    if (it.loader) tags += '<span class="tag">' + loaderSvg(it.loader) + esc(it.loaderLabel || it.loader) + '</span>';
    if (it.minecraft) tags += '<span class="tag">MC ' + esc(it.minecraft) + '</span>';
    if (it.packVersion) tags += '<span class="tag">v' + esc(it.packVersion) + '</span>';

    // One button per destination: seeds sometimes repeat a mirror, and a
    // quark mirror rides along with its lanzou partner. Seen-URLs are tracked
    // across the whole list so a duplicate can never reach the DOM.
    var seenUrl = {};
    var dlHtml = it.downloads.map(function (d) {
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

    var linkIcons = { github: 'assets/imgs/svg/github.svg', bilibili: 'assets/imgs/svg/bilibili.svg', modrinth: 'assets/imgs/svg/modrinth.svg', curseforge: 'assets/imgs/svg/curseforge.svg', paratranz: 'assets/imgs/svg/paratranz.svg', planetminecraft: 'assets/imgs/svg/planetminecraft.svg' };
    var linksHtml = it.links.map(function (l) {
      var ico = linkIcons[l.id] ? '<img class="ico" src="' + linkIcons[l.id] + '" alt="">' : '<span class="ico">' + GI.arrowUR + '</span>';
      return '<a class="link-chip" href="' + esc(l.url) + '" target="_blank" rel="noopener">' + ico + esc(l.label) + '<span class="chip-go">' + GI.arrowUR + '</span></a>';
    }).join('');

    // Drop rows that have no value: a wiki chapter would otherwise show a
    // column of "—" placeholders for loader / MC version / pack version.
    var kvPairs = [['档案编号', it.id], ['原始名称', it.originalName], ['更新时间', it.updateDate || it.updateDateRaw],
      ['加载器', it.loaderLabel || it.loader], ['MC 版本', it.minecraft], ['包版本', it.packVersion]]
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
          (it.downloads.length ? '<div class="side-card"><h3>获取汉化 <span>DOWNLOAD</span></h3><div class="side-body">' + dlHtml + '</div></div>' : '') +
          (it.links.length ? '<div class="side-card"><h3>相关链接 <span>LINKS</span></h3><div class="side-body">' + linksHtml + '</div></div>' : '') +
          (it.authors.length ? '<div class="side-card"><h3>贡献者 <span>CREDITS</span></h3><div class="side-body"><div class="people">' + it.authors.map(function (a) { return '<span class="person">' + esc(a) + '</span>'; }).join('') + '</div></div></div>' : '') +
        '</aside>' +
      '</div>' +
    '</div>';
  }

  /* ---------- credits -------------------------------------------------- */
  function viewCredits() {
    var groups = {};
    DATA.credits.forEach(function (p) { (groups[p.group] = groups[p.group] || []).push(p); });
    return '<div class="wrap"><div class="catalog-top"><div class="crumb">INDEX / <b>致谢</b></div>' +
      '<div class="catalog-title"><h2>贡献者名录</h2><span class="count">' + DATA.credits.length + ' ENTRIES</span></div></div>' +
      '<div class="credits-grid">' + Object.keys(groups).map(function (g) {
        return '<section class="credit-col"><h3>' + esc(g) + '<span>' + groups[g].length + '</span></h3><div class="credit-list">' +
          groups[g].map(function (p) { return '<div class="credit-person">' + esc(p.name) + (p.title ? '<small>' + esc(p.title) + '</small>' : '') + '</div>'; }).join('') +
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

  function bindView() {
    main.querySelectorAll('[data-goto]').forEach(function (el) {
      el.addEventListener('click', function () { navigate('#/' + el.dataset.goto); });
    });
    bindListRegion();
    var ls = document.getElementById('listSearch');
    if (ls) ls.addEventListener('input', function () {
      state.q = ls.value.trim();
      refreshScoped();   // toolbar input is preserved, focus stays put
    });
    var sortSel = document.getElementById('sortSel');
    if (sortSel) sortSel.addEventListener('change', function () { state.sort = sortSel.value; refreshScoped(); });
    main.querySelectorAll('[data-view]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.view = b.dataset.view;
        main.querySelectorAll('[data-view]').forEach(function (x) { x.classList.toggle('active', x === b); });
        refreshScoped();
      });
    });
    main.querySelectorAll('[data-facet]').forEach(function (el) {
      el.addEventListener('click', function () {
        var key = el.dataset.facet, val = el.dataset.value;
        state[key] = state[key] === val ? null : val;
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

  /* ---------- global --------------------------------------------------- */
  searchEl.addEventListener('input', function () {
    state.q = searchEl.value.trim();
    if (state.kind === 'home' && state.q) { state.kind = 'modpack'; }
    if (main.querySelector('.list-col')) {
      // keep the top search focus; only the list column refreshes
      var listInput = document.getElementById('listSearch');
      if (listInput) listInput.value = state.q;
      refreshScoped();
    } else {
      render();
    }
    searchEl.focus();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== searchEl && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault(); searchEl.focus();
    }
    if (e.key === 'Escape') { searchEl.value = ''; state.q = ''; render(); }
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
    render();
    clock(); setInterval(clock, 1000);
  }
  init();
})();
