# Card stack hover — React (Pro)

Self-contained `<CardStack>`: three (or more) stacked cards fan out with a spring on
container hover. Slot geometry travels per-card; shared multipliers scale the fan.
Pair with the CSS from the CSS variant (identical class names).

```jsx
const DEFAULT_SLOTS = [
  { cx: "28px", cy: "20px", rot: "4deg", dx: "2px", dy: "-26px", drot: "7deg" },
  { cx: "12px", cy: "20px", rot: "-8deg", dx: "-4px", dy: "-6px", drot: "-7deg" },
  { cx: "21px", cy: "26px", rot: "0deg", dx: "2px", dy: "26px", drot: "4deg" },
];

export function CardStack({ slots = DEFAULT_SLOTS }) {
  return (
    <div className="t-stack" aria-label="Card stack">
      {slots.map((s, i) => (
        <button
          key={i}
          type="button"
          className="t-stack-card"
          style={{
            "--cx": s.cx,
            "--cy": s.cy,
            "--rot": s.rot,
            "--dx": s.dx,
            "--dy": s.dy,
            "--drot": s.drot,
            zIndex: i,
          }}
        >
          {s.content}
        </button>
      ))}
    </div>
  );
}
```

Include the `.t-stack` / `.t-stack-card` CSS and `:root` tokens from the CSS variant —
the component is purely structural; all motion lives in the stylesheet (hover-guarded,
reduced-motion safe).
