# Pro gradient text (Pro)

## When to use

A headline word or short label whose glyphs are filled with a **living gradient** — seven
rotated radial colour washes (blue / magenta / orange / green / teal) drifting around the
text outline over a grey base ramp, while a full hue rotation cycles the palette. Use it
to make one word feel premium — a plan name ("Pro"), a product wordmark, a hero keyword.
Keep it to a word or two: the effect is clipped to the glyphs and reads best at display
sizes.

The rotated ellipses can't be expressed with CSS `radial-gradient()`, so the Figma
gradientTransforms are preserved as inline-SVG `background-image` layers. Everything
animates on the compositor (`background-position` + `filter: hue-rotate`); the repaint
area is one small word. Pauses under reduced motion.

## HTML usage

```html
<h1 class="t-gradient-heading">
  <span class="t-gradient-text">Pro</span>
</h1>
```

Apply `.t-gradient-text` to an inline span around the word — the gradient clips to the
glyphs via `background-clip: text`. Font, size, and weight come from your own heading
styles.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--gradient-text-hue-dur` | `4000ms` | one full hue-rotate cycle (seamless loop) |
| `--gradient-text-drift-dur` | `5000ms` | one full lap of the colour blobs around the glyph box |

```css
:root {
  --gradient-text-hue-dur: 4000ms;
  --gradient-text-drift-dur: 5000ms;
}
```

## CSS

```css
.t-gradient-text {
  background-image:
    url("data:image/svg+xml;utf8,<svg viewBox='0 0 67 42' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)' opacity='0.88'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(0.34726 -1.3118e-7 8.6482e-7 0.89585 33.5 21)'><stop stop-color='rgba(0,110,245,1)' offset='0'/><stop stop-color='rgba(0,110,245,0)' offset='1'/></radialGradient></defs></svg>"),
    url("data:image/svg+xml;utf8,<svg viewBox='0 0 67 42' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)' opacity='0.5'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(-1.3 0.25 -1.2633 -2.7471 33.5 21)'><stop stop-color='rgba(0,110,245,1)' offset='0'/><stop stop-color='rgba(0,110,245,0)' offset='1'/></radialGradient></defs></svg>"),
    url("data:image/svg+xml;utf8,<svg viewBox='0 0 67 42' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)' opacity='0.4'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(1.05 -0.8 0.46018 3.6184 33.5 21)'><stop stop-color='rgba(204,0,167,1)' offset='0'/><stop stop-color='rgba(170,0,204,0)' offset='0.71709'/></radialGradient></defs></svg>"),
    url("data:image/svg+xml;utf8,<svg viewBox='0 0 67 42' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(-0.51067 -3.3275e-16 -4.3352e-14 -1.1396 33.5 21)'><stop stop-color='rgba(204,0,167,1)' offset='0'/><stop stop-color='rgba(170,0,204,0)' offset='1'/></radialGradient></defs></svg>"),
    url("data:image/svg+xml;utf8,<svg viewBox='0 0 67 42' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(-0.45 -0.75 1.9052 -0.7091 33.5 21)'><stop stop-color='rgba(255,173,85,1)' offset='0'/><stop stop-color='rgba(255,173,85,0)' offset='1'/></radialGradient></defs></svg>"),
    url("data:image/svg+xml;utf8,<svg viewBox='0 0 67 42' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(1.25 -0.35 -0.4013 3.5959 33.5 21)'><stop stop-color='rgba(0,204,68,1)' offset='0'/><stop stop-color='rgba(0,196,102,0.75)' offset='0.25'/><stop stop-color='rgba(0,187,136,0.5)' offset='0.5'/><stop stop-color='rgba(0,170,204,0)' offset='1'/></radialGradient></defs></svg>"),
    url("data:image/svg+xml;utf8,<svg viewBox='0 0 67 42' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(-0.87391 0.73043 -4.1482 -1.9503 33.5 21)'><stop stop-color='rgba(0,170,204,1)' offset='0'/><stop stop-color='rgba(0,170,204,0)' offset='1'/></radialGradient></defs></svg>"),
    linear-gradient(rgb(108, 108, 108) 0%, rgb(216, 216, 216) 100%);
  /* Each colour layer is blown up to 180% and swings around the
     glyph box (the grey base ramp stays put at 100%), so the
     enlarged blobs sweep corner-to-corner through the letters.
     The repaint area is one ~55×47px word — negligible. */
  background-size: 180% 180%, 180% 180%, 180% 180%, 180% 180%,
                   180% 180%, 180% 180%, 180% 180%, 100% 100%;
  background-repeat: no-repeat;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation:
    t-gradient-hue var(--gradient-text-hue-dur) linear infinite,
    t-gradient-drift var(--gradient-text-drift-dur) ease-in-out infinite;
}
/* Full hue cycle — ends where it starts, so the loop is seamless
   and the colour travel is unmistakable. Compositor-only. The
   saturate boost keeps the washes punchy at 180% blow-up. */
@keyframes t-gradient-hue {
  from { filter: hue-rotate(0deg) saturate(1.3); }
  to   { filter: hue-rotate(-360deg) saturate(1.3); }
}
/* Blob travel — perimeter orbit. Each blob is re-centred inside
   its own SVG tile (translation 33.5 21 above) and pinned to the
   ring of edge stops TL,T,TR,R,BR,B,BL,L. Every blob starts on
   the stop nearest its Figma quadrant and advances two ring
   stops per keyframe — a full lap around the text outline per
   cycle, so colour hugs and travels the edges while the middle
   keeps the grey ramp. Last layer (grey ramp) never moves. */
@keyframes t-gradient-drift {
  0%, 100% {
    background-position:
      100% 0%, 0% 50%, 100% 50%, 0% 100%,
      0% 0%, 50% 0%, 50% 100%, 0 0;
  }
  25% {
    background-position:
      100% 100%, 50% 0%, 50% 100%, 0% 0%,
      100% 0%, 100% 50%, 0% 50%, 0 0;
  }
  50% {
    background-position:
      0% 100%, 100% 50%, 0% 50%, 100% 0%,
      100% 100%, 50% 100%, 50% 0%, 0 0;
  }
  75% {
    background-position:
      0% 0%, 50% 100%, 50% 0%, 100% 100%,
      0% 100%, 0% 50%, 100% 50%, 0 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .t-gradient-text { animation: none; }
}

```

## Notes

- **Why inline-SVG layers:** each wash is a Figma radial gradient with a rotation +
  non-uniform scale (`gradientTransform`). CSS `radial-gradient()` has no rotation, so
  the layers are kept as data-URI SVGs — identical bytes to the design, not re-derived.
- The colour layers are blown up to `180%` and orbit the glyph box through the
  `background-position` ring (corner → edge → corner…); the grey base ramp (last layer)
  never moves, so the middle of the glyphs keeps a stable anchor while colour hugs and
  travels the edges.
- The `saturate(1.3)` inside the hue keyframes keeps the washes punchy at the 180%
  blow-up — don't drop it when adjusting the animation.
- Both animations are compositor-only (`background-position`, `filter`); there's no
  layout or paint churn beyond the word itself.
