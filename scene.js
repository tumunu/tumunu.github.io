/* tumunu.com — paper-cut collage of Rarotonga at night, drawn on a canvas.
   Torn edges re-tear a few times a second for a stop-motion feel.
   Respects prefers-reduced-motion (renders one still frame). */
(function () {
  "use strict";
  var cvs = document.getElementById("scene");
  var ctx = cvs.getContext("2d");
  var foot = document.getElementById("foot");
  var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var W, H, DPR, S, rng, grain, vignette;
  var VARIANTS = 3;          // torn-edge versions per shape, cycled for the stop-motion "boil"
  var FPS = 12;              // stop-motion frame rate

  /* ---------- randomness & noise ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function noise1(seed) {
    var r = mulberry32(seed), v = [];
    for (var i = 0; i < 512; i++) v.push(r() * 2 - 1);
    return function (x) {
      var i = Math.floor(x), f = x - i;
      var a = v[((i % 512) + 512) % 512], b = v[(((i + 1) % 512) + 512) % 512];
      var s = f * f * (3 - 2 * f);
      return a + (b - a) * s;
    };
  }

  /* ---------- torn paper geometry ---------- */
  // Subdivide a polygon's edges and push each point along the outward normal by noise.
  function roughen(poly, seed, amp, bias, step) {
    var n1 = noise1(seed), n2 = noise1(seed + 7), r = mulberry32(seed + 13);
    var area = 0, i, n = poly.length;
    for (i = 0; i < n; i++) {
      var p = poly[i], q = poly[(i + 1) % n];
      area += p[0] * q[1] - q[0] * p[1];
    }
    var sgn = area > 0 ? 1 : -1;
    var out = [], t = 0;
    for (i = 0; i < n; i++) {
      var x0 = poly[i][0], y0 = poly[i][1], x1 = poly[(i + 1) % n][0], y1 = poly[(i + 1) % n][1];
      var dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
      var nx = sgn * dy / L, ny = -sgn * dx / L;
      var k = Math.max(1, Math.ceil(L / step));
      for (var j = 0; j < k; j++) {
        var f = j / k; t += L / k;
        var d = (n1(t * 0.045) * 0.6 + n2(t * 0.22) * 0.32 + (r() - 0.5) * 0.55) * amp + bias;
        out.push([x0 + dx * f + nx * d, y0 + dy * f + ny * d]);
      }
    }
    return out;
  }
  function pathOf(pts) {
    var p = new Path2D();
    p.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
    p.closePath();
    return p;
  }
  function circle(cx, cy, r, n) {
    var pts = [];
    for (var i = 0; i < n; i++) { var a = i / n * Math.PI * 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    return pts;
  }
  function blob(cx, cy, r) {
    var ph = rng() * 6.28, ph2 = rng() * 6.28, pts = [];
    for (var i = 0; i < 40; i++) {
      var a = i / 40 * Math.PI * 2;
      var rr = r * (1 + 0.16 * Math.sin(3 * a + ph) + 0.08 * Math.sin(5 * a + ph2));
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.9]);
    }
    return pts;
  }
  function rect(x, y, w, h) { return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; }
  function star(cx, cy, r, rot) {
    var pts = [];
    for (var i = 0; i < 10; i++) {
      var a = rot + i * Math.PI / 5, rr = i % 2 ? r * 0.44 : r;
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    return pts;
  }
  function cloud(x0, y0, w, h) {
    var bumps = [], x = 0;
    var k = 0;
    while (x < w) {
      var mid = 1 - Math.abs((x / w) - 0.5) * 1.2;   // taller in the middle
      var br = h * (0.45 + rng() * 0.5) * (0.4 + 0.75 * mid);
      bumps.push([x + br * 0.8, br]); x += br * (0.7 + rng() * 0.45); k++;
    }
    var top = [];
    for (var i = 0; i <= 70; i++) {
      var xx = w * i / 70, y = 0;
      for (var b = 0; b < bumps.length; b++) {
        var d = xx - bumps[b][0], R = Math.min(bumps[b][1], w * 0.5);
        if (Math.abs(d) < R) y = Math.max(y, Math.sqrt(R * R - d * d));
      }
      var taper = Math.pow(Math.sin(Math.PI * xx / w), 0.45);
      top.push([x0 + xx, y0 - Math.max(y, h * 0.12) * taper]);
    }
    var under = [], ph = rng() * 6.28;
    for (var u = 40; u >= 0; u--) {
      var ux = w * u / 40, ut = Math.pow(Math.sin(Math.PI * ux / w), 0.6);
      under.push([x0 + ux, y0 + h * 0.12 * ut * (0.6 + 0.4 * Math.abs(Math.sin(ux / w * 9 + ph)))]);
    }
    return top.concat(under);
  }
  // Catmull-Rom smoothing for rolling hills
  function smooth(pts, per) {
    var out = [];
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (var j = 0; j < per; j++) {
        var t = j / per, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map(function (k) {
          return 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
        }));
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  /* ---------- paper layers ---------- */
  function layer(shape, o) {
    var lay = {
      color: o.color, core: o.core || null, tex: o.tex == null ? 0.5 : o.tex,
      shadow: o.shadow == null ? true : o.shadow, alpha: o.alpha == null ? 1 : o.alpha,
      ox: rng() * 320, oy: rng() * 320, face: [], coreP: []
    };
    var amp = o.amp == null ? 4 : o.amp, step = o.step || 3, seed = Math.floor(rng() * 1e6);
    var bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
    for (var v = 0; v < VARIANTS; v++) {
      var poly = typeof shape === "function" ? shape(v) : shape;
      for (var i = 0; i < poly.length; i++) {
        bx0 = Math.min(bx0, poly[i][0]); by0 = Math.min(by0, poly[i][1]);
        bx1 = Math.max(bx1, poly[i][0]); by1 = Math.max(by1, poly[i][1]);
      }
      lay.face.push(pathOf(roughen(poly, seed + v * 101, amp, 0, step)));
      if (lay.core) lay.coreP.push(pathOf(roughen(poly, seed + v * 101 + 50, amp * 1.2, amp * 0.9, step)));
    }
    var m = amp * 3 + 10;
    lay.bb = [bx0 - m, by0 - m, bx1 - bx0 + 2 * m, by1 - by0 + 2 * m];
    return lay;
  }

  function drawLayer(l, v, tf) {
    ctx.save();
    if (tf) {
      ctx.translate(tf.tx || 0, tf.ty || 0);
      if (tf.rot) { ctx.translate(tf.px, tf.py); ctx.rotate(tf.rot); ctx.translate(-tf.px, -tf.py); }
    }
    ctx.globalAlpha = l.alpha;
    var outer = l.core ? l.coreP[v] : l.face[v];
    if (l.shadow) {
      ctx.fillStyle = "rgba(6,8,24,.30)";
      ctx.translate(1.5, 3.5); ctx.fill(outer);
      ctx.fillStyle = "rgba(6,8,24,.13)";
      ctx.translate(1.2, 3.2); ctx.fill(outer);
      ctx.translate(-2.7, -6.7);
    }
    if (l.core) { ctx.fillStyle = l.core; ctx.fill(outer); }
    ctx.fillStyle = l.color; ctx.fill(l.face[v]);
    if (l.tex) {
      ctx.save();
      ctx.clip(outer);
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = l.tex * l.alpha;
      if (grain.setTransform) grain.setTransform(new DOMMatrix([1, 0, 0, 1, l.ox, l.oy]));
      ctx.fillStyle = grain;
      ctx.fillRect(l.bb[0], l.bb[1], l.bb[2], l.bb[3]);
      ctx.restore();
    }
    ctx.restore();
  }

  function makeGrain() {
    var c = document.createElement("canvas"), N = 320;
    c.width = c.height = N;
    var g = c.getContext("2d"), r = mulberry32(7), i;
    g.fillStyle = "#fff"; g.fillRect(0, 0, N, N);
    for (i = 0; i < 70; i++) {              // soft blotches, wrapped so the tile has no seams
      var x = r() * N, y = r() * N, rad = 18 + r() * 60, a = r() * 0.11;
      for (var ox = -N; ox <= N; ox += N) for (var oy = -N; oy <= N; oy += N) {
        var gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
        gr.addColorStop(0, "rgba(110,100,95," + a + ")");
        gr.addColorStop(1, "rgba(110,100,95,0)");
        g.fillStyle = gr; g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
      }
    }
    for (i = 0; i < 6000; i++) { g.fillStyle = "rgba(55,50,48," + (r() * 0.2) + ")"; g.fillRect(r() * N, r() * N, 1, 1); }
    g.lineWidth = 0.6;
    for (i = 0; i < 300; i++) {            // paper fibres
      var fx = r() * N, fy = r() * N, fa = r() * Math.PI * 2, fl = 4 + r() * 16;
      g.strokeStyle = "rgba(70,60,58," + (0.05 + r() * 0.13) + ")";
      g.beginPath(); g.moveTo(fx, fy);
      g.quadraticCurveTo(fx + Math.cos(fa + 0.5) * fl * 0.5, fy + Math.sin(fa + 0.5) * fl * 0.5, fx + Math.cos(fa) * fl, fy + Math.sin(fa) * fl);
      g.stroke();
    }
    return ctx.createPattern(c, "repeat");
  }

  /* ---------- scene ---------- */
  // A wobbly ellipse; the same phases give matching outlines at different sizes.
  function ellipseFn(cx, cy, rx, ry, wob) {
    var p1 = rng() * 6.28, p2 = rng() * 6.28, p3 = rng() * 6.28;
    return function (a, k) {
      k = k || 1;
      var m = 1 + wob * (0.5 * Math.sin(2 * a + p1) + 0.3 * Math.sin(3 * a + p2) + 0.2 * Math.sin(5 * a + p3));
      return [cx + Math.cos(a) * rx * k * m, cy + Math.sin(a) * ry * k * m];
    };
  }
  function ring(fn, k, n) {
    var pts = [];
    for (var i = 0; i < n; i++) pts.push(fn(i / n * Math.PI * 2, k));
    return pts;
  }

  function build() {
    W = window.innerWidth; H = window.innerHeight;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    cvs.width = Math.round(W * DPR); cvs.height = Math.round(H * DPR);
    rng = mulberry32(2026);
    if (!grain) grain = makeGrain();

    var portrait = H > W * 1.05;
    var s = Math.min(W, H) / 800;
    var fh = foot.offsetHeight;
    var bt = H - fh - 12;                       // top of the bottom strip
    var i;
    S = {};

    // Horizon and island placement
    var hz = portrait ? H * 0.36 : H * 0.4;
    var cx = W * 0.5;
    var cy = portrait ? hz + (bt - hz) * 0.48 : hz + (bt - hz) * 0.5;
    var reefRx = portrait ? W * 0.43 : Math.min(W * 0.25, H * 0.45);
    var reefRy = reefRx * 0.26;
    var peakH = reefRx * 0.5;
    S.hz = hz;

    // Moon, off to the side and smaller
    var R = portrait ? W * 0.095 : Math.min(H * 0.075, W * 0.06);
    var mx = portrait ? W * 0.76 : W * 0.8, my = portrait ? H * 0.15 : H * 0.2;
    S.m = { x: mx, y: my, R: R };
    S.moon = layer(circle(mx, my, R, 110), { color: "#E8D8A9", core: "#F7F0DD", amp: 1.4 * s + 0.8, step: 2.5, tex: 0.6 });
    S.craters = [];
    for (i = 0; i < 6; i++) {
      var ca = rng() * 6.28, cd = Math.sqrt(rng()) * R * 0.7, cr = R * (0.1 + rng() * 0.2);
      S.craters.push(layer(blob(mx + Math.cos(ca) * cd, my + Math.sin(ca) * cd, cr),
        { color: rng() < 0.6 ? "#D3BF8A" : "#F3EACB", shadow: false, amp: 1, step: 2, tex: 0.4, alpha: 0.8 }));
    }

    // Ocean, its torn top edge is the horizon
    S.ocean = layer(rect(-30, hz, W + 60, H - hz + 40), { color: "#1F3358", core: "#7E93B5", amp: 2 * s + 1, tex: 0.5 });
    S.ripples = [];
    for (i = 0; i < (portrait ? 4 : 6); i++) {
      var rw = (40 + rng() * 80) * s + 12, rh = (1.8 + rng() * 1.2) * s + 0.8;
      var ry0 = hz + 14 * s + rng() * (bt - hz - 30 * s);
      S.ripples.push({
        l: layer(rect(0, ry0, rw, rh), { color: "#2C4A75", shadow: false, amp: 0.8, step: 2, tex: 0.3 }),
        w: rw, off: rng() * (W + rw), sp: (5 + rng() * 7) * s
      });
    }

    // Moonlight on the open ocean, below the moon
    S.refl = [];
    var rn = portrait ? 8 : 10;
    for (i = 0; i < rn; i++) {
      (function (i) {
        var f = (i + 0.3 + rng() * 0.4) / rn;
        var y = hz + 6 * s + (bt - hz - 14 * s) * f, h = (1.6 + rng() * 2.2) * s + 0.8;
        var spread = R * (1.0 + 2.6 * f), a = 0.35 + rng() * 0.4;
        S.refl.push(layer(function () {
          var w = R * (0.2 + 0.7 * f) * (0.6 + rng() * 0.9);
          return rect(mx + (rng() - 0.5) * spread - w / 2, y + (rng() - 0.5) * 2 * s, w, h);
        }, { color: rng() < 0.7 ? "#E9D9A6" : "#F6EED8", shadow: false, amp: 0.8, step: 2, tex: 0.3, alpha: a }));
      })(i);
    }

    // The island: reef ring, lagoon, beach, land
    var reef = ellipseFn(cx, cy + reefRy * 0.08, reefRx, reefRy, 0.05);
    S.reef = layer(ring(reef, 1.0, 120), { color: "#ECE5D2", core: "#FFFDF6", amp: 1.8 * s + 0.8, step: 2.5, tex: 0.35 });
    S.lagoon = layer(ring(reef, 0.965, 120), { color: "#2E7480", core: "#9FC4C0", amp: 1.4 * s + 0.6, step: 2.5, tex: 0.4, shadow: false });

    var landRx = reefRx * 0.82, landRy = reefRy * 0.74, lcy = cy - reefRy * 0.14;
    var land = ellipseFn(cx - reefRx * 0.02, lcy, landRx, landRy, 0.07);
    S.beach = layer(ring(land, 1.04, 110), { color: "#BFAF88", core: "#EEE4CA", amp: 1.2 * s + 0.6, step: 2.5, tex: 0.4, shadow: false });
    S.land = layer(ring(land, 1.0, 110), { color: "#1E3B32", core: "#4E6B5C", amp: 1.4 * s + 0.6, step: 2.5, tex: 0.5 });

    // Motu islets in the front of the lagoon
    S.motus = [[0.36, 0.55], [0.5, 0.42], [0.66, 0.6]].map(function (o) {
      var a = Math.PI * o[0];
      var p1 = land(a, 1.02), p2 = reef(a, 0.965);
      var px = p1[0] + (p2[0] - p1[0]) * 0.55, pyy = p1[1] + (p2[1] - p1[1]) * 0.55;
      var mrx = reefRx * 0.07 * o[1] * 1.6, mry = mrx * 0.32;
      return layer(blob(px, pyy, mrx).map(function (p) { return [p[0], pyy + (p[1] - pyy) * (mry / mrx) / 0.9]; }),
        { color: "#22463B", core: "#D9CDA9", amp: 0.9 * s + 0.4, step: 2, tex: 0.45 });
    });

    // Mountains rising from the middle of the land
    var baseY = lcy + landRy * 0.05, ms = landRx * 0.94;
    var back = [[-1, 0], [-.86, .16], [-.72, .3], [-.6, .26], [-.52, .46], [-.42, .4], [-.33, .6], [-.24, .52], [-.15, .76],
                [-.08, .68], [0, .92], [.06, .8], [.13, .86], [.2, .68], [.29, .64], [.36, .7], [.39, .64], [.41, .84],
                [.425, .9], [.44, .82], [.47, .58], [.54, .5], [.66, .36], [.8, .2], [.92, .08], [1, 0]];
    function footArc(k) {                       // the land's front arc, right to left
      var out = [];
      for (var j = 0; j <= 30; j++) out.push(land(Math.PI * j / 30, k));
      return out;
    }
    var backPoly = back.map(function (p) { return [cx + p[0] * ms, baseY - p[1] * peakH]; }).concat(footArc(0.96));
    S.back = layer(backPoly, { color: "#2D4858", core: "#7F94A0", amp: 1.8 * s + 0.8, step: 2.5, tex: 0.55 });

    var ridge = [[-.98, 0], [-.8, .12], [-.66, .2], [-.5, .16], [-.36, .32], [-.2, .26], [-.06, .4], [.08, .32], [.22, .42], [.36, .3],
                 [.52, .34], [.68, .2], [.84, .12], [.98, 0]];
    var ridgePoly = smooth(ridge.map(function (p) { return [cx + p[0] * ms * 1.05, baseY + landRy * 0.15 - p[1] * peakH]; }), 6)
      .concat(footArc(0.97));
    S.ridge = layer(ridgePoly, { color: "#24443A", core: "#5E7A6C", amp: 1.5 * s + 0.6, step: 2.5, tex: 0.55 });

    // Coastal plain: the front half of the land, covering the base of the hills
    var plain = [];
    var a0 = 0.02 * Math.PI, a1 = 0.98 * Math.PI;
    for (i = 0; i <= 50; i++) plain.push(land(a0 + (a1 - a0) * i / 50, 1.0));
    for (i = 50; i >= 0; i--) {
      var aa = a0 + (a1 - a0) * i / 50, q = land(aa, 1.0);
      plain.push([q[0], q[1] - landRy * (0.08 + 0.32 * Math.sin(aa)) - rng() * landRy * 0.05]);
    }
    S.plain = layer(plain, { color: "#1C3A30", core: "#4E6B5C", amp: 1.2 * s + 0.5, step: 2.5, tex: 0.5 });

    // keep stars clear of the space just above the peaks
    var cw = reefRx * 1.3, ch = peakH * 0.62, cloudBase = baseY - peakH * 0.72;

    // A few stars
    S.stars = [];
    var tries = 0, count = portrait ? 7 : 10;
    var skyTop = portrait ? H * 0.07 : H * 0.1;
    while (S.stars.length < count && tries++ < 600) {
      var sx = W * 0.04 + rng() * W * 0.92, sy = skyTop + rng() * (hz - skyTop - 24 * s);
      if (Math.hypot(sx - mx, sy - my) < R * 2.6) continue;
      if (sy > cloudBase - ch * 1.6 && Math.abs(sx - cx) < cw * 0.65) continue;
      var tooClose = S.stars.some(function (o) { return Math.hypot(o.x - sx, o.y - sy) < 60 * s; });
      if (tooClose) continue;
      var sr = (2.5 + rng() * 5) * s + 2, rot = rng() * 6.28, ph = Math.floor(rng() * 3);
      (function (sx, sy, sr, rot) {
        var st = layer(function () { return star(sx, sy, sr * (0.8 + rng() * 0.35), rot + (rng() - 0.5) * 0.12); },
          { color: "#EFE3C2", core: "#FFFBEF", amp: 0.5, step: 1.5, tex: 0.35 });
        st.ph = ph; st.x = sx; st.y = sy;
        S.stars.push(st);
      })(sx, sy, sr, rot);
    }

    // Frame strips, top and bottom
    var topH = portrait ? H * 0.05 : H * 0.065;
    S.top = layer([[-30, -40], [W + 30, -40], [W + 30, topH * 1.15], [W * 0.55, topH * 0.8], [-30, topH * 0.6]],
      { color: "#1A2245", core: "#D8CEB6", amp: 4 * s + 2, tex: 0.5 });
    S.bottom = layer([[-30, bt + 6], [W * 0.42, bt - 5], [W + 30, bt + 8], [W + 30, H + 40], [-30, H + 40]],
      { color: "#161C36", core: "#D8CEB6", amp: 4 * s + 2, tex: 0.5 });

    vignette = ctx.createRadialGradient(W / 2, H * 0.5, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.max(W, H) * 0.85);
    vignette.addColorStop(0, "rgba(10,12,30,0)");
    vignette.addColorStop(1, "rgba(10,12,30,.4)");
  }

  function wrapX(o, t) { return ((o.off + t * o.sp) % (W + o.w)) - o.w; }

  function render(t, v) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var m = S.m, i;

    // Sky sheet
    ctx.fillStyle = "#2B3461"; ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalCompositeOperation = "multiply"; ctx.globalAlpha = 0.5;
    if (grain.setTransform) grain.setTransform(new DOMMatrix());
    ctx.fillStyle = grain; ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // Moon glow, breathing slowly
    var b = 0.88 + 0.12 * Math.sin(t * 0.8);
    var g = ctx.createRadialGradient(m.x, m.y, m.R * 0.8, m.x, m.y, m.R * 4);
    g.addColorStop(0, "rgba(255,224,172," + (0.4 * b) + ")");
    g.addColorStop(0.35, "rgba(236,200,165," + (0.13 * b) + ")");
    g.addColorStop(1, "rgba(236,200,165,0)");
    ctx.fillStyle = g; ctx.fillRect(m.x - m.R * 4, m.y - m.R * 4, m.R * 8, m.R * 8);

    for (i = 0; i < S.stars.length; i++) drawLayer(S.stars[i], (v + S.stars[i].ph) % VARIANTS);

    drawLayer(S.moon, v);
    ctx.save(); ctx.clip(S.moon.face[v]);
    for (i = 0; i < S.craters.length; i++) drawLayer(S.craters[i], v);
    ctx.restore();

    drawLayer(S.ocean, v);
    for (i = 0; i < S.ripples.length; i++) drawLayer(S.ripples[i].l, v, { tx: wrapX(S.ripples[i], t) });
    for (i = 0; i < S.refl.length; i++) drawLayer(S.refl[i], v);

    drawLayer(S.reef, v);
    drawLayer(S.lagoon, v);
    drawLayer(S.beach, v);
    drawLayer(S.land, v);
    for (i = 0; i < S.motus.length; i++) drawLayer(S.motus[i], v);

    drawLayer(S.back, v);
    drawLayer(S.ridge, v);
    drawLayer(S.plain, v);

    ctx.fillStyle = vignette; ctx.fillRect(0, 0, W, H);

    drawLayer(S.top, v);
    drawLayer(S.bottom, v);
  }

  /* ---------- run ---------- */
  var start = performance.now(), last = -1e9, frame = 0, rafId = null;
  function loop(now) {
    rafId = requestAnimationFrame(loop);
    if (now - last < 1000 / FPS - 2) return;
    last = now; frame++;
    render((now - start) / 1000, Math.floor(frame / 3) % VARIANTS);
  }
  function startScene() {
    build();
    if (still) { render(0, 0); return; }
    if (rafId === null) rafId = requestAnimationFrame(loop);
  }

  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { build(); if (still) render(0, 0); }, 150);
  });
  startScene();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { build(); if (still) render(0, 0); });
})();
