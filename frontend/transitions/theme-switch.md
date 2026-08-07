# Theme switch (circle wipe)

## When to use

Light/dark toggle. The new theme sweeps over the old one as a circle growing
from the toggle control, instead of every element flash-swapping its colors.
Built on the View Transitions API: the browser snapshots the page before and
after the class flip and we clip-reveal the "after" snapshot — no per-element
color transitions, fully GPU-composited.

## Usage

JS lives in `src/hooks/use-theme.ts` (`toggleTheme({ x, y })` — pass the
toggle's center; omit the origin to get the API's default crossfade). CSS is
the snapshot freeze in `globals.css`, scoped to `:root[data-theme-wipe]`.

```tsx
const { isDark, toggleTheme } = useTheme();
<button
  onClick={(event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    toggleTheme({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }}
>
```

## Tunables

| Constant (use-theme.ts) | Default | Notes |
| --- | --- | --- |
| `WIPE_DURATION_MS` | `400` | Above the usual sub-300ms UI band on purpose — the motion spans the whole viewport. Keep ≤ 500. |
| `WIPE_EASE` | `cubic-bezier(0.23, 1, 0.32, 1)` | Strong ease-out; circle area grows with r² so the coverage still reads brisk at the tail. |

## Degradation ladder

1. No `document.startViewTransition` (old browsers): instant swap — exactly
   the pre-recipe behavior.
2. `prefers-reduced-motion: reduce`: default view-transition crossfade
   (opacity only, no motion).
3. Rapid double-toggle: the second `startViewTransition` skips the first;
   the first's cleanup can drop the snapshot freeze early, degrading that
   one wipe to a crossfade. Harmless.

## Caveats

- Canvas/JS-driven surfaces that recolor asynchronously after the class flip
  may be captured mid-recolor in the "after" snapshot; they settle the frame
  the transition ends.
- Interaction is inert under the transition overlay for the wipe's 400ms —
  another reason to keep the duration tight.
