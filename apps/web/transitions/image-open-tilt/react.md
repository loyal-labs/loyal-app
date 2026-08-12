# Image open tilt — React (Pro)

`<ImageOpenTilt>` — the iPadOS-style zoom as a component. The scale spring lives on CSS
transitions, the tilt on keyframes (both from the CSS variant), and the organic bend is
a software displacement warp drawn to a canvas layer inside the card (SVG displacement
filters are not an option: WebKit never loads `feImage` data-URI maps, so a filter bend
simply doesn't exist in Safari). Pair with the CSS variant's styles and tokens
(identical class names).

```jsx
import { useCallback, useEffect, useRef, useState } from "react";

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

// Cubic-bezier sampler (Newton's method) for the bend envelope's easing.
function makeBendEase(raw) {
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

// Deterministic 2-octave value noise (≈110/70px wavelengths) — the
// "organic" component of the bend's displacement field.
const NZ = 64;
const nzR = new Float32Array(NZ * NZ);
const nzG = new Float32Array(NZ * NZ);
{
  let s = 11;
  for (let i = 0; i < NZ * NZ; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    nzR[i] = s / 2147483648 - 1;
    s = (s * 1664525 + 1013904223) >>> 0;
    nzG[i] = s / 2147483648 - 1;
  }
}
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
  return (grid(g, px / 110, py / 70) + 0.5 * grid(g, px / 55 + 37.7, py / 35 + 11.3)) / 1.5;
}

export function ImageOpenTilt({ src, alt = "" }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const cardRef = useRef(null);
  const imgRef = useRef(null);
  const canvasRef = useRef(null);
  const bendRaf = useRef(null);
  // Per-run warp state (snapshot pixels + displacement field lattice).
  const bend = useRef(null);

  const runBend = useCallback((sign, flightMs) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const card = cardRef.current;
    const img = imgRef.current;
    const canvas = canvasRef.current;
    const cctx = canvas ? canvas.getContext("2d") : null;
    if (!card || !canvas || !cctx) return;
    const strength = readNum("--opentilt-bend", 0);
    if (!strength) return;
    const explicit = readNum("--opentilt-bend-dur", 0);
    const durMs = explicit > 0 ? explicit : flightMs;
    if (durMs <= 0) return;
    const ease = makeBendEase(readStr("--opentilt-bend-ease"));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // Prepare: snapshot the cover-cropped photo UNCLIPPED (the rounded
    // clip is applied per pixel during the warp so the outline bends),
    // and precompute the displacement field per unit strength:
    //   Fy = 0.4116 · (1 − q²) − 0.41 + 0.09 · noise   q = (2x − w)/(1.4w)
    //   Fx = 0.0016 + 0.09 · noise
    const cw = card.offsetWidth, ch = card.offsetHeight;
    const sw = Math.max(2, Math.round(cw * dpr));
    const sh = Math.max(2, Math.round(ch * dpr));
    const pad = Math.ceil(Math.abs(strength) * 0.32) + 4;
    const padDev = Math.round(pad * dpr);
    // Canvas is a REPLACED element: absolute + inset does NOT stretch
    // it (it keeps its intrinsic attribute size), so the CSS box must
    // be sized explicitly.
    canvas.style.left = -pad + "px";
    canvas.style.top = -pad + "px";
    canvas.style.width = (cw + pad * 2) + "px";
    canvas.style.height = (ch + pad * 2) + "px";
    canvas.width = sw + padDev * 2;
    canvas.height = sh + padDev * 2;
    const outData = cctx.createImageData(canvas.width, canvas.height);
    const sc = document.createElement("canvas");
    sc.width = sw;
    sc.height = sh;
    const scx = sc.getContext("2d");
    if (img && img.naturalWidth) {
      const k = Math.max(sw / img.naturalWidth, sh / img.naturalHeight);
      const dw = img.naturalWidth * k, dh = img.naturalHeight * k;
      scx.drawImage(img, (sw - dw) / 2, (sh - dh) / 2, dw, dh);
    }
    const snap = scx.getImageData(0, 0, sw, sh).data;
    const LAT = 8; // device px; the field is ultra-smooth
    const latW = Math.ceil(canvas.width / LAT) + 2;
    const latH = Math.ceil(canvas.height / LAT) + 2;
    const latFX = new Float32Array(latW * latH);
    const latFY = new Float32Array(latW * latH);
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
    bend.current = { snap, outData, latFX, latFY, latW, padDev, sw, sh, dpr, LAT };

    const render = (s, rCss) => {
      const st = bend.current;
      // Radius passed in analytically (see tick below) — reading
      // getComputedStyle here every frame forces a style recalc
      // mid-animation, which is cheap in Blink but expensive enough
      // in Safari to drop the bend to ~30fps.
      const rr = rCss * st.dpr;
      const W = canvas.width, H = canvas.height;
      const srcD = st.snap, dst = st.outData.data;
      const sDev = s * st.dpr;
      const invLat = 1 / st.LAT;
      let di = 0;
      for (let y = 0; y < H; y++) {
        const gy = y * invLat, gy0 = gy | 0, fyL = gy - gy0;
        const row0 = gy0 * st.latW, row1 = row0 + st.latW;
        for (let x = 0; x < W; x++, di += 4) {
          const gx = x * invLat, gx0 = gx | 0, fxL = gx - gx0;
          const a = row0 + gx0, b = row1 + gx0;
          const Fx = (st.latFX[a] + (st.latFX[a + 1] - st.latFX[a]) * fxL) * (1 - fyL) +
                     (st.latFX[b] + (st.latFX[b + 1] - st.latFX[b]) * fxL) * fyL;
          const Fy = (st.latFY[a] + (st.latFY[a + 1] - st.latFY[a]) * fxL) * (1 - fyL) +
                     (st.latFY[b] + (st.latFY[b + 1] - st.latFY[b]) * fxL) * fyL;
          const sxf = x - st.padDev + sDev * Fx;
          const syf = y - st.padDev + sDev * Fy;
          // Rounded-rect coverage at the SOURCE point (the outline
          // itself bends), 1px antialiased edge.
          const dx1 = Math.min(sxf, st.sw - sxf);
          const dy1 = Math.min(syf, st.sh - syf);
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
          if (sx0 < 0) sx0 = 0; else if (sx0 > st.sw - 2) sx0 = st.sw - 2;
          if (sy0 < 0) sy0 = 0; else if (sy0 > st.sh - 2) sy0 = st.sh - 2;
          const u = Math.min(Math.max(sxf - sx0, 0), 1);
          const v = Math.min(Math.max(syf - sy0, 0), 1);
          const w00 = (1 - u) * (1 - v), w10 = u * (1 - v);
          const w01 = (1 - u) * v, w11 = u * v;
          const i00 = (sy0 * st.sw + sx0) * 4;
          const i10 = i00 + 4;
          const i01 = i00 + st.sw * 4;
          const i11 = i01 + 4;
          dst[di] = srcD[i00] * w00 + srcD[i10] * w10 + srcD[i01] * w01 + srcD[i11] * w11;
          dst[di + 1] = srcD[i00 + 1] * w00 + srcD[i10 + 1] * w10 + srcD[i01 + 1] * w01 + srcD[i11 + 1] * w11;
          dst[di + 2] = srcD[i00 + 2] * w00 + srcD[i10 + 2] * w10 + srcD[i01 + 2] * w01 + srcD[i11 + 2] * w11;
          dst[di + 3] = d >= 1 ? 255 : 255 * d;
        }
      }
      cctx.putImageData(st.outData, 0, 0);
    };

    // Radius over the flight, computed analytically with the same
    // duration + curve as the CSS border-radius transition (read once
    // here; per-frame getComputedStyle would force a Safari style
    // recalc every frame). 32px rest ↔ 16px open — must match the
    // .t-opentilt-card / .is-open CSS.
    const rFrom = parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0;
    const rTo = sign > 0 ? 16 : 32;
    const flightEase = makeBendEase(
      readStr(sign > 0 ? "--opentilt-open-ease" : "--opentilt-close-ease"),
    );
    if (bendRaf.current) cancelAnimationFrame(bendRaf.current);
    card.classList.add("is-bending");
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min((now - t0) / durMs, 1);
      const e = Math.min(Math.max(ease(p), 0), 1);
      const p2 = Math.min((now - t0) / Math.max(flightMs, 1), 1);
      render(strength * sign * Math.sin(Math.PI * e), rFrom + (rTo - rFrom) * flightEase(p2));
      if (p < 1) bendRaf.current = requestAnimationFrame(tick);
      else {
        bendRaf.current = null;
        card.classList.remove("is-bending");
      }
    };
    tick(t0);
  }, []);

  const toggle = useCallback(() => {
    if (open) {
      setOpen(false);
      setClosing(true);
      runBend(-0.6, readNum("--opentilt-close-dur", 420));
    } else {
      setClosing(false);
      setOpen(true);
      runBend(1, readNum("--opentilt-open-dur", 620));
    }
  }, [open, runBend]);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const onEnd = (e) => {
      if (e.animationName === "t-opentilt-close") setClosing(false);
    };
    card.addEventListener("animationend", onEnd);
    return () => card.removeEventListener("animationend", onEnd);
  }, []);

  return (
    <div className="t-opentilt-stage">
      <button
        ref={cardRef}
        type="button"
        className={
          "t-opentilt-card" + (open ? " is-open" : "") + (closing ? " is-closing" : "")
        }
        aria-expanded={open}
        aria-label={open ? "Close image" : "Open image"}
        onClick={toggle}
      >
        <img ref={imgRef} className="t-opentilt-img" src={src} alt={alt} />
        {/* Bend render layer: the warp is drawn here during the flight;
            it inherits the card's scale/tilt, so the 3D flight applies
            to the bent image for free. */}
        <canvas ref={canvasRef} className="t-opentilt-canvas" aria-hidden />
      </button>
    </div>
  );
}
```
