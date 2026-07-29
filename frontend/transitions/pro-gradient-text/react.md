# Pro gradient text — React (Pro)

`<GradientText>` — the living-gradient word as a component. The effect is pure CSS
(seven drifting SVG gradient washes + a hue cycle, clipped to the glyphs), so the
component is a thin wrapper; pair it with the CSS variant's styles and tokens
(identical class names).

```jsx
export function GradientText({
  children,
  as: Tag = "span",
  hueDur,
  driftDur,
  className,
}) {
  const style = {};
  if (hueDur) style["--gradient-text-hue-dur"] = hueDur;
  if (driftDur) style["--gradient-text-drift-dur"] = driftDur;
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

```jsx
<h1 className="hero-title">
  Transitions <GradientText>Pro</GradientText>
</h1>
```

The gradient clips to the glyphs (`background-clip: text`), so font family, size, and
weight come from the surrounding heading styles. Keep the wrapped text to a word or
two — the washes are tuned to hug a compact glyph box.
