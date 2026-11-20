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
  function loaderSvg(loader) {
    var raw = ICONS[loader];
    return raw ? '<span class="loader-ico" title="' + esc(loader) + '">' + raw + '</span>' : '';
  }
  function iconFor(item) {
    return item.icon ? '<img class="card-icon" src="' + esc(item.icon) + '" alt="" loading="lazy">' :
      '<div class="card-icon" style="display:grid;place-items:center;color:var(--ink-3);font:700 26px var(--display)">VM</div>';
  }
  function allItems() { return DATA.items; }
  function byId(id) { return DATA.items.find(function (x) { return x.id === id; }); }

  /* ---------- tabs ----------------------------------------------------- */
  function renderTabs() {
    var tabs = document.getElementById('tabs');
    var defs = [
      { id: 'home', label: '总览', num: '00' },
      { id: 'modpack', label: '整合包', num: DATA.meta.counts.modpack },
      { id: 'map', label: '地图', num: DATA.meta.counts.map },
      { id: 'wiki', label: '资料库', num: DATA.meta.counts.wiki },
      { id: 'credits', label: '致谢', num: '' },
      { id: 'page', label: '其他', num: DATA.meta.counts.page }
    ];
    tabs.innerHTML = defs.map(function (d) {
      return '<button class="tab' + (state.kind === d.id ? ' active' : '') + '" data-kind="' + d.id + '">' +
        d.label + (d.num !== '' ? '<span class="tab-num">' + d.num + '</span>' : '') + '</button>';
    }).join('');
    tabs.querySelectorAll('.tab').forEach(function (b) {
      b.addEventListener('click', function () { navigate('#/' + b.dataset.kind); });
    });
  }

  /* ---------- home ----------------------------------------------------- */
  function viewHome() {
    var c = DATA.meta.counts;
    var modules = [
      { kind: 'modpack', n: c.modpack, t: '整合包', d: '收录 57+ 汉化整合包，版本 / 加载器 / 状态一目了然。' },
      { kind: 'map', n: c.map, t: '地图', d: '建筑、解谜、角色扮演——汉化地图存档档案。' },
      { kind: 'wiki', n: c.wiki, t: '资料库', d: '配套攻略、机制说明与词条索引。' },
      { kind: 'credits', n: DATA.credits.length, t: '致谢', d: '所有让资料得以存在的贡献者。' }
    ];
    var featured = DATA.items.filter(function (i) { return i.featured; }).slice(0, 6);
    return '' +
      '<section class="hero">' +
        '<div class="hero-grid"></div>' +
        '<div class="hero-glyph" aria-hidden="true">VM</div>' +
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
            '<button class="btn primary" data-goto="modpack">进入整合包索引 <span class="arrow">↗</span></button>' +
            '<button class="btn" data-goto="map">浏览地图档案 <span class="arrow">→</span></button>' +
          '</div>' +
        '</div>' +
      '</section>' +
      '<div class="wrap">' +
        '<div class="section-head"><h2>01 / 数据模块</h2><span class="idx">SELECT A MODULE</span></div>' +
        '<div class="modules">' + modules.map(function (m, i) {
          return '<div class="module" data-goto="' + m.kind + '"><span class="num">0' + (i + 1) + ' / ' + m.n + ' ENTRIES</span>' +
            '<span class="go">↗</span><h3>' + m.t + '</h3><p>' + m.d + '</p></div>';
        }).join('') + '</div>' +
        (featured.length ? '<div class="section-head"><h2>02 / 精选档案</h2><span class="idx">FEATURED</span></div>' +
          '<div class="cards grid featured-grid">' + featured.map(cardHtml).join('') + '</div>' : '') +
      '</div>';
  }

  /* ---------- catalog -------------------------------------------------- */
  function itemMatches(it) {
    if (state.q) {
      var q = state.q.toLowerCase();
      var hay = (it.title + ' ' + it.originalName + ' ' + it.description + ' ' + it.authors.join(' ')).toLowerCase();
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
  function filterRail(kindItems) {
    var versions = facetCounts(kindItems, 'minecraft');
    var loaders = facetCounts(kindItems, 'loader');
    var statuses = facetCounts(kindItems, 'status');
    var verOpts = Object.keys(versions).sort(function (a, b) { return b.localeCompare(a, undefined, { numeric: true }); })
      .slice(0, 12).map(function (v) { return optRow(v, v, versions[v], 'version', state.version === v); }).join('');
    var loaderOpts = Object.keys(loaders).sort().map(function (v) {
      var label = DATA.loaderLabels[v] || v;
      var ico = ICONS[v] ? '<span class="fopt-ico">' + ICONS[v] + '</span>' : '';
      return optRow(v, label, loaders[v], 'loader', state.loader === v, ico);
    }).join('');
    var statusOpts = Object.keys(statuses).map(function (v) {
      var lbl = DATA.statusLabels[v] || v;
      return optRow(v, lbl, statuses[v], 'status', state.status === v);
    }).join('');
    return '<aside class="filter-rail">' +
      '<div class="filter-group"><h3>游戏版本 <span class="caret">−</span><span class="plate">VERSION</span></h3><div class="filter-body">' +
        '<input class="filter-search" placeholder="搜索版本…" data-filter-search="version">' + verOpts + '</div></div>' +
      '<div class="filter-group"><h3>加载器 <span class="plate">LOADER</span></h3><div class="filter-body">' + loaderOpts + '</div></div>' +
      '<div class="filter-group"><h3>状态 <span class="plate">STATUS</span></h3><div class="filter-body">' + statusOpts + '</div></div>' +
      '<button class="btn" id="clearFilters" style="justify-content:center"' + (state.loader || state.status || state.version || state.q ? '' : ' hidden') + '>清除筛选 ✕</button>' +
      '</aside>';
  }
  function cardHtml(it) {
    var tags = '<span class="tag' + (it.status === 'maintaining' ? ' accent' : '') + (it.status === 'stopped' ? ' stopped' : '') + '">' + esc(it.statusLabel) + '</span>';
    if (it.loader) tags += '<span class="tag">' + loaderSvg(it.loader) + esc(it.loaderLabel || it.loader) + '</span>';
    if (it.minecraft) tags += '<span class="tag">MC ' + esc(it.minecraft) + '</span>';
    var date = it.updateDate ? esc(it.updateDate) : '待定';
    return '<article class="card" data-detail="' + esc(it.id) + '">' + iconFor(it) +
      '<div class="card-body"><div class="card-head"><h3 class="card-title">' + esc(it.title) + '</h3></div>' +
      (it.originalName ? '<div class="card-author">原题 <b>' + esc(it.originalName) + '</b></div>' : '') +
      '<p class="card-desc">' + esc(it.description || '暂无简介') + '</p>' +
      '<div class="card-foot">' + tags + '<div class="card-meta"><span>◷ ' + date + '</span><span>↗ ' + (it.links.length + it.downloads.length) + '</span></div></div>' +
      '</div></article>';
  }
  // Render just the cards/empty region of the list column.
  function cardsRegion(kind) {
    var kindItems = allItems().filter(function (i) { return i.kind === kind; });
    var list = sorted(kindItems.filter(itemMatches));
    var gridCls = state.view === 'grid' ? ' grid' : '';
    return list.length
      ? '<div class="cards' + gridCls + '">' + list.map(cardHtml).join('') + '</div>'
      : '<div class="empty"><div class="cross mar-cross"><i class="h"></i><i class="v"></i><i class="d"></i></div><h3>无匹配档案</h3><p>调整筛选条件或清除检索词</p></div>';
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
    var list = sorted(kindItems.filter(itemMatches));
    var meta = KIND_META[kind] || { label: kind, num: '--', desc: '' };
    var gridCls = state.view === 'grid' ? ' grid' : '';
    return '<div class="wrap">' +
      '<div class="catalog-top"><div class="crumb">INDEX / <b>' + esc(meta.label) + '</b></div>' +
        '<div class="catalog-title"><h2>' + esc(meta.label) + '</h2><span class="count">' + list.length + ' / ' + kindItems.length + ' ENTRIES · ' + esc(meta.desc) + '</span></div>' +
      '</div>' +
      '<div class="catalog-layout">' + filterRail(kindItems) +
        '<div class="list-col">' +
          '<div class="list-toolbar">' +
            '<div class="search-box"><span class="search-icon"></span><input id="listSearch" type="search" placeholder="筛选当前列表…" value="' + esc(state.q) + '"><kbd>/</kbd></div>' +
            '<div class="select-wrap"><select id="sortSel">' +
              '<option value="updated"' + (state.sort === 'updated' ? ' selected' : '') + '>排序：更新时间</option>' +
              '<option value="title"' + (state.sort === 'title' ? ' selected' : '') + '>排序：标题</option>' +
              '<option value="status"' + (state.sort === 'status' ? ' selected' : '') + '>排序：状态</option>' +
            '</select></div>' +
            '<div class="view-toggle"><button data-view="list" class="' + (state.view === 'list' ? 'active' : '') + '" title="列表"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor"><path d="M2 3h12M2 8h12M2 13h12"/></svg></button>' +
              '<button data-view="grid" class="' + (state.view === 'grid' ? 'active' : '') + '" title="网格"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor"><rect x="2" y="2" width="5" height="5"/><rect x="9" y="2" width="5" height="5"/><rect x="2" y="9" width="5" height="5"/><rect x="9" y="9" width="5" height="5"/></svg></button></div>' +
            '<span class="result-line">SHOWING ' + list.length + ' RESULTS</span>' +
          '</div>' +
          (list.length ? '<div class="cards' + gridCls + '">' + list.map(cardHtml).join('') + '</div>' :
            '<div class="empty"><div class="cross mar-cross"><i class="h"></i><i class="v"></i><i class="d"></i></div><h3>无匹配档案</h3><p>调整筛选条件或清除检索词</p></div>') +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ---------- detail --------------------------------------------------- */
  function viewDetail(id) {
    var it = byId(id);
    if (!it) return '<div class="wrap"><div class="empty"><h3>档案不存在</h3><p>' + esc(id) + '</p></div></div>';
    var tags = '<span class="tag' + (it.status === 'maintaining' ? ' accent' : '') + '">' + esc(it.statusLabel) + '</span>';
    if (it.loader) tags += '<span class="tag">' + loaderSvg(it.loader) + esc(it.loaderLabel || it.loader) + '</span>';
    if (it.minecraft) tags += '<span class="tag">MC ' + esc(it.minecraft) + '</span>';
    if (it.packVersion) tags += '<span class="tag">v' + esc(it.packVersion) + '</span>';

    var dlHtml = it.downloads.map(function (d) {
      var ico = d.icon ? '<img class="dl-ico" src="' + esc(d.icon) + '" alt="" onerror="this.style.display=\'none\'">' : '<span class="dl-ico" style="display:grid;place-items:center;color:var(--accent)">↧</span>';
      var url = d.link || d.lanzouLink || d.quarkLink || '#';
      var label = d.text || (d.lanzouLink && d.quarkLink ? '蓝奏云 / 夸克网盘' : '下载汉化');
      return '<a class="dl-btn" href="' + esc(url) + '" target="_blank" rel="noopener">' + ico +
        '<span class="dl-name">' + esc(label) + '</span><span class="dl-arrow">↗</span></a>' +
        (d.lanzouLink && d.quarkLink ? '<a class="dl-btn" href="' + esc(d.quarkLink) + '" target="_blank" rel="noopener"><span class="dl-ico" style="display:grid;place-items:center;color:var(--accent)">Q</span><span class="dl-name">夸克网盘</span><span class="dl-arrow">↗</span></a>' : '');
    }).join('');

    var linkIcons = { github: 'assets/imgs/svg/github.svg', bilibili: 'assets/imgs/svg/bilibili.svg', modrinth: 'assets/imgs/svg/modrinth.svg', curseforge: 'assets/imgs/svg/curseforge.svg', paratranz: 'assets/imgs/svg/paratranz.svg', planetminecraft: 'assets/imgs/svg/planetminecraft.svg' };
    var linksHtml = it.links.map(function (l) {
      var ico = linkIcons[l.id] ? '<img class="ico" src="' + linkIcons[l.id] + '" alt="">' : '<span class="ico" style="color:var(--accent)">↗</span>';
      return '<a class="link-chip" href="' + esc(l.url) + '" target="_blank" rel="noopener">' + ico + esc(l.label) + '<span style="margin-left:auto;color:var(--ink-3)">↗</span></a>';
    }).join('');

    var kv = [
      ['档案编号', it.id], ['原始名称', it.originalName || '—'],
      ['更新时间', it.updateDate || it.updateDateRaw || '待定'],
      ['加载器', it.loaderLabel || it.loader || '—'],
      ['MC 版本', it.minecraft || '—'], ['包版本', it.packVersion || '—']
    ].map(function (p) { return '<div class="kv"><dt>' + esc(p[0]) + '</dt><dd>' + esc(p[1]) + '</dd></div>'; }).join('');

    return '<div class="wrap">' +
      '<a class="detail-back" href="#/' + it.kind + '">← 返回 ' + esc(KIND_META[it.kind].label) + '索引</a>' +
      '<div class="detail">' +
        '<div class="detail-main">' +
          '<div class="detail-hero"><div class="detail-hd">' +
            (it.icon ? '<img class="detail-icon" src="' + esc(it.icon) + '" alt="">' : '<div class="detail-icon" style="display:grid;place-items:center;font:700 34px var(--display);color:var(--ink-3)">VM</div>') +
            '<div><h1>' + esc(it.title) + '</h1>' + (it.originalName ? '<div class="detail-original">' + esc(it.originalName) + '</div>' : '') +
            '<div class="detail-tags">' + tags + '</div></div>' +
          '</div>' + (it.description ? '<p class="detail-desc">' + esc(it.description) + '</p>' : '') + '</div>' +
          (it.bodyHtml ? '<article class="prose">' + it.bodyHtml.replace(/<!--DOWNLOAD_SLOT-->/g, '') + '</article>' : '') +
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
    if (parts[0] === 'detail' && parts[1]) return { kind: 'detail', id: decodeURIComponent(parts[1]) };
    if (KIND_META[parts[0]]) return { kind: parts[0] };
    return { kind: 'home' };
  }
  function navigate(hash) {
    var doRender = function () { if (location.hash === hash) render(); else location.hash = hash; };
    M.viewTransition(doRender);
  }
  function render() {
    var r = parseHash();
    if (r.kind !== 'detail') state.kind = r.kind;
    document.body.dataset.view = r.kind;
    var html;
    if (r.kind === 'home') html = viewHome();
    else if (r.kind === 'credits') html = viewCredits();
    else if (r.kind === 'detail') html = viewDetail(r.id);
    else html = viewCatalog(r.kind);
    main.innerHTML = '<div class="view">' + html + '</div>';
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

  // Bind card clicks after a scoped repaint (cards are the only replaced nodes).
  function bindListRegion() {
    main.querySelectorAll('.list-col [data-detail]').forEach(function (el) {
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
        if (c) c.textContent = body.classList.contains('collapsed') ? '+' : '−';
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
  addEventListener('hashchange', function () {
    var r = parseHash();
    if (r.kind !== state.kind || r.kind === 'detail') render();
  });
  document.getElementById('menuToggle').addEventListener('click', function () {
    var t = document.getElementById('tabs'), open = t.classList.toggle('open');
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
