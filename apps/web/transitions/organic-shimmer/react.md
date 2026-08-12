# Organic shimmer — React (Pro)

Self-contained `<OrganicShimmer>`: the colourful wavy shimmer band + phase-locked
colourful edge beam (ring / glow / bloom), exactly as rendered on transitions.dev.
Renders the per-page SVG turbulence filter once (guarded by id). Pair with the CSS
from the CSS variant (identical class names).

```jsx
export function OrganicShimmer({ width = 142, height = 142, radius = 12, playing = true }) {
  // The recipe geometry (overhang, edge belts, ring stroke, blurs) is tuned
  // for a 142px tile — scale it by the smaller side so the effect keeps its
  // proportions on larger and smaller cards.
  const scale = Math.min(width, height) / 142;
  return (
    <>
      <div
        className="t-shimmer-tile"
        aria-hidden
        data-playing={playing ? undefined : "false"}
        style={{ width, height, borderRadius: radius, "--shimmer-scale": scale }}
      >
        <span className="t-shimmer"><span className="t-shimmer-band" /></span>
        <span className="t-shimmer-edge">
          <span className="t-shimmer-edge-bloom" />
          <span className="t-shimmer-edge-glow" />
          <span className="t-shimmer-edge-ring" />
        </span>
      </div>
      <ShimmerWarpFilter />
    </>
  );
}

/** The fractal-noise displacement field that waves the band — once per page. */
function ShimmerWarpFilter() {
  if (typeof document !== "undefined" && document.getElementById("t-shimmer-warp")) {
    return null;
  }
  return (
    <svg
      width={0}
      height={0}
      style={{ position: "absolute" }}
      aria-hidden
      focusable="false"
    >
      <filter id="t-shimmer-warp" x="-40%" y="-40%" width="180%" height="180%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.009 0.015"
          numOctaves={2}
          seed={7}
          result="n"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="n"
          scale={46}
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  );
}
```

Include the `.t-shimmer*` CSS and `:root` tokens from the CSS variant. All motion
is CSS (`t-shimmer-sweep` mask keyframes on band + edge, same clock — that's what
keeps the edge beam phase-locked); `playing={false}` pauses both in lockstep, and
reduced motion pauses them automatically.

**Dark mode** comes free with the CSS variant's `html[data-theme="dark"]` rule
(dark `#222226` tile — the colour blobs read on both themes) — no component
changes needed. For a `.dark` class or `prefers-color-scheme` setup, swap the
selector as shown in the CSS variant.
