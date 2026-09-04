# Delete with smoky dissolve (Pro)

## When to use

Deleting an image, card, or tile with weight: the element **shreds into smoke and sinks
under gravity** instead of blinking out. On delete, the card is snapshotted to a canvas
overlay, its edges tear through a scrolling noise field, the shape blurs and widens like
smoke, falls with a light sway and spin — and the opacity goes last, so the shredded
silhouette stays readable for most of the fall. Use for destructive-but-delightful
moments: removing a photo from a grid, dismissing a card, clearing an attachment.

Everything renders with plain `drawImage` calls (GPU-backed in every engine). There is
deliberately **no SVG filter**: WebKit runs those on the CPU and doesn't reliably repaint
animated filter primitives — this canvas pipeline is why the effect stays smooth in
Safari. Respect reduced motion by skipping straight to removal when
`prefers-reduced-motion` matches.

## HTML usage

```html
<div class="t-smoky-stage">
  <div class="t-smoky-card">
    <img alt="" src="/your-image.jpg" />
    <button type="button" class="t-smoky-delete" aria-label="Delete image">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    </button>
  </div>
  <!-- Dissolve render target — the driver sizes and positions it. -->
  <canvas class="t-smoky-canvas" aria-hidden="true"></canvas>
</div>
```

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--smoky-size` | `120px` | demo card size — size your own card freely |
| `--smoky-dur` | `550ms` | the dissolve timeline (fall + shred + fade) |
| `--smoky-gravity` | `150` | fall acceleration, px/s² |
| `--smoky-warp` | `30` | max shred displacement, px |
| `--smoky-warp-dur` | `2000ms` | shred build-up clock (`0` = follow the dissolve) |
| `--smoky-warp-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | shred build-up pacing |
| `--smoky-blur` | `12px` | max smoke blur |
| `--smoky-blur-ease` | `ease-in` | blur ramp |
| `--smoky-gravity-ease` | `ease-in` | reshapes WHEN the drop happens (linear = pure physics) |
| `--smoky-dissolve-ease` | `ease-out` | reshapes the whole timeline at once |
| `--smoky-sway` | `0px` | horizontal sway amplitude during the fall |
| `--smoky-spin` | `3deg` | rotation over the fall |
| `--smoky-churn` | `30` | noise-field drift speed — how alive the billowing is |
| `--smoky-spread` | `0` | % the smoke widens as it thins |
| `--smoky-respawn` | `800ms` | demo replay delay after the dissolve |

```css
:root {
  --smoky-size: 120px;
  --smoky-dur: 550ms;
  --smoky-gravity: 150;
  --smoky-warp: 30;
  --smoky-warp-dur: 2000ms;
  --smoky-warp-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --smoky-blur: 12px;
  --smoky-blur-ease: ease-in;
  --smoky-gravity-ease: ease-in;
  --smoky-dissolve-ease: ease-out;
  --smoky-sway: 0px;
  --smoky-spin: 3deg;
  --smoky-churn: 30;
  --smoky-spread: 0;
  --smoky-respawn: 800ms;
}
```

## CSS

```css
/* PRO6 — Delete image with smoky dissolve                       */
/* ============================================================ */
/* Clip the stage so the falling, shredding card dissolves inside
   its own cell instead of dropping over the next prototype. */
.t-smoky-stage {
  overflow: hidden;
  border-radius: 16px;
}

.t-smoky-card {
  position: relative;
  width: var(--smoky-size);
  height: var(--smoky-size);
  border-radius: 16px;
  overflow: hidden;
  background: #e9e9ec;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  /* No SVG/CSS filter here: WebKit renders SVG filters on the
     CPU (and doesn't reliably repaint animated filter
     primitives), so the dissolve is drawn on the .t-smoky-canvas
     overlay instead. The resting card stays a cheap composited
     layer. */
  will-change: transform, opacity;
}
/* Dissolve render target — JS sizes and positions it over the
   card (+ padding for the shreds' spill) at dissolve start, and
   drives the fall/sway/spin/fade with CSS transform/opacity on
   the element so the motion runs on the compositor (GPU) even
   while a texture frame is still being drawn. Transparent and
   inert outside a run. */
.t-smoky-canvas {
  position: absolute;
  z-index: 3;
  pointer-events: none;
  will-change: transform, opacity;
}

.t-smoky-card img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}

/* Quick soft re-entry after the dissolve, so the demo replays. */
.t-smoky-card.is-respawning {
  animation: t-smoky-respawn 250ms cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes t-smoky-respawn {
  from { opacity: 0; transform: scale(0.96); }
  to   { opacity: 1; transform: scale(1); }
}

/* Delete chip pinned to the image's top-left corner. Lives inside
   the card, so it shreds and falls along with it. */
.t-smoky-delete {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  color: #17181c;
  display: grid;
  place-items: center;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  -webkit-tap-highlight-color: transparent;
  transition: background-color 120ms ease;
}
.t-smoky-delete:hover { background: #ffffff; }
.t-smoky-delete:focus-visible {
  outline: 2px solid #17181c;
  outline-offset: 2px;
}
.t-smoky-delete svg { display: block; }
```

## JS

One rAF driver runs the whole effect so the layers stay in sync — position (½·g·t² fall
+ sway + spin on the compositor), deformation (tile displacement through scrolling value
noise), blur (separable box passes ≈ gaussian), spread, and the p^1.6 late fade. The
texture work runs at half frame rate and drops to half resolution once the blur takes
over; the element motion updates every frame, so the fall never stutters.

```js
// Read a numeric CSS custom property from :root (ms/s aware).
function readNum(name, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return fallback;
  if (raw.endsWith("ms")) return parseFloat(raw);
  if (raw.endsWith("s") && !raw.endsWith("ms")) return parseFloat(raw) * 1000;
  const n = parseFloat(raw);
  return isNaN(n) ? fallback : n;
}
function readStr(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Cubic-bezier sampler (Newton's method): turns a CSS easing string
// (keyword or cubic-bezier(...)) into a 0..1 -> 0..1 function, because the
// driver samples its easing curves per animation frame.
function makeEaseSampler(raw) {
  const kw = {
    linear: [0, 0, 1, 1],
    ease: [0.25, 0.1, 0.25, 1],
    "ease-in": [0.42, 0, 1, 1],
    "ease-out": [0, 0, 0.58, 1],
    "ease-in-out": [0.42, 0, 0.58, 1],
  };
  let c = kw[(raw || "").trim()];
  if (!c) {
    const m = (raw || "").match(
      /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/,
    );
    if (m) c = [+m[1], +m[2], +m[3], +m[4]];
  }
  if (!c) c = kw.ease;
  const [x1, y1, x2, y2] = c;
  const cx = 3 * x1,
    bx = 3 * (x2 - x1) - cx,
    ax = 1 - cx - bx;
  const cy = 3 * y1,
    by = 3 * (y2 - y1) - cy,
    ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const dxf = (t) => (3 * ax * t + 2 * bx) * t + cx;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-4) break;
      const d = dxf(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    return sy(t);
  };
}

// Create a dissolve controller for one card. `stage` is the clipping
// container, `card` the element to shred (its <img> + corner button are
// snapshotted), `canvas` the overlay render target. Set `respawn: false`
// and remove the card in `onComplete` for a real delete.
function createSmokyDissolve({ stage, card, canvas, respawn = true, onComplete }) {
  const ctx = canvas.getContext("2d");
  const workHalf = document.createElement("canvas"); // warp+blur at half res (blur hides it)
  const snap = document.createElement("canvas"); // card snapshot
  const whctx = workHalf.getContext("2d");
  let running = false;

  // Displacement state: the card snapshot's pixels
  // (PREMULTIPLIED, so bilinear sampling and the blur are
  // fringe-free at torn edges), the work buffer they're warped
  // into (card + pad on every side, in device px), a blur
  // scratch buffer, and a coarse lattice the noise is evaluated
  // on each frame (the field's wavelength is 28px, so
  // 4-device-px cells lose nothing; per-pixel values are
  // bilinear lerps).
  const LAT = 4;
  let snapPre, workData, halfData, blurTmp;
  let pad = 0,
    padDev = 0,
    latW = 0,
    latH = 0;
  let workW = 0,
    workH = 0,
    wW2 = 0,
    wH2 = 0;
  let latDX, latDY;

  // Separable box-blur passes over premultiplied RGBA.
  // Sliding-window sums make the cost independent of radius;
  // two H + two V passes approximate a gaussian. Done in JS
  // because canvas downscale/upscale blurs render differently
  // per engine — Safari's resampling shows its lattice as
  // pixelation. Pixels beyond the buffer count as transparent,
  // fading the smoke edges like a zero-padded gaussian.
  function boxH(srcA, dstA, w, h, r) {
    const inv = 1 / (2 * r + 1);
    for (let y = 0; y < h; y++) {
      const base = y * w * 4;
      let sr = 0,
        sg = 0,
        sb = 0,
        sa = 0;
      for (let x = 0; x <= r && x < w; x++) {
        const i = base + x * 4;
        sr += srcA[i];
        sg += srcA[i + 1];
        sb += srcA[i + 2];
        sa += srcA[i + 3];
      }
      for (let x = 0; x < w; x++) {
        const o = base + x * 4;
        dstA[o] = sr * inv;
        dstA[o + 1] = sg * inv;
        dstA[o + 2] = sb * inv;
        dstA[o + 3] = sa * inv;
        const xa = x + r + 1;
        if (xa < w) {
          const ia = base + xa * 4;
          sr += srcA[ia];
          sg += srcA[ia + 1];
          sb += srcA[ia + 2];
          sa += srcA[ia + 3];
        }
        const xs = x - r;
        if (xs >= 0) {
          const is = base + xs * 4;
          sr -= srcA[is];
          sg -= srcA[is + 1];
          sb -= srcA[is + 2];
          sa -= srcA[is + 3];
        }
      }
    }
  }
  // `straight` = un-premultiply inline while writing (used on
  // the LAST pass so putImageData gets straight alpha without
  // an extra full-buffer pass).
  function boxV(srcA, dstA, w, h, r, straight) {
    const stride = w * 4;
    const inv = 1 / (2 * r + 1);
    for (let x = 0; x < w; x++) {
      const base = x * 4;
      let sr = 0,
        sg = 0,
        sb = 0,
        sa = 0;
      for (let y = 0; y <= r && y < h; y++) {
        const i = base + y * stride;
        sr += srcA[i];
        sg += srcA[i + 1];
        sb += srcA[i + 2];
        sa += srcA[i + 3];
      }
      for (let y = 0; y < h; y++) {
        const o = base + y * stride;
        const aOut = sa * inv;
        if (straight && aOut > 0.5 && aOut < 254.6) {
          const k = 255 / aOut;
          dstA[o] = sr * inv * k;
          dstA[o + 1] = sg * inv * k;
          dstA[o + 2] = sb * inv * k;
        } else {
          dstA[o] = sr * inv;
          dstA[o + 1] = sg * inv;
          dstA[o + 2] = sb * inv;
        }
        dstA[o + 3] = aOut;
        const ya = y + r + 1;
        if (ya < h) {
          const ia = base + ya * stride;
          sr += srcA[ia];
          sg += srcA[ia + 1];
          sb += srcA[ia + 2];
          sa += srcA[ia + 3];
        }
        const ys = y - r;
        if (ys >= 0) {
          const is = base + ys * stride;
          sr -= srcA[is];
          sg -= srcA[is + 1];
          sb -= srcA[is + 2];
          sa -= srcA[is + 3];
        }
      }
    }
  }

  // Warp the premultiplied snapshot into dstArr — a dw×dh
  // buffer covering the work area at 1/s of device resolution
  // (s=1 full res, s=2 the half-res blur path) — through the
  // current noise lattice. The source fetch is BILINEAR (like
  // feDisplacementMap's smooth sampling; nearest-neighbour
  // reads as pixelation): interior pixels take the unchecked
  // fast path, the 1px rim is bounds-checked with transparent
  // padding. With `straight` the write is un-premultiplied
  // inline (putImageData wants straight alpha) so no extra
  // full-buffer pass is needed on the no-blur path.
  function remap(dstArr, dw, dh, s, straight) {
    const snapW = snap.width,
      snapH = snap.height;
    const src = snapPre;
    const invLat = 1 / LAT;
    let di = 0;
    for (let yD = 0; yD < dh; yD++) {
      const yF = yD * s;
      const gy = yF * invLat;
      const gy0 = gy | 0;
      const fy = gy - gy0;
      const row0 = gy0 * latW,
        row1 = row0 + latW;
      for (let xD = 0; xD < dw; xD++, di += 4) {
        const xF = xD * s;
        const gx = xF * invLat;
        const gx0 = gx | 0;
        const fx = gx - gx0;
        const a = row0 + gx0,
          b = row1 + gx0;
        const dxv =
          (latDX[a] + (latDX[a + 1] - latDX[a]) * fx) * (1 - fy) +
          (latDX[b] + (latDX[b + 1] - latDX[b]) * fx) * fy;
        const dyv =
          (latDY[a] + (latDY[a + 1] - latDY[a]) * fx) * (1 - fy) +
          (latDY[b] + (latDY[b + 1] - latDY[b]) * fx) * fy;
        const sxf = xF - padDev + dxv;
        const syf = yF - padDev + dyv;
        const sx0 = Math.floor(sxf);
        const sy0 = Math.floor(syf);
        let rC = 0,
          gC = 0,
          bC = 0,
          aC = 0;
        if (sx0 >= 0 && sx0 < snapW - 1 && sy0 >= 0 && sy0 < snapH - 1) {
          const u = sxf - sx0,
            v = syf - sy0;
          const w00 = (1 - u) * (1 - v),
            w10 = u * (1 - v);
          const w01 = (1 - u) * v,
            w11 = u * v;
          const i00 = (sy0 * snapW + sx0) * 4;
          const i10 = i00 + 4;
          const i01 = i00 + snapW * 4;
          const i11 = i01 + 4;
          rC = src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11;
          gC =
            src[i00 + 1] * w00 +
            src[i10 + 1] * w10 +
            src[i01 + 1] * w01 +
            src[i11 + 1] * w11;
          bC =
            src[i00 + 2] * w00 +
            src[i10 + 2] * w10 +
            src[i01 + 2] * w01 +
            src[i11 + 2] * w11;
          aC =
            src[i00 + 3] * w00 +
            src[i10 + 3] * w10 +
            src[i01 + 3] * w01 +
            src[i11 + 3] * w11;
        } else if (sx0 >= -1 && sx0 <= snapW - 1 && sy0 >= -1 && sy0 <= snapH - 1) {
          const u = sxf - sx0,
            v = syf - sy0;
          let w, si;
          if (sx0 >= 0 && sy0 >= 0) {
            w = (1 - u) * (1 - v);
            si = (sy0 * snapW + sx0) * 4;
            rC += src[si] * w;
            gC += src[si + 1] * w;
            bC += src[si + 2] * w;
            aC += src[si + 3] * w;
          }
          if (sx0 + 1 < snapW && sy0 >= 0) {
            w = u * (1 - v);
            si = (sy0 * snapW + sx0 + 1) * 4;
            rC += src[si] * w;
            gC += src[si + 1] * w;
            bC += src[si + 2] * w;
            aC += src[si + 3] * w;
          }
          if (sx0 >= 0 && sy0 + 1 < snapH) {
            w = (1 - u) * v;
            si = ((sy0 + 1) * snapW + sx0) * 4;
            rC += src[si] * w;
            gC += src[si + 1] * w;
            bC += src[si + 2] * w;
            aC += src[si + 3] * w;
          }
          if (sx0 + 1 < snapW && sy0 + 1 < snapH) {
            w = u * v;
            si = ((sy0 + 1) * snapW + sx0 + 1) * 4;
            rC += src[si] * w;
            gC += src[si + 1] * w;
            bC += src[si + 2] * w;
            aC += src[si + 3] * w;
          }
        } else {
          // Premultiplied: transparent must be all-zero or the
          // blur would bleed stale color back in.
          dstArr[di] = 0;
          dstArr[di + 1] = 0;
          dstArr[di + 2] = 0;
          dstArr[di + 3] = 0;
          continue;
        }
        if (straight && aC > 0.5 && aC < 254.6) {
          const k = 255 / aC;
          rC *= k;
          gC *= k;
          bC *= k;
        }
        dstArr[di] = rC;
        dstArr[di + 1] = gC;
        dstArr[di + 2] = bC;
        dstArr[di + 3] = aC;
      }
    }
  }

  // Deterministic two-octave value noise standing in for the
  // old feTurbulence (seed 4; base wavelength 28px matches the
  // 0.035 baseFrequency). Sampled once per tile per frame.
  const N = 64;
  const noiseR = new Float32Array(N * N);
  const noiseG = new Float32Array(N * N);
  (function seedNoise() {
    let s = 4;
    for (let i = 0; i < N * N; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      noiseR[i] = s / 2147483648 - 1;
      s = (s * 1664525 + 1013904223) >>> 0;
      noiseG[i] = s / 2147483648 - 1;
    }
  })();
  function gridAt(gArr, x, y) {
    const xi = Math.floor(x),
      yi = Math.floor(y);
    let fx = x - xi,
      fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % N) + N) % N,
      x1 = (x0 + 1) % N;
    const y0 = ((yi % N) + N) % N,
      y1 = (y0 + 1) % N;
    const top = gArr[y0 * N + x0] + (gArr[y0 * N + x1] - gArr[y0 * N + x0]) * fx;
    const bot = gArr[y1 * N + x0] + (gArr[y1 * N + x1] - gArr[y1 * N + x0]) * fx;
    return top + (bot - top) * fy;
  }
  // px, py in CSS pixels → [-1, 1]
  function noise2(gArr, px, py) {
    return (
      (gridAt(gArr, px / 28, py / 28) +
        0.5 * gridAt(gArr, px / 14 + 37.7, py / 14 + 11.3)) /
      1.5
    );
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let cardX = 0,
    cardY = 0,
    cardW = 0,
    cardH = 0;

  // Size the render targets to the stage and snapshot the card
  // (cover-cropped photo in a rounded clip + the delete button)
  // at device resolution. Runs at dissolve start so it always
  // matches current layout. padCss = how far the work buffer
  // pads out past the card (max displacement + blur spill) so
  // warped, blurred pixels aren't clipped.
  function prepare(padCss) {
    const sr = stage.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    cardX = cr.left - sr.left;
    cardY = cr.top - sr.top;
    cardW = cr.width;
    cardH = cr.height;
    snap.width = Math.max(1, Math.round(cardW * dpr));
    snap.height = Math.max(1, Math.round(cardH * dpr));
    pad = Math.min(Math.ceil(padCss) + 6, 80);
    padDev = Math.round(pad * dpr);
    workW = snap.width + padDev * 2;
    workH = snap.height + padDev * 2;
    // The visible canvas IS the work buffer (card + pad),
    // positioned over the card; the fall moves the ELEMENT via
    // CSS transform instead of redrawing a stage-sized canvas.
    canvas.width = workW;
    canvas.height = workH;
    canvas.style.left = cardX - pad + "px";
    canvas.style.top = cardY - pad + "px";
    canvas.style.width = cardW + pad * 2 + "px";
    canvas.style.height = cardH + pad * 2 + "px";
    // Resizing a canvas resets its context state, so the
    // resampling-quality hint has to be (re)applied here (it
    // shapes the half-res → full upscale draw).
    ctx.imageSmoothingQuality = "high";
    const sc = snap.getContext("2d");
    sc.setTransform(dpr, 0, 0, dpr, 0, 0);
    sc.clearRect(0, 0, cardW, cardH);
    const r = 16; // matches .t-smoky-card border-radius
    sc.beginPath();
    sc.moveTo(r, 0);
    sc.arcTo(cardW, 0, cardW, cardH, r);
    sc.arcTo(cardW, cardH, 0, cardH, r);
    sc.arcTo(0, cardH, 0, 0, r);
    sc.arcTo(0, 0, cardW, 0, r);
    sc.closePath();
    sc.clip();
    const img = card.querySelector("img");
    if (img && img.naturalWidth) {
      const s = Math.max(cardW / img.naturalWidth, cardH / img.naturalHeight);
      const dw = img.naturalWidth * s,
        dh = img.naturalHeight * s;
      sc.drawImage(img, (cardW - dw) / 2, (cardH - dh) / 2, dw, dh);
    } else {
      sc.fillStyle = "#e9e9ec";
      sc.fillRect(0, 0, cardW, cardH);
    }
    const bx = cardW - 8 - 12,
      by = 8 + 12;
    sc.beginPath();
    sc.arc(bx, by, 12, 0, Math.PI * 2);
    sc.fillStyle = "rgba(255, 255, 255, 0.92)";
    sc.fill();
    sc.strokeStyle = "#17181c";
    sc.lineWidth = 1.5;
    sc.lineCap = "round";
    sc.beginPath();
    sc.moveTo(bx - 3.5, by - 3.5);
    sc.lineTo(bx + 3.5, by + 3.5);
    sc.moveTo(bx + 3.5, by - 3.5);
    sc.lineTo(bx - 3.5, by + 3.5);
    sc.stroke();
    // Pixel buffers for the software displacement map + blur.
    // The snapshot is premultiplied once here — bilinear
    // sampling and the box blur then stay fringe-free.
    const sd = sc.getImageData(0, 0, snap.width, snap.height).data;
    snapPre = new Uint8ClampedArray(sd.length);
    for (let i = 0; i < sd.length; i += 4) {
      const aP = sd[i + 3];
      snapPre[i] = (sd[i] * aP) / 255;
      snapPre[i + 1] = (sd[i + 1] * aP) / 255;
      snapPre[i + 2] = (sd[i + 2] * aP) / 255;
      snapPre[i + 3] = aP;
    }
    workData = ctx.createImageData(workW, workH);
    wW2 = Math.ceil(workW / 2);
    wH2 = Math.ceil(workH / 2);
    workHalf.width = wW2;
    workHalf.height = wH2;
    halfData = whctx.createImageData(wW2, wH2);
    blurTmp = new Uint8ClampedArray(halfData.data.length);
    latW = Math.ceil(workW / LAT) + 2;
    latH = Math.ceil(workH / LAT) + 2;
    latDX = new Float32Array(latW * latH);
    latDY = new Float32Array(latW * latH);
  }

  function dissolve() {
    if (running) return;
    running = true;
    const durMs = readNum("--smoky-dur", 900);
    const g = readNum("--smoky-gravity", 900);
    const warp = readNum("--smoky-warp", 90);
    const warpDurRaw = readNum("--smoky-warp-dur", 0);
    const warpDurMs = warpDurRaw > 0 ? warpDurRaw : durMs;
    const maxBlur = readNum("--smoky-blur", 18);
    const sway = readNum("--smoky-sway", 14);
    const spin = readNum("--smoky-spin", 8);
    const churn = readNum("--smoky-churn", 70);
    const spread = readNum("--smoky-spread", 25);
    const warpEase = makeEaseSampler(readStr("--smoky-warp-ease"));
    const blurEase = makeEaseSampler(readStr("--smoky-blur-ease"));
    const gravityEase = makeEaseSampler(readStr("--smoky-gravity-ease"));
    const dissolveEase = makeEaseSampler(readStr("--smoky-dissolve-ease"));
    prepare(warp / 2 + maxBlur * 2);
    card.style.visibility = "hidden";
    const t0 = performance.now();
    let frame = 0;
    (function tick(now) {
      const t = (now - t0) / 1000;
      // rawP is real elapsed/duration, used only to know when
      // the dissolve is actually over. Every effect below reads
      // the RESHAPED p — the dissolve ease's whole job is to
      // speed up or hold back the entire timeline at once.
      const rawP = Math.min((now - t0) / Math.max(durMs, 1), 1);
      const p = dissolveEase(rawP);
      // teff replaces real elapsed time in the ½·g·t² fall, so
      // the gravity ease reshapes WHEN the drop happens without
      // changing g's px/s² meaning — linear leaves the physics
      // untouched.
      const teff = gravityEase(p) * (durMs / 1000);
      const fallY = 0.5 * g * teff * teff;
      const swayX = Math.sin(t * 5) * sway * p;
      // Warp runs on its own clock (--smoky-warp-dur) so the
      // shredding can build slower than the dissolve itself.
      const pw = Math.min((now - t0) / Math.max(warpDurMs, 1), 1);
      const dispScale = warp * warpEase(pw);
      const blur = maxBlur * blurEase(p);
      const alpha = 1 - Math.pow(p, 1.6);
      // Churn: slide the sample window through the noise field
      // (downward, with a light sideways waver) so the
      // billowing travels with the fall.
      const driftY = churn * t;
      const driftX = Math.sin(t * 3.2) * churn * 0.3;

      // 1) Texture — the software displacement map (same
      //    sampling rule as feDisplacementMap: output(x,y) =
      //    source(x + d.x, y + d.y)) plus the box-blur — runs
      //    at HALF frame rate: 30fps churn is imperceptible
      //    for smoke and it halves the JS cost. The motion
      //    below still updates every frame on the compositor,
      //    so the fall never stutters. While the blur is weak
      //    the shred renders at full device resolution; once
      //    it takes over (σ ≳ 1px) the whole warp+blur runs at
      //    half resolution — the blur hides the difference and
      //    the pixel work drops to a quarter.
      if (frame % 2 === 0 || rawP >= 1) {
        const halfDev = (dispScale / 2) * dpr;
        for (let ly = 0; ly < latH; ly++) {
          const py = (ly * LAT - padDev) / dpr;
          for (let lx = 0; lx < latW; lx++) {
            const px = (lx * LAT - padDev) / dpr;
            const li = ly * latW + lx;
            latDX[li] = halfDev * noise2(noiseR, px - driftX, py - driftY);
            latDY[li] = halfDev * noise2(noiseG, px - driftX, py - driftY);
          }
        }
        const rBox = blur > 0.3 ? Math.round(blur * dpr * 1.22) : 0;
        if (rBox >= 2) {
          remap(halfData.data, wW2, wH2, 2, false);
          const rHalf = Math.max(1, Math.round(rBox / 2));
          boxH(halfData.data, blurTmp, wW2, wH2, rHalf);
          boxH(blurTmp, halfData.data, wW2, wH2, rHalf);
          boxV(halfData.data, blurTmp, wW2, wH2, rHalf, false);
          // Final pass writes straight alpha for putImageData.
          boxV(blurTmp, halfData.data, wW2, wH2, rHalf, true);
          whctx.putImageData(halfData, 0, 0);
          ctx.clearRect(0, 0, workW, workH);
          ctx.drawImage(workHalf, 0, 0, wW2, wH2, 0, 0, workW, workH);
        } else {
          remap(workData.data, workW, workH, 1, true);
          ctx.putImageData(workData, 0, 0);
        }
      }
      frame++;

      // 2) Motion + fade on the ELEMENT — GPU-composited, so
      //    it stays smooth regardless of texture cost.
      canvas.style.transform =
        "translate(" +
        swayX.toFixed(1) +
        "px, " +
        fallY.toFixed(1) +
        "px)" +
        " rotate(" +
        (spin * p).toFixed(2) +
        "deg)" +
        // Spread: real smoke expands as it thins out.
        " scale(" +
        (1 + (spread / 100) * p).toFixed(3) +
        ")";
      canvas.style.opacity = alpha.toFixed(3);

      if (rawP < 1) {
        requestAnimationFrame(tick);
        return;
      }
      // Fully dissolved — clear and respawn for replay.
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.transform = "";
      canvas.style.opacity = "";
      window.setTimeout(
        function () {
          if (onComplete) onComplete();
          if (!respawn) {
            running = false;
            return;
          }
          // Demo replay: soft re-entry. Real apps usually remove the card
          // in onComplete instead (leave respawn: false).
          card.style.visibility = "";
          card.classList.remove("is-respawning");
          // eslint-disable-next-line no-unused-expressions
          card.offsetWidth;
          card.classList.add("is-respawning");
          running = false;
        },
        readNum("--smoky-respawn", 800),
      );
    })(t0);
  }

  card.addEventListener("animationend", function (e) {
    if (e.animationName === "t-smoky-respawn") {
      card.classList.remove("is-respawning");
    }
  });

  return { dissolve };
}
```

Wire it up:

```js
const stage = document.querySelector(".t-smoky-stage");
const card = stage.querySelector(".t-smoky-card");
const canvas = stage.querySelector(".t-smoky-canvas");

const { dissolve } = createSmokyDissolve({ stage, card, canvas });
stage.querySelector(".t-smoky-delete").addEventListener("click", dissolve);

// Real delete instead of the demo replay:
//   createSmokyDissolve({ stage, card, canvas, respawn: false,
//     onComplete: () => card.remove() });
```

## Notes

- **The canvas overlay is the smoke.** The driver sizes `.t-smoky-canvas` to the card
  plus padding for shreds + blur spill, snapshots the card (rounded clip, cover-cropped
  `<img>`, corner button) at device resolution, then hides the card and animates the
  canvas. Keep `overflow: hidden` on the stage so the fall clips inside it.
- **Snapshot, not live DOM:** anything visually inside the card beyond the image + the
  corner delete chip won't be in the smoke — the snapshot draws those two explicitly.
  Extend `prepare()` if your card carries more.
- The dissolve reads every token at start, so live-tweaking `--smoky-*` between runs
  works without re-init.
