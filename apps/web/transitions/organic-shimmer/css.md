# Organic shimmer (Pro)

## When to use

A premium skeleton/loading shimmer with **colour**: a band of six soft colour blobs
(blue, pink, green, purple, orange, teal) sweeps diagonally across the surface,
gently **waved by an SVG turbulence filter** so it never reads as a ruler-straight
stripe — plus a colourful **edge beam**: a 1px gradient ring, an inner glow, and a
heavily blurred bloom, all masked to a comet-profiled window that is phase-locked
to the band's clock, so the edges light up exactly where the band is passing.
This is the effect exactly as rendered on transitions.dev. Use on skeleton tiles,
upload targets, "processing" surfaces.

Built the canonical way: the travelling window is a mask 280% the size of the
layer, animated via `mask-position`, so the visible area only ever shows smooth
gradient (no edges, no seams).

## HTML usage

```html
<div class="t-shimmer-tile" aria-hidden="true">
  <span class="t-shimmer"><span class="t-shimmer-band"></span></span>
  <span class="t-shimmer-edge">
    <span class="t-shimmer-edge-bloom"></span>
    <span class="t-shimmer-edge-glow"></span>
    <span class="t-shimmer-edge-ring"></span>
  </span>
</div>

<!-- Once per page: the fractal-noise displacement field that waves the band. -->
<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
  <filter id="t-shimmer-warp" x="-40%" y="-40%" width="180%" height="180%">
    <feTurbulence type="fractalNoise" baseFrequency="0.009 0.015" numOctaves="2" seed="7" result="n" />
    <feDisplacementMap in="SourceGraphic" in2="n" scale="46" xChannelSelector="R" yChannelSelector="G" />
  </filter>
</svg>
```

Pause/resume by setting `data-playing="false"` on `.t-shimmer-tile` (both layers
share one clock, so they freeze and resume in lockstep). Omit the attribute to run.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--shimmer-dur` | `3000ms` | one sweep of band + edge beam (same clock) |
| `--shimmer-ease` | `ease-out` | sweep pacing |
| `--shimmer-band-span` | `26%` | band thickness inside the travelling mask |
| `--shimmer-opacity` | `1` | colour-band layer opacity |
| `--shimmer-glow-blur` | `20px` | edge bloom blur radius |
| `--shimmer-glow-strength` | `0.7` | edge beam opacity |
| `--shimmer-ring-strength` | `1` | 1px gradient ring opacity |
| `--shimmer-scale` | `1` | size factor — set to `tile-size / 142` on larger or smaller tiles |

```css
:root {
  --shimmer-dur: 3000ms;
  --shimmer-ease: ease-out;
  --shimmer-band-span: 26%;
  --shimmer-opacity: 1;
  --shimmer-glow-blur: 20px;
  --shimmer-glow-strength: 0.7;
  --shimmer-ring-strength: 1;
  --shimmer-scale: 1;
}
```

## CSS

```css
.t-shimmer-tile {
  position: relative;
  width: 142px;
  height: 142px;
  border-radius: 12px;
  background: #eeeeee;
  overflow: hidden;
  isolation: isolate;
  flex-shrink: 0;
}
html[data-theme="dark"] .t-shimmer-tile { background: #222226; }
/* Play/Stop toggle: both layers share the t-shimmer-sweep clock,
   so pausing/resuming the container's data attribute freezes or
   resumes them in lockstep. */
.t-shimmer-tile[data-playing="false"] .t-shimmer-band,
.t-shimmer-tile[data-playing="false"] .t-shimmer-edge {
  animation-play-state: paused;
}
/* Shimmer split into wrapper + inner band: the inner band carries
   the colourful blobs (sized in % of the layer, so they scale with
   the tile) + traveling mask; the wrapper warps + blurs
   the already-masked result so the band boundary undulates (filter
   applies before mask on a single element, hence the split). */
.t-shimmer {
  position: absolute;
  inset: calc(-20px * var(--shimmer-scale));
  filter: url(#t-shimmer-warp) blur(calc(5px * var(--shimmer-scale)));
  opacity: var(--shimmer-opacity);
  pointer-events: none;
}
.t-shimmer-band {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 49.45% 38.46% at 20% 15%, rgba(40, 140, 255, 0.14), transparent),
    radial-gradient(ellipse 43.96% 32.97% at 65% 25%, rgba(255, 50, 100, 0.13), transparent),
    radial-gradient(ellipse 38.46% 43.96% at 30% 55%, rgba(50, 200, 80, 0.12), transparent),
    radial-gradient(ellipse 49.45% 38.46% at 75% 65%, rgba(180, 40, 240, 0.13), transparent),
    radial-gradient(ellipse 38.46% 32.97% at 45% 85%, rgba(255, 120, 40, 0.12), transparent),
    radial-gradient(ellipse 32.97% 32.97% at 10% 85%, rgba(30, 185, 170, 0.11), transparent),
    linear-gradient(rgba(90, 90, 100, 0.05), rgba(90, 90, 100, 0.05));
  -webkit-mask-image: linear-gradient(
    135deg,
    transparent 0%,
    transparent calc(50% - var(--shimmer-band-span) * 0.8),
    rgba(255, 255, 255, 0.25) calc(50% - var(--shimmer-band-span) * 0.45),
    rgba(255, 255, 255, 0.7) calc(50% - var(--shimmer-band-span) * 0.18),
    white 50%,
    rgba(255, 255, 255, 0.7) calc(50% + var(--shimmer-band-span) * 0.18),
    rgba(255, 255, 255, 0.25) calc(50% + var(--shimmer-band-span) * 0.45),
    transparent calc(50% + var(--shimmer-band-span) * 0.8),
    transparent 100%
  );
  -webkit-mask-size: 280% 280%;
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-position: 100% 100%;
  mask-image: linear-gradient(
    135deg,
    transparent 0%,
    transparent calc(50% - var(--shimmer-band-span) * 0.8),
    rgba(255, 255, 255, 0.25) calc(50% - var(--shimmer-band-span) * 0.45),
    rgba(255, 255, 255, 0.7) calc(50% - var(--shimmer-band-span) * 0.18),
    white 50%,
    rgba(255, 255, 255, 0.7) calc(50% + var(--shimmer-band-span) * 0.18),
    rgba(255, 255, 255, 0.25) calc(50% + var(--shimmer-band-span) * 0.45),
    transparent calc(50% + var(--shimmer-band-span) * 0.8),
    transparent 100%
  );
  mask-size: 280% 280%;
  mask-repeat: no-repeat;
  mask-position: 100% 100%;
  animation: t-shimmer-sweep var(--shimmer-dur) var(--shimmer-ease) infinite;
  pointer-events: none;
}
/* Edge beam: a uniform ink ring + glow + bloom underneath, shaped
   only by a comet-profiled 135° mask window phase-locked to the
   shimmer's clock — the lit segment brightens and fades smoothly as
   it glides along the border. */
.t-shimmer-edge {
  position: absolute;
  inset: calc(-20px * var(--shimmer-scale));
  z-index: 1;
  opacity: var(--shimmer-glow-strength);
  pointer-events: none;
  -webkit-mask-image: linear-gradient(
    135deg,
    transparent 0%,
    transparent calc(50% - var(--shimmer-band-span) * 1.4),
    rgba(255, 255, 255, 0.06) calc(50% - var(--shimmer-band-span) * 1),
    rgba(255, 255, 255, 0.18) calc(50% - var(--shimmer-band-span) * 0.6),
    rgba(255, 255, 255, 0.45) calc(50% - var(--shimmer-band-span) * 0.25),
    white 50%,
    rgba(255, 255, 255, 0.5) calc(50% + var(--shimmer-band-span) * 0.18),
    transparent calc(50% + var(--shimmer-band-span) * 0.35),
    transparent 100%
  );
  -webkit-mask-size: 280% 280%;
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-position: 100% 100%;
  mask-image: linear-gradient(
    135deg,
    transparent 0%,
    transparent calc(50% - var(--shimmer-band-span) * 1.4),
    rgba(255, 255, 255, 0.06) calc(50% - var(--shimmer-band-span) * 1),
    rgba(255, 255, 255, 0.18) calc(50% - var(--shimmer-band-span) * 0.6),
    rgba(255, 255, 255, 0.45) calc(50% - var(--shimmer-band-span) * 0.25),
    white 50%,
    rgba(255, 255, 255, 0.5) calc(50% + var(--shimmer-band-span) * 0.18),
    transparent calc(50% + var(--shimmer-band-span) * 0.35),
    transparent 100%
  );
  mask-size: 280% 280%;
  mask-repeat: no-repeat;
  mask-position: 100% 100%;
  animation: t-shimmer-sweep var(--shimmer-dur) var(--shimmer-ease) infinite;
}
@keyframes t-shimmer-sweep {
  0%   { -webkit-mask-position: 100% 100%; mask-position: 100% 100%; }
  100% { -webkit-mask-position: 0% 0%;     mask-position: 0% 0%; }
}
.t-shimmer-edge-ring,
.t-shimmer-edge-glow,
.t-shimmer-edge-bloom {
  position: absolute;
  inset: calc(20px * var(--shimmer-scale));
  border-radius: 12px;
  pointer-events: none;
}
/* Ring stroke: the border-beam library's 9 border-palette blobs
   (colorPalettes.colorful, positions/sizes ×0.6) painted into a
   1px ring over a faint neutral base that keeps the stroke from
   vanishing between blobs as the comet window travels. */
.t-shimmer-edge-ring {
  padding: calc(1px * var(--shimmer-scale));
  opacity: var(--shimmer-ring-strength);
  background:
    radial-gradient(ellipse 29.58% 16.90% at 33% -7.4%, rgba(255, 50, 100, 0.62), transparent),
    radial-gradient(ellipse 25.35% 14.79% at 12% -5%, rgba(40, 140, 255, 0.48), transparent),
    radial-gradient(ellipse 16.90% 29.58% at 2.1% 68.3%, rgba(50, 200, 80, 0.55), transparent),
    radial-gradient(ellipse 8.45% 14.79% at 2.1% 68.3%, rgba(30, 185, 170, 0.44), transparent),
    radial-gradient(ellipse 76.06% 13.38% at 74.4% 100%, rgba(100, 70, 255, 0.58), transparent),
    radial-gradient(ellipse 35.92% 11.27% at 55% 100%, rgba(40, 140, 255, 0.51), transparent),
    radial-gradient(ellipse 30.99% 13.38% at 93.9% 0%, rgba(255, 120, 40, 0.65), transparent),
    radial-gradient(ellipse 11.27% 17.61% at 100% 27.1%, rgba(240, 50, 180, 0.5), transparent),
    radial-gradient(ellipse 21.83% 20.42% at 100% 27.1%, rgba(180, 40, 240, 0.56), transparent),
    linear-gradient(rgba(90, 90, 100, 0.22), rgba(90, 90, 100, 0.22));
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask-composite: exclude;
}
/* Inner glow: the library's PULSE_INNER blob set (×0.6) in real
   colors + four neutral corner accents, belt-masked with a 44px
   fade and softened 2px so the coloured lumps melt together. */
.t-shimmer-edge-glow {
  background:
    radial-gradient(ellipse 27.46% 14.79% at 33% -7.4%, rgba(255, 50, 100, 0.34), transparent),
    radial-gradient(ellipse 23.24% 12.68% at 12% -5%, rgba(40, 140, 255, 0.28), transparent),
    radial-gradient(ellipse 14.79% 27.46% at 2.1% 68.3%, rgba(50, 200, 80, 0.3), transparent),
    radial-gradient(ellipse 6.34% 12.68% at 2.1% 68.3%, rgba(30, 185, 170, 0.25), transparent),
    radial-gradient(ellipse 73.24% 11.97% at 74.4% 100%, rgba(100, 70, 255, 0.32), transparent),
    radial-gradient(ellipse 33.80% 9.15% at 55% 100%, rgba(40, 140, 255, 0.28), transparent),
    radial-gradient(ellipse 28.87% 11.97% at 93.9% 0%, rgba(255, 120, 40, 0.35), transparent),
    radial-gradient(ellipse 9.15% 16.20% at 100% 27.1%, rgba(240, 50, 180, 0.28), transparent),
    radial-gradient(ellipse 19.72% 18.31% at 100% 27.1%, rgba(180, 40, 240, 0.3), transparent),
    radial-gradient(ellipse 25.35% 25.35% at 0% 0%, rgba(90, 90, 100, 0.14), transparent 70%),
    radial-gradient(ellipse 25.35% 25.35% at 100% 0%, rgba(90, 90, 100, 0.14), transparent 70%),
    radial-gradient(ellipse 25.35% 25.35% at 0% 100%, rgba(90, 90, 100, 0.14), transparent 70%),
    radial-gradient(ellipse 25.35% 25.35% at 100% 100%, rgba(90, 90, 100, 0.14), transparent 70%);
  box-shadow: inset 0 0 calc(14px * var(--shimmer-scale)) calc(1px * var(--shimmer-scale)) rgba(90, 90, 100, 0.12);
  filter: blur(calc(2px * var(--shimmer-scale)));
  -webkit-mask-image:
    linear-gradient(white, transparent calc(44px * var(--shimmer-scale)), transparent calc(100% - 44px * var(--shimmer-scale)), white),
    linear-gradient(to right, white, transparent calc(44px * var(--shimmer-scale)), transparent calc(100% - 44px * var(--shimmer-scale)), white);
  -webkit-mask-composite: source-over;
  mask-image:
    linear-gradient(white, transparent calc(44px * var(--shimmer-scale)), transparent calc(100% - 44px * var(--shimmer-scale)), white),
    linear-gradient(to right, white, transparent calc(44px * var(--shimmer-scale)), transparent calc(100% - 44px * var(--shimmer-scale)), white);
  mask-composite: add;
}
/* Bloom: the library's PULSE_INNER_BLOOM table — 7 expanded blobs
   (×0.65) in real colors, heavily blurred over a faint neutral
   wash, in a soft edge belt (not ring-clipped, so the blur can
   radiate). The big organic coloured glow pouring off the stroke. */
.t-shimmer-edge-bloom {
  background:
    radial-gradient(ellipse 38.73% 21.83% at 33% -7.4%, rgba(255, 50, 100, 0.4), transparent),
    radial-gradient(ellipse 33.10% 19.01% at 12% -5%, rgba(40, 140, 255, 0.34), transparent),
    radial-gradient(ellipse 21.83% 38.73% at 2.1% 68.3%, rgba(50, 200, 80, 0.38), transparent),
    radial-gradient(ellipse 98.59% 17.61% at 74.4% 100%, rgba(100, 70, 255, 0.4), transparent),
    radial-gradient(ellipse 46.48% 14.08% at 55% 100%, rgba(40, 140, 255, 0.35), transparent),
    radial-gradient(ellipse 40.85% 17.61% at 93.9% 0%, rgba(255, 120, 40, 0.44), transparent),
    radial-gradient(ellipse 28.17% 26.76% at 100% 27.1%, rgba(180, 40, 240, 0.38), transparent);
  box-shadow:
    inset 0 0 calc(var(--shimmer-glow-blur) * 3 * var(--shimmer-scale)) calc(var(--shimmer-glow-blur) / 2 * var(--shimmer-scale))
      rgba(90, 90, 100, 0.1);
  filter: blur(calc(var(--shimmer-glow-blur) * var(--shimmer-scale)));
  -webkit-mask-image:
    linear-gradient(white, transparent calc(26px * var(--shimmer-scale)), transparent calc(100% - 26px * var(--shimmer-scale)), white),
    linear-gradient(to right, white, transparent calc(26px * var(--shimmer-scale)), transparent calc(100% - 26px * var(--shimmer-scale)), white);
  -webkit-mask-composite: source-over;
  mask-image:
    linear-gradient(white, transparent calc(26px * var(--shimmer-scale)), transparent calc(100% - 26px * var(--shimmer-scale)), white),
    linear-gradient(to right, white, transparent calc(26px * var(--shimmer-scale)), transparent calc(100% - 26px * var(--shimmer-scale)), white);
  mask-composite: add;
}

@media (prefers-reduced-motion: reduce) {
  .t-shimmer-band,
  .t-shimmer-edge { animation: none; }
}
```

## Dark mode

Same switch as on transitions.dev (`data-theme="dark"` on `<html>`): only the tile
surface changes — the colour blobs read on both light and dark. The rule ships in
the CSS above; for a `.dark` class or `prefers-color-scheme` setup, swap the
selector on the same declaration:

```css
@media (prefers-color-scheme: dark) {
  .t-shimmer-tile { background: #222226; }
}
```

## Scaling to your card size

The geometry is tuned for a 142px tile. The travelling mask is proportional, but
the overhang, edge belts, ring stroke, and blurs are pixel values. Set
`--shimmer-scale` to `size / 142` (the tile's smaller side) and they all scale
together:

```css
/* 280px media card → 280 / 142 ≈ 2 */
.upload-target { width: 280px; height: 280px; --shimmer-scale: 2; }
```

The React / TypeScript variants derive this automatically from their `width` /
`height` props. The colour blobs themselves are sized in **percentages of their
layer**, so the composition tracks the tile at any size on its own — the scale
factor covers the remaining pixel geometry. Below ~50px, consider dropping the
edge beam (`display: none` on `.t-shimmer-edge`) — at chip size the band alone
reads cleaner.
