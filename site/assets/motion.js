/* ==========================================================================
   Motion engine — hard-cut transitions, deterministic order, always self-removing.
   Namespace: window.VMMotion
   ========================================================================== */
(function () {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function mosaicOrder(n, seed) {
    var a = Array.from({ length: n }, function (_, i) { return i; }), r = mulberry32(seed);
    for (var i = n - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; }
    return a;
  }
  function reduced() { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; }

  /* ---------- dot field: the one allowed persistent decoration, below UI -- */
  var bgState = null;
  function bgTeardown() {
    if (!bgState) return;
    cancelAnimationFrame(bgState.raf);
    clearInterval(bgState.timer);
    removeEventListener('resize', bgState.onResize);
    bgState = null;
  }
  function initDotField() {
    bgTeardown();
    var canvas = document.getElementById('dotField');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var GRID = 24, MARK = GRID * 0.34, LW = Math.max(0.9, MARK * 0.2);
    var dpr = Math.min(devicePixelRatio || 1, 2);
    var w = 0, h = 0, cols = 0, rows = 0;
    var accent = getComputedStyle(document.documentElement).getPropertyValue('--mar-accent').trim() || '#C0FE04';

    function size() {
      w = innerWidth; h = innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / GRID); rows = Math.ceil(h / GRID);
    }
    function draw(t) {
      ctx.clearRect(0, 0, w, h);
      var breathe = 0.05 + 0.028 * (0.5 + 0.5 * Math.sin(t / 2600));
      ctx.globalAlpha = breathe;
      ctx.strokeStyle = accent; ctx.fillStyle = accent; ctx.lineWidth = LW;
      for (var gy = 0; gy < rows; gy++) {
        for (var gx = 0; gx < cols; gx++) {
          var x = gx * GRID + GRID / 2, y = gy * GRID + GRID / 2;
          var zone = (gx < cols / 2 ? 0 : 1) + (gy < rows / 2 ? 0 : 2);
          ctx.beginPath();
          if (zone === 0) { ctx.rect(x - MARK / 2, y - MARK / 2, MARK, MARK); }
          else if (zone === 1) { ctx.moveTo(x - MARK / 2, y); ctx.lineTo(x + MARK / 2, y); ctx.moveTo(x, y - MARK / 2); ctx.lineTo(x, y + MARK / 2); }
          else if (zone === 2) { ctx.moveTo(x, y - MARK / 2); ctx.lineTo(x + MARK / 2, y); ctx.lineTo(x, y + MARK / 2); ctx.lineTo(x - MARK / 2, y); ctx.closePath(); }
          else { ctx.arc(x, y, MARK / 2, 0, Math.PI * 2); }
          if (zone === 3) ctx.fill(); else ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
    size();
    draw(0);
    var raf = 0, timer = 0;
    if (!reduced()) {
      var start = performance.now();
      (function loop(now) { draw(now - start); raf = requestAnimationFrame(loop); })(start);
      timer = setInterval(function () {
        accent = getComputedStyle(document.documentElement).getPropertyValue('--mar-accent').trim() || accent;
      }, 1500);
    }
    var onResize = function () { size(); draw(0); };
    addEventListener('resize', onResize);
    bgState = { raf: raf, timer: timer, onResize: onResize };
  }

  /* ---------- slice transition + viewport corner brackets -------------- */
  function viewTransition(mid) {
    if (reduced()) { mid(); return; }
    var vh = innerHeight;
    var N = 12;                       // horizontal slices
    var sliceH = vh / N;
    var order = mosaicOrder(N, 0x4d415243);   // deterministic, no Math.random
    var layer = document.createElement('div');
    layer.className = 'vt-mosaic';
    var slices = [];
    for (var i = 0; i < N; i++) {
      var s = document.createElement('div');
      s.className = 'vt-slice';
      s.style.top = (i * sliceH).toFixed(2) + 'px';
      s.style.height = (sliceH + 1).toFixed(2) + 'px';
      layer.appendChild(s); slices.push(s);
    }
    // corner brackets: four L-shaped marks at the real viewport corners
    var corners = document.createElement('div');
    corners.className = 'vt-corners';
    ['tl', 'tr', 'bl', 'br'].forEach(function (c) {
      var k = document.createElement('i');
      k.className = 'vt-corner ' + c;
      corners.appendChild(k);
    });

    var DUR = 0.22, STEP = 0.028, HEAD = 2;
    var pos = {};
    order.forEach(function (idx, rank) { pos[idx] = rank; });
    slices.forEach(function (s, i) {
      var rank = pos[i];
      s.style.animationDelay = (rank < HEAD ? 0 : (rank - HEAD) * STEP).toFixed(4) + 's';
    });

    document.body.appendChild(layer);
    document.body.appendChild(corners);
    // content swap happens while slices still cover the screen (no acid flash)
    var swapAt = (HEAD * STEP + DUR * 1000 * 0.45);
    var swapped = false;
    setTimeout(function () { if (!swapped) { swapped = true; mid(); } }, swapAt);

    function cleanup() {
      if (!swapped) { swapped = true; mid(); }
      if (layer.parentNode) layer.remove();
      if (corners.parentNode) corners.remove();
    }
    var total = HEAD * STEP * 1000 + (N - HEAD) * STEP * 1000 + DUR * 1000 + 60;
    setTimeout(cleanup, total);
    setTimeout(cleanup, 1500); // watchdog: never leave the UI covered
  }

  /* ---------- scoped slice transition (for in-page list refresh) ------
     Same visual language as viewTransition but confined to a host element.
     The surrounding chrome (top bar, filter rail, tabs) never darkens. */
  function scopedTransition(host, mid) {
    if (reduced() || !host) { mid(); return; }
    var w = host.clientWidth, h = host.clientHeight;
    if (w < 40 || h < 40) { mid(); return; }
    var N = 8;
    var sliceH = h / N;
    var order = mosaicOrder(N, 0x4d415243);
    var layer = document.createElement('div');
    layer.className = 'vt-mosaic scoped';
    var slices = [];
    for (var i = 0; i < N; i++) {
      var s = document.createElement('div');
      s.className = 'vt-slice';
      s.style.top = (i * sliceH).toFixed(2) + 'px';
      s.style.height = (sliceH + 1).toFixed(2) + 'px';
      layer.appendChild(s); slices.push(s);
    }
    var corners = document.createElement('div');
    corners.className = 'vt-corners scoped';
    ['tl', 'tr', 'bl', 'br'].forEach(function (c) {
      var k = document.createElement('i');
      k.className = 'vt-corner ' + c;
      corners.appendChild(k);
    });

    var DUR = 0.20, STEP = 0.026, HEAD = 2;
    var pos = {};
    order.forEach(function (idx, rank) { pos[idx] = rank; });
    slices.forEach(function (s, i) {
      var rank = pos[i];
      s.style.animationDelay = (rank < HEAD ? 0 : (rank - HEAD) * STEP).toFixed(4) + 's';
    });

    host.appendChild(layer);
    host.appendChild(corners);
    var swapAt = HEAD * STEP + DUR * 1000 * 0.4;
    var swapped = false;
    setTimeout(function () { if (!swapped) { swapped = true; mid(); } }, swapAt);

    function cleanup() {
      if (!swapped) { swapped = true; mid(); }
      if (layer.parentNode) layer.remove();
      if (corners.parentNode) corners.remove();
    }
    var total = HEAD * STEP * 1000 + (N - HEAD) * STEP * 1000 + DUR * 1000 + 60;
    setTimeout(cleanup, total);
    setTimeout(cleanup, 1200);
  }

  /* ---------- one-shot boot sequence ---------------------------------- */
  function boot() {
    var host = document.getElementById('bootHost');
    if (!host) return;
    if (reduced()) { host.remove(); return; }
    var lines = [
      'INIT NEURAL LINK…', 'MOUNT ARCHIVE INDEX…', 'CALIBRATE GRID…',
      'LOAD 100 RECORDS…', 'VERIFY LINK INTEGRITY…', 'UPLINK ESTABLISHED'
    ];
    var log = document.getElementById('bootLog');
    var bar = document.getElementById('bootProgress');
    var done = false;
    function finish() {
      if (done) return; done = true;
      removeEventListener('pointerdown', finish, true);
      removeEventListener('keydown', finish, true);
      host.classList.add('off');
      setTimeout(function () { if (host.parentNode) host.remove(); }, 300);
    }
    lines.forEach(function (line, i) {
      setTimeout(function () {
        var d = document.createElement('div');
        d.innerHTML = '<b>&gt;</b> ' + line;
        log.appendChild(d);
        bar.style.width = Math.round((i + 1) / lines.length * 100) + '%';
      }, 130 + i * 170);
    });
    setTimeout(finish, 130 + lines.length * 170 + 380);
    setTimeout(finish, 6000); // watchdog: never leave a black screen
    addEventListener('pointerdown', finish, true);
    addEventListener('keydown', finish, true);
  }

  /* ---------- one-shot reveals ---------------------------------------- */
  // Hard-cut reveal for a media slot that has just become ready.
  function mediaReveal(el) {
    if (!el || reduced()) return;
    el.classList.remove('is-revealing');
    void el.offsetWidth;              // restart animation
    el.classList.add('is-revealing');
    setTimeout(function () { el.classList.remove('is-revealing'); }, 400);
  }

  // Detail entry: crosshair then four quadrants clear in a fixed [0,1,3,2]
  // order. Layer lives inside the target panel and removes itself.
  function detailIntro(host) {
    if (!host || reduced()) return;
    var layer = document.createElement('div');
    layer.className = 'detail-reveal';
    var order = [0, 1, 3, 2];          // TL -> TR -> BR -> BL
    var quads = [];
    for (var i = 0; i < 4; i++) {
      var q = document.createElement('i');
      q.className = 'quad';
      layer.appendChild(q); quads.push(q);
    }
    var cross = document.createElement('div');
    cross.className = 'cross mar-cross';
    cross.innerHTML = '<i class="h"></i><i class="v"></i><i class="d"></i>';
    layer.appendChild(cross);
    host.appendChild(layer);

    var STEP = 0.08, AT = [0.5, 0.58, 0.66, 0.74];  // head then 3 steps
    order.forEach(function (idx, rank) {
      quads[idx].style.animationDelay = AT[rank].toFixed(4) + 's';
    });
    cross.style.animation = 'vt-out 0s .62s both';  // cross leaves with 2nd tile
    function done() { if (layer.parentNode) layer.remove(); }
    setTimeout(done, AT[3] * 1000 + 120);
    setTimeout(done, 1500);            // watchdog
  }

  window.VMMotion = {
    initDotField: initDotField,
    bgTeardown: bgTeardown,
    viewTransition: viewTransition,
    scopedTransition: scopedTransition,
    boot: boot,
    mediaReveal: mediaReveal,
    detailIntro: detailIntro,
    mosaicOrder: mosaicOrder,
    reduced: reduced
  };
})();
