# Image open tilt (Pro)

## When to use

An image/preview that zooms open the way iPadOS launches an app: fully transform-driven
(scale + rotateX/rotateY + translateZ under real perspective — nothing reflows), pitched
back in 3D strongest ~40% into the flight, settling flat by landing. Border radius
counter-morphs (32px → 16px) so the shrunken card keeps an icon-like corner. Close dives
back with a smaller opposite tilt on a faster clock. An optional **organic bend** bows
the whole card — image and rounded outline — as one continuous sheet mid-flight. The
bend is a software displacement warp drawn to a small canvas layer (SVG displacement
filters are not an option here: WebKit never loads `feImage` data-URI maps, so a filter
bend simply doesn't exist in Safari), which renders identically in every engine.

The card is laid out at its FULL size and shrunk to the preview purely with `scale`, so
the zoom runs as ONE continuous spring from press to landing while the tilt rides on
`transform` keyframes that compose with it — the flight never pauses at a waypoint.

## HTML usage

```html
<div class="t-opentilt-stage">
  <button type="button" class="t-opentilt-card" id="opentilt-card"
          aria-expanded="false" aria-label="Open image">
    <img class="t-opentilt-img" src="photo.jpg" alt="" />
    <!-- Bend render layer: JS draws the warped photo here during the
         flight. It inherits the card's scale/tilt transforms, so the 3D
         flight applies to the bent image for free. -->
    <canvas class="t-opentilt-canvas" aria-hidden="true"></canvas>
  </button>
</div>
```

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--opentilt-open-dur` | `620ms` | open flight |
| `--opentilt-close-dur` | `420ms` | close dive |
| `--opentilt-open-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | smooth-out; no overshoot so the zoom lands clean |
| `--opentilt-close-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | |
| `--opentilt-closed-scale` | `0.3` | preview size as a fraction of full |
| `--opentilt-tilt-x` | `22deg` | pitch at the tilt peak |
| `--opentilt-tilt-y` | `-14deg` | yaw at the tilt peak |
| `--opentilt-lift` | `70px` | translateZ toward the viewer at the peak |
| `--opentilt-perspective` | `900px` | stage perspective |
| `--opentilt-open-w` | `320px` | full (open) width |
| `--opentilt-open-h` | `240px` | full (open) height |
| `--opentilt-bend` | `28` | displacement strength (px) at the bend peak; negative flips the bow |
| `--opentilt-bend-dur` | `300ms` | bend clock — lets the bow finish EARLY in the flight (0 = follow the flight) |
| `--opentilt-bend-ease` | `ease-out` | shapes the 0→peak→0 envelope; peak hits when eased progress crosses 0.5 |

```css
:root {
  --opentilt-open-dur: 620ms;
  --opentilt-close-dur: 420ms;
  --opentilt-open-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --opentilt-close-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --opentilt-closed-scale: 0.3;
  --opentilt-tilt-x: 22deg;
  --opentilt-tilt-y: -14deg;
  --opentilt-lift: 70px;
  --opentilt-perspective: 900px;
  --opentilt-open-w: 320px;
  --opentilt-open-h: 240px;
  --opentilt-bend: 28;
  --opentilt-bend-dur: 300ms;
  --opentilt-bend-ease: ease-out;
}
```

## CSS

```css
/* The stage supplies the 3D perspective so the tilt reads as depth. */
.t-opentilt-stage {
  perspective: var(--opentilt-perspective);
}

.t-opentilt-card {
  appearance: none;
  border: 0;
  padding: 0;
  position: relative;
  width: var(--opentilt-open-w);
  height: var(--opentilt-open-h);
  border-radius: 32px;
  /* overflow stays VISIBLE (the rounded clip lives on the img via
     border-radius: inherit) so the bend canvas can bow past the box —
     and, critically, so overflow never toggles mid-flight: in Safari
     that would kick the card off its compositor layer and jank the
     scale/tilt spring. */
  overflow: visible;
  cursor: pointer;
  background: #eeeeef;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.06),
    0 2px 6px rgba(0, 0, 0, 0.05),
    0 4px 42px rgba(0, 0, 0, 0.06);
  -webkit-tap-highlight-color: transparent;
  transform-origin: center;
  /* The zoom lives on the separate `scale` property so it runs as ONE
     continuous spring, while the tilt rides on `transform` keyframes
     that peak mid-flight — the two compose. */
  scale: var(--opentilt-closed-scale);
  transform: rotateX(0deg) rotateY(0deg) translateZ(0);
  will-change: scale, transform;
  transition:
    scale var(--opentilt-close-dur) var(--opentilt-close-ease),
    border-radius var(--opentilt-close-dur) var(--opentilt-close-ease);
}

/* Bend render layer: hidden at rest; JS sizes it (with an inline
   negative inset so the bow can travel outside the card box) and
   draws the warped photo during the flight. */
.t-opentilt-canvas {
  position: absolute;
  display: none;
  pointer-events: none;
}
/* While bending, the canvas IS the card's visual: hide the flat
   photo + background so no straight-edged fill peeks out behind the
   bowed edges (the rounded clip is baked into the warp). The
   box-shadow stays — soft enough that not bending it is
   imperceptible, and it never flickers on/off this way. */
.t-opentilt-card.is-bending {
  background: transparent;
}
.t-opentilt-card.is-bending .t-opentilt-img { visibility: hidden; }
.t-opentilt-card.is-bending .t-opentilt-canvas { display: block; }

.t-opentilt-card.is-open {
  border-radius: 16px;
  scale: 1;
  transition:
    scale var(--opentilt-open-dur) var(--opentilt-open-ease),
    border-radius var(--opentilt-open-dur) var(--opentilt-open-ease);
  /* Tilt overlay: pitched back and lifting toward the viewer, strongest
     ~40% into the flight, settling flat by landing. */
  animation: t-opentilt-open var(--opentilt-open-dur) both;
}

/* Close dive: a smaller opposite tilt as it drops back into the preview
   (the base scale transition carries the shrink). */
.t-opentilt-card.is-closing {
  animation: t-opentilt-close var(--opentilt-close-dur) both;
}

@keyframes t-opentilt-open {
  0% {
    transform: rotateX(0deg) rotateY(0deg) translateZ(0);
    animation-timing-function: cubic-bezier(0.3, 0.7, 0.4, 1);
  }
  40% {
    transform:
      rotateX(var(--opentilt-tilt-x))
      rotateY(var(--opentilt-tilt-y))
      translateZ(var(--opentilt-lift));
    animation-timing-function: cubic-bezier(0.45, 0, 0.3, 1);
  }
  100% {
    transform: rotateX(0deg) rotateY(0deg) translateZ(0);
  }
}

@keyframes t-opentilt-close {
  0% {
    transform: rotateX(0deg) rotateY(0deg) translateZ(0);
    animation-timing-function: cubic-bezier(0.4, 0.4, 0.5, 1);
  }
  45% {
    transform:
      rotateX(calc(var(--opentilt-tilt-x) * -0.45))
      rotateY(calc(var(--opentilt-tilt-y) * -0.45))
      translateZ(calc(var(--opentilt-lift) * 0.4));
    animation-timing-function: cubic-bezier(0.45, 0, 0.3, 1);
  }
  100% {
    transform: rotateX(0deg) rotateY(0deg) translateZ(0);
  }
}

.t-opentilt-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  pointer-events: none;
  /* The rounded clip (tracks the card's animating radius). */
  border-radius: inherit;
}

@media (prefers-reduced-motion: reduce) {
  .t-opentilt-card,
  .t-opentilt-card.is-open { animation: none; transition: none; }
}
```

## JS

```js
(function initOpenTilt() {
  const card = document.getElementById("opentilt-card");
  if (!card) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Bend driver: a rAF envelope pushes the displacement 0 → peak → 0
  // (sin(π · ease(p)), peaking when the eased progress crosses 0.5;
  // close runs a smaller opposite bow). The warp is drawn in software
  // on the .t-opentilt-canvas layer — the displacement FIELD is
  //   Fy = 0.4116 · (1 − q²) − 0.41 + 0.09 · noise   q = (2x − w)/(1.4w)
  //   Fx = 0.0016 + 0.09 · noise
  // (a blurred horizontal parabola mixed 18% with low-frequency organic
  // noise, channels − 0.5), scaled by strength · sign · envelope.
  const img = card.querySelector(".t-opentilt-img");
  const canvas = card.querySelector(".t-opentilt-canvas");
  const cctx = canvas ? canvas.getContext("2d") : null;
  let bendRaf = null;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // Deterministic 2-octave value noise (≈110/70px wavelengths).
  const NZ = 64;
  const nzR = new Float32Array(NZ * NZ);
  const nzG = new Float32Array(NZ * NZ);
  (function seed() {
    let s = 11;
    for (let i = 0; i < NZ * NZ; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      nzR[i] = s / 2147483648 - 1;
      s = (s * 1664525 + 1013904223) >>> 0;
      nzG[i] = s / 2147483648 - 1;
    }
  })();
  function grid(g, x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % NZ) + NZ) % NZ, x1 = (x0 + 1) % NZ;
    const y0 = ((yi % NZ) + NZ) % NZ, y1 = (y0 + 1) % NZ;
    const top = g[y0 * NZ + x0] + (g[y0 * NZ + x1] - g[y0 * NZ + x0]) * fx;
    const bot = g[y1 * NZ + x0] + (g[y1 * NZ + x1] - g[y1 * NZ + x0]) * fx;
    return top + (bot - top) * fy;
  }
  function noise(g, px, py) {
    return (grid(g, px / 110, py / 70) +
            0.5 * grid(g, px / 55 + 37.7, py / 35 + 11.3)) / 1.5;
  }

  // Per-run state: unclipped photo snapshot + the displacement field
  // (per unit strength) on a coarse lattice — the field is ultra-smooth,
  // so 8-device-px cells lose nothing.
  const LAT = 8;
  let snapData = null, outData = null;
  let latFX = null, latFY = null, latW = 0, latH = 0;
  let pad = 0, padDev = 0, sw = 0, sh = 0;

  function prepareBend(strength) {
    const cw = card.offsetWidth, ch = card.offsetHeight;
    sw = Math.max(2, Math.round(cw * dpr));
    sh = Math.max(2, Math.round(ch * dpr));
    // Max |displacement| ≈ 0.30 · strength (parabola + noise).
    pad = Math.ceil(Math.abs(strength) * 0.32) + 4;
    padDev = Math.round(pad * dpr);
    // Canvas is a REPLACED element: absolute + inset does NOT stretch
    // it (it keeps its intrinsic attribute size), so the CSS box must
    // be sized explicitly.
    canvas.style.left = -pad + "px";
    canvas.style.top = -pad + "px";
    canvas.style.width = (cw + pad * 2) + "px";
    canvas.style.height = (ch + pad * 2) + "px";
    canvas.width = sw + padDev * 2;
    canvas.height = sh + padDev * 2;
    outData = cctx.createImageData(canvas.width, canvas.height);
    // Snapshot the cover-cropped photo UNCLIPPED — the rounded clip is
    // applied per pixel during the warp so the outline bends too.
    const sc = document.createElement("canvas");
    sc.width = sw;
    sc.height = sh;
    const scx = sc.getContext("2d");
    if (img && img.naturalWidth) {
      const k = Math.max(sw / img.naturalWidth, sh / img.naturalHeight);
      const dw = img.naturalWidth * k, dh = img.naturalHeight * k;
      scx.drawImage(img, (sw - dw) / 2, (sh - dh) / 2, dw, dh);
    }
    snapData = scx.getImageData(0, 0, sw, sh).data;
    latW = Math.ceil(canvas.width / LAT) + 2;
    latH = Math.ceil(canvas.height / LAT) + 2;
    latFX = new Float32Array(latW * latH);
    latFY = new Float32Array(latW * latH);
    for (let ly = 0; ly < latH; ly++) {
      const py = (ly * LAT - padDev) / dpr;
      for (let lx = 0; lx < latW; lx++) {
        const px = (lx * LAT - padDev) / dpr;
        const q = (2 * px - cw) / (1.4 * cw);
        const li = ly * latW + lx;
        latFX[li] = 0.0016 + 0.09 * noise(nzR, px, py);
        latFY[li] = 0.4116 * (1 - q * q) - 0.41 + 0.09 * noise(nzG, px, py);
      }
    }
  }

  function renderBend(s, rCss) {
    // Radius passed in analytically (see runBend) — reading
    // getComputedStyle here every frame forces a style recalc
    // mid-animation, which is cheap in Blink but expensive enough in
    // Safari to drop the bend to ~30fps.
    const rr = rCss * dpr;
    const W = canvas.width, H = canvas.height;
    const src = snapData, dst = outData.data;
    const sDev = s * dpr;
    const invLat = 1 / LAT;
    let di = 0;
    for (let y = 0; y < H; y++) {
      const gy = y * invLat, gy0 = gy | 0, fyL = gy - gy0;
      const row0 = gy0 * latW, row1 = row0 + latW;
      for (let x = 0; x < W; x++, di += 4) {
        const gx = x * invLat, gx0 = gx | 0, fxL = gx - gx0;
        const a = row0 + gx0, b = row1 + gx0;
        const Fx = (latFX[a] + (latFX[a + 1] - latFX[a]) * fxL) * (1 - fyL) +
                   (latFX[b] + (latFX[b + 1] - latFX[b]) * fxL) * fyL;
        const Fy = (latFY[a] + (latFY[a + 1] - latFY[a]) * fxL) * (1 - fyL) +
                   (latFY[b] + (latFY[b + 1] - latFY[b]) * fxL) * fyL;
        const sxf = x - padDev + sDev * Fx;
        const syf = y - padDev + sDev * Fy;
        // Rounded-rect coverage at the SOURCE point (the outline itself
        // bends), 1px antialiased edge.
        const dx1 = Math.min(sxf, sw - sxf);
        const dy1 = Math.min(syf, sh - syf);
        let d;
        if (dx1 < rr && dy1 < rr) {
          const ax = rr - dx1, ay = rr - dy1;
          d = rr - Math.sqrt(ax * ax + ay * ay);
        } else {
          d = Math.min(dx1, dy1);
        }
        if (d <= 0) {
          dst[di + 3] = 0;
          continue;
        }
        // Bilinear photo fetch (clamped — the photo fills the box).
        let sx0 = Math.floor(sxf), sy0 = Math.floor(syf);
        if (sx0 < 0) sx0 = 0; else if (sx0 > sw - 2) sx0 = sw - 2;
        if (sy0 < 0) sy0 = 0; else if (sy0 > sh - 2) sy0 = sh - 2;
        const u = Math.min(Math.max(sxf - sx0, 0), 1);
        const v = Math.min(Math.max(syf - sy0, 0), 1);
        const w00 = (1 - u) * (1 - v), w10 = u * (1 - v);
        const w01 = (1 - u) * v, w11 = u * v;
        const i00 = (sy0 * sw + sx0) * 4;
        const i10 = i00 + 4;
        const i01 = i00 + sw * 4;
        const i11 = i01 + 4;
        dst[di] = src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11;
        dst[di + 1] = src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11;
        dst[di + 2] = src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11;
        dst[di + 3] = d >= 1 ? 255 : 255 * d;
      }
    }
    cctx.putImageData(outData, 0, 0);
  }

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

  // Cubic-bezier sampler (Newton's method), matching the CSS easing named
  // in --opentilt-bend-ease (keyword or cubic-bezier).
  function makeBendEase(raw) {
    const kw = {
      "linear": [0, 0, 1, 1],
      "ease": [0.25, 0.1, 0.25, 1],
      "ease-in": [0.42, 0, 1, 1],
      "ease-out": [0, 0, 0.58, 1],
      "ease-in-out": [0.42, 0, 0.58, 1],
    };
    let c = kw[(raw || "").trim()];
    if (!c) {
      const m = (raw || "").match(
        /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/
      );
      if (m) c = [+m[1], +m[2], +m[3], +m[4]];
    }
    if (!c) c = kw["ease"];
    const x1 = c[0], y1 = c[1], x2 = c[2], y2 = c[3];
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = (t) => ((ax * t + bx) * t + cx) * t;
    const dxf = (t) => (3 * ax * t + 2 * bx) * t + cx;
    const sy = (t) => ((ay * t + by) * t + cy) * t;
    return function (x) {
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

  function runBend(sign, flightMs) {
    if (!canvas || !cctx || reduced) return;
    const strength = readNum("--opentilt-bend", 0);
    if (!strength) return;
    const explicit = readNum("--opentilt-bend-dur", 0);
    const durMs = explicit > 0 ? explicit : flightMs;
    if (durMs <= 0) return;
    const ease = makeBendEase(readStr("--opentilt-bend-ease"));
    // Radius over the flight, computed analytically with the same
    // duration + curve as the CSS border-radius transition (read once
    // here; per-frame getComputedStyle would force a Safari style
    // recalc every frame). 32px rest ↔ 16px open — must match the
    // .t-opentilt-card / .is-open CSS.
    const rFrom = parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0;
    const rTo = sign > 0 ? 16 : 32;
    const flightEase = makeBendEase(
      readStr(sign > 0 ? "--opentilt-open-ease" : "--opentilt-close-ease")
    );
    if (bendRaf) cancelAnimationFrame(bendRaf);
    prepareBend(strength);
    card.classList.add("is-bending");
    const t0 = performance.now();
    (function tick(now) {
      const p = Math.min((now - t0) / durMs, 1);
      const e = Math.min(Math.max(ease(p), 0), 1);
      const env = Math.sin(Math.PI * e);
      const p2 = Math.min((now - t0) / Math.max(flightMs, 1), 1);
      renderBend(strength * sign * env, rFrom + (rTo - rFrom) * flightEase(p2));
      if (p < 1) {
        bendRaf = requestAnimationFrame(tick);
      } else {
        bendRaf = null;
        card.classList.remove("is-bending");
      }
    })(t0);
  }

  card.addEventListener("click", function () {
    const open = card.classList.contains("is-open");
    if (open) {
      card.classList.remove("is-open");
      card.classList.add("is-closing");
      card.setAttribute("aria-expanded", "false");
      runBend(-0.6, readNum("--opentilt-close-dur", 420));
    } else {
      card.classList.remove("is-closing");
      card.classList.add("is-open");
      card.setAttribute("aria-expanded", "true");
      runBend(1, readNum("--opentilt-open-dur", 620));
    }
  });
  card.addEventListener("animationend", function (e) {
    if (e.animationName === "t-opentilt-close") {
      card.classList.remove("is-closing");
    }
  });
})();
```
