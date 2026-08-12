# Card stack hover — TypeScript (Pro)

Self-contained `<CardStack>`: three (or more) stacked cards fan out with a spring on
container hover. Slot geometry travels per-card; shared multipliers scale the fan.
Pair with the CSS from the CSS variant (identical class names).

```tsx
import type { CSSProperties, ReactNode } from "react";

export type StackSlot = {
  /** Resting pose */
  cx: string; cy: string; rot: string;
  /** Fan deltas applied on container hover */
  dx: string; dy: string; drot: string;
  content?: ReactNode;
};

const DEFAULT_SLOTS: StackSlot[] = [
  { cx: "28px", cy: "20px", rot: "4deg",  dx: "2px",  dy: "-26px", drot: "7deg"  },
  { cx: "12px", cy: "20px", rot: "-8deg", dx: "-4px", dy: "-6px",  drot: "-7deg" },
  { cx: "21px", cy: "26px", rot: "0deg",  dx: "2px",  dy: "26px",  drot: "4deg"  },
];

export function CardStack({ slots = DEFAULT_SLOTS }: { slots?: StackSlot[] }) {
  return (
    <div className="t-stack" aria-label="Card stack">
      {slots.map((s, i) => (
        <button
          key={i}
          type="button"
          className="t-stack-card"
          style={{
            "--cx": s.cx, "--cy": s.cy, "--rot": s.rot,
            "--dx": s.dx, "--dy": s.dy, "--drot": s.drot,
            zIndex: i,
          } as CSSProperties}
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
