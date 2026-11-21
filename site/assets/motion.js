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

  /* ---------- hero dot-matrix wordmark ---------------------------------
     "VMCT-CE" is sampled from the display face onto a dot lattice, then:
       1. ignition — letters light one after another, column by column
          inside each letter (a scan head crossing the glyph),
       2. scanline — one bright sweep verifies the whole word,
       3. breath — the settled wordmark pulses very slowly.
     Deterministic (no Math.random), self-measuring, and it tears itself
     down as soon as its canvas leaves the document. */
  var heroState = null;
  function heroTeardown() {
    if (!heroState) return;
    cancelAnimationFrame(heroState.raf);
    clearInterval(heroState.timer);
    clearTimeout(heroState.resizeT);
    removeEventListener('resize', heroState.onResize);
    heroState = null;
  }
  function initHeroGlyph(canvas) {
    heroTeardown();
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    var WORD = 'VMCT-CE';
    var FONT = "'Maratype', 'Arial Black', Impact, sans-serif";
    var LETTER_GAP = 250;   // ms between letter ignitions
    var IGNITE = 300;       // ms for one letter to light, column by column
    var FADE = 130;         // ms for a single dot to reach its level
    var SCAN_DUR = 760;     // ms for the verification sweep
    var dpr = Math.min(devicePixelRatio || 1, 2);
    var pts = [], ranges = [];
    var bw = 0, bh = 0, step = 8, dot = 3, x0 = 0, wordW = 0, capH = 0;
    var accent = getComputedStyle(document.documentElement).getPropertyValue('--mar-accent').trim() || '#C0FE04';
    var NEUTRAL = [223, 222, 224];   // dead cells: the matrix's grey texture
    var BRIGHT = [234, 255, 178];    // sweep highlight — a colour, never a drawn line
    var startAt = 0;

    // stable per-coordinate noise: identical layout on every load
    function hash(x, y) {
      var h = (x * 374761393 + y * 668265263) ^ 0x5bf03635;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }
    function hexRGB(h) {
      h = String(h || '').replace('#', '').trim();
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var n = parseInt(h, 16);
      return h.length === 6 && !isNaN(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [192, 254, 4];
    }
    function mix(a, b, u) {
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
    }
    function css(c) {
      return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';
    }
    function measure(octx, text) {
      var m = octx.measureText(text);
      return m && m.width ? m.width : 0;
    }

    // Fit the word into the box, draw it once offscreen, keep every lit
    // pixel as a dot tagged with its letter index and column fraction.
    function sample() {
      pts = [];
      var W = canvas.clientWidth, H = canvas.clientHeight;
      if (W < 60 || H < 60) return false;
      var off = document.createElement('canvas');
      var octx = off.getContext('2d');
      if (!octx) return false;
      bw = W; bh = H;
      off.width = Math.ceil(W); off.height = Math.ceil(H);

      var probe = 100;
      octx.font = '700 ' + probe + 'px ' + FONT;
      var w100 = measure(octx, WORD);
      if (!w100) return false;
      var size = probe * (W * 0.97) / w100;
      if (size * 0.74 > H * 0.92) size = H * 0.92 / 0.74;   // cap-height fit
      octx.font = '700 ' + size + 'px ' + FONT;

      var total = measure(octx, WORD);
      if (!total) return false;
      x0 = (W - total) / 2;
      ranges = [];
      var cursor = x0;
      for (var i = 0; i < WORD.length; i++) {
        var w = measure(octx, WORD[i]) || size * 0.6;
        ranges.push([cursor, cursor + w]);
        cursor += w;
      }
      wordW = total;
      capH = size * 0.72;
      octx.fillStyle = '#fff';
      octx.fillText(WORD, x0, H / 2 + capH / 2);

      var img = null;
      try { img = octx.getImageData(0, 0, off.width, off.height); } catch (e) { img = null; }
      if (!img || !img.data) return false;

      step = Math.max(5, Math.min(14, Math.round(size / 11)));
      dot = Math.max(2, step * 0.46);
      var data = img.data, W2 = off.width, H2 = off.height;
      for (var gy = 0; gy < H2; gy += step) {
        for (var gx = 0; gx < W2; gx += step) {
          if (data[(gy * W2 + gx) * 4 + 3] < 110) continue;
          // nearest letter range; tolerate side bearings around the glyph
          var best = -1, bd = 1e9;
          for (var r = 0; r < ranges.length; r++) {
            var d = gx < ranges[r][0] ? ranges[r][0] - gx : (gx > ranges[r][1] ? gx - ranges[r][1] : 0);
            if (d < bd) { bd = d; best = r; }
          }
          if (best < 0 || bd > step * 1.6) continue;
          var rr = ranges[best];
          var j = hash(gx, gy);
          pts.push({
            x: gx, y: gy, li: best,
            f: rr[1] > rr[0] ? (gx - rr[0]) / (rr[1] - rr[0]) : 0,
            dead: j > 0.94          // a few unlit cells give the matrix texture
          });
        }
      }
      return pts.length > 0;
    }

    function sizeCanvas() {
      var W = canvas.clientWidth, H = canvas.clientHeight;
      if (W < 60 || H < 60) return false;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return true;
    }

    function draw(now) {
      ctx.clearRect(0, 0, bw, bh);
      if (!pts.length) return;
      var t = now - startAt;
      var wordEnd = (WORD.length - 1) * LETTER_GAP + IGNITE + FADE;
      var scanStart = wordEnd + 140;
      var scanning = t >= scanStart && t < scanStart + SCAN_DUR;
      var sweep = scanning
        ? x0 - 24 + ((t - scanStart) / SCAN_DUR) * (wordW + 48)
        : -1e9;

      var rgb = hexRGB(accent);
      var dim = [rgb[0] * 0.3, rgb[1] * 0.3, rgb[2] * 0.3];
      var nDim = [NEUTRAL[0] * 0.3, NEUTRAL[1] * 0.3, NEUTRAL[2] * 0.3];

      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        var appear = (t - p.li * LETTER_GAP - p.f * IGNITE) / FADE;
        if (appear <= 0) continue;
        if (appear > 1) appear = 1;
        // breath: a slow colour swell (~16s per cycle) reading across the word
        var breath = 0.5 + 0.5 * Math.sin(t / 2600 - (p.x + p.y * 0.6) / 90);
        // verification pass: nearby cells warm toward white — a colour wave,
        // no drawn line
        var d = p.x - sweep;
        if (d < 0) d = -d;
        var s = d < 64 ? 1 - d / 64 : 0;
        var base = p.dead
          ? mix(nDim, NEUTRAL, breath)
          : mix(dim, rgb, 0.32 + 0.68 * breath);
        if (s > 0) base = mix(base, BRIGHT, s * 0.85);
        var a = appear * 0.95 + s * 0.3;
        if (a <= 0.02) continue;
        ctx.globalAlpha = a > 1 ? 1 : a;
        ctx.fillStyle = css(base);
        ctx.fillRect(p.x - dot / 2, p.y - dot / 2, dot, dot);
      }
      ctx.globalAlpha = 1;
    }

    function drawStatic() {
      startAt = performance.now() - 1e7;   // everything lit, sweep already past
      draw(performance.now());
    }
    function loop(now) {
      if (!heroState || heroState.canvas !== canvas || !canvas.isConnected) { heroTeardown(); return; }
      draw(now);
      heroState.raf = requestAnimationFrame(loop);
    }

    var onResize = function () {
      if (!heroState || heroState.canvas !== canvas) return;
      clearTimeout(heroState.resizeT);
      heroState.resizeT = setTimeout(function () {
        if (!heroState || heroState.canvas !== canvas || !canvas.isConnected) return;
        if (!(sizeCanvas() && sample())) return;
        if (reduced()) { drawStatic(); return; }
        if (!heroState.raf) {          // host was zero-sized at first paint
          startAt = performance.now();
          heroState.raf = requestAnimationFrame(loop);
        }
      }, 160);
    };

    heroState = { canvas: canvas, raf: 0, timer: 0, resizeT: 0, onResize: onResize };
    addEventListener('resize', onResize);

    // the display face may still be swapping in: re-sample once it is ready
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(function () {
        if (!heroState || heroState.canvas !== canvas || !canvas.isConnected) return;
        if (!sample()) return;
        if (reduced()) { drawStatic(); return; }
        if (!heroState.raf) {
          startAt = performance.now();
          heroState.raf = requestAnimationFrame(loop);
        }
      });
    }

    if (!sizeCanvas()) return;        // zero-sized host: retry on resize
    sample();
    if (reduced()) { drawStatic(); return; }

    // hold ignition until the boot overlay lifts, unless it is already gone
    var booting = !!document.getElementById('bootHost');
    startAt = performance.now() + (booting ? 1560 : 0);
    heroState.timer = setInterval(function () {
      accent = getComputedStyle(document.documentElement).getPropertyValue('--mar-accent').trim() || accent;
    }, 1500);
    heroState.raf = requestAnimationFrame(loop);
  }

  window.VMMotion = {
    initDotField: initDotField,
    bgTeardown: bgTeardown,
    initHeroGlyph: initHeroGlyph,
    heroTeardown: heroTeardown,
    viewTransition: viewTransition,
    scopedTransition: scopedTransition,
    boot: boot,
    mediaReveal: mediaReveal,
    detailIntro: detailIntro,
    mosaicOrder: mosaicOrder,
    reduced: reduced
  };
})();
