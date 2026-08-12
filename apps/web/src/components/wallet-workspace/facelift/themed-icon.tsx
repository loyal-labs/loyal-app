import type { CSSProperties } from "react";

// Renders a monochrome SVG asset in the current text color via CSS mask
// (see .icon-themed in globals.css), so baked-in fills follow the theme.
export function ThemedIcon({
  className,
  label,
  src,
}: {
  className?: string;
  /** Accessible name; omitted = decorative (aria-hidden). */
  label?: string;
  src: string;
}) {
  return (
    <span
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={`icon-themed ${className ?? ""}`}
      role={label ? "img" : undefined}
      style={{ "--icon": `url("${src}")` } as CSSProperties}
    />
  );
}
