# Pro gradient text — TypeScript / React (Pro)

`<GradientText>` — the living-gradient word as a typed component. The effect is pure
CSS (seven drifting SVG gradient washes + a hue cycle, clipped to the glyphs), so the
component is a thin wrapper; pair it with the CSS variant's styles and tokens
(identical class names).

```tsx
import type { CSSProperties, ElementType, ReactNode } from "react";

interface GradientTextProps {
  children: ReactNode;
  /** Wrapping element for the word itself (defaults to an inline span). */
  as?: ElementType;
  /** Override the hue-cycle duration, e.g. "6000ms". */
  hueDur?: string;
  /** Override the blob-drift duration, e.g. "8000ms". */
  driftDur?: string;
  className?: string;
}

export function GradientText({
  children,
  as: Tag = "span",
  hueDur,
  driftDur,
  className,
}: GradientTextProps) {
  const style: CSSProperties = {};
  if (hueDur) (style as Record<string, string>)["--gradient-text-hue-dur"] = hueDur;
  if (driftDur) (style as Record<string, string>)["--gradient-text-drift-dur"] = driftDur;
  return (
    <Tag
      className={"t-gradient-text" + (className ? " " + className : "")}
      style={style}
    >
      {children}
    </Tag>
  );
}
```

## Usage

```tsx
<h1 className="hero-title">
  Transitions <GradientText>Pro</GradientText>
</h1>
```

The gradient clips to the glyphs (`background-clip: text`), so font family, size, and
weight come from the surrounding heading styles. Keep the wrapped text to a word or
two — the washes are tuned to hug a compact glyph box.
