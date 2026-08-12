# Card stack hover (Pro)

## When to use

A trio of stacked cards (thumbnails, covers, attachments, layered previews) that fans out
with a spring when the container is hovered, and springs back together on leave. The
hovered card additionally scales up on its own slower clock. Hover-only (guarded with
`@media (hover: hover)` so touch taps don't stick) and flattens under reduced motion.

Each card owns its **slot geometry inline**: `--cx/--cy/--rot` is the resting pose,
`--dx/--dy/--drot` is the fan delta applied on container hover. The shared multipliers
(`--stack-spread`, `--stack-rotation`) scale how far the fan opens without touching the
per-card poses.

## HTML usage

```html
<div class="t-stack" aria-label="Card stack">
  <button type="button" class="t-stack-card"
          style="--cx: 28px; --cy: 20px; --rot: 4deg;  --dx:  2px; --dy: -26px; --drot:  7deg; z-index: 0;"></button>
  <button type="button" class="t-stack-card"
          style="--cx: 12px; --cy: 20px; --rot: -8deg; --dx: -4px; --dy:  -6px; --drot: -7deg; z-index: 1;"></button>
  <button type="button" class="t-stack-card"
          style="--cx: 21px; --cy: 26px; --rot: 0deg;  --dx:  2px; --dy:  26px; --drot:  4deg; z-index: 2;"></button>
</div>
```

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--stack-open-dur` | `410ms` | fan-out duration |
| `--stack-open-ease` | `cubic-bezier(0.31, 2.34, 0.64, 1)` | springy overshoot on open |
| `--stack-close-dur` | `360ms` | collapse duration |
| `--stack-close-ease` | `cubic-bezier(0.34, 1.9, 0.64, 1)` | slightly softer spring on close |
| `--stack-scale-dur` | `610ms` | hovered-card scale clock |
| `--stack-scale-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | smooth-out |
| `--stack-scale` | `1.04` | hovered-card scale |
| `--stack-spread` | `1.42` | multiplies each card's fan Y-delta |
| `--stack-rotation` | `1` | multiplies each card's fan rotation delta |

```css
:root {
  --stack-open-dur: 410ms;
  --stack-open-ease: cubic-bezier(0.31, 2.34, 0.64, 1);
  --stack-close-dur: 360ms;
  --stack-close-ease: cubic-bezier(0.34, 1.9, 0.64, 1);
  --stack-scale-dur: 610ms;
  --stack-scale-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --stack-scale: 1.04;
  --stack-spread: 1.42;
  --stack-rotation: 1;
}
```

## CSS

```css
.t-stack {
  position: relative;
  width: 120px;
  height: 120px;
  flex-shrink: 0;
}

/* Each card is absolutely positioned; the stacked pose comes from its
   inline --cx/--cy/--rot, the fanned pose adds the inline deltas scaled
   by the shared multipliers. Base timing = close (collapse back). */
.t-stack-card {
  appearance: none;
  border: 0;
  padding: 0;
  position: absolute;
  top: 0;
  left: 0;
  width: 78px;
  height: 78px;
  border-radius: 12px;
  background: #fff;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.06),
    0 2px 6px rgba(0, 0, 0, 0.05),
    0 4px 42px rgba(0, 0, 0, 0.06);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  translate: var(--cx) var(--cy);
  rotate: var(--rot);
  scale: 1;
  transition:
    translate var(--stack-close-dur) var(--stack-close-ease),
    rotate var(--stack-close-dur) var(--stack-close-ease),
    scale var(--stack-scale-dur) var(--stack-scale-ease);
  will-change: translate, rotate, scale;
}

/* Hover affordances only on devices that actually support hover
   (on touch, :hover can stick after a tap). */
@media (hover: hover) {
  .t-stack:hover .t-stack-card {
    translate:
      calc(var(--cx) + var(--dx))
      calc(var(--cy) + var(--dy) * var(--stack-spread));
    rotate: calc(var(--rot) + var(--drot) * var(--stack-rotation));
    transition:
      translate var(--stack-open-dur) var(--stack-open-ease),
      rotate var(--stack-open-dur) var(--stack-open-ease),
      scale var(--stack-scale-dur) var(--stack-scale-ease);
  }

  .t-stack-card:hover {
    scale: var(--stack-scale);
    z-index: 30;
  }
}

@media (prefers-reduced-motion: reduce) {
  .t-stack-card { transition: none; }
}
```
