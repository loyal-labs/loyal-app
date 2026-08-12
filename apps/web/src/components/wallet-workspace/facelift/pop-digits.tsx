"use client";

import { useLayoutEffect, useRef } from "react";

export type PopDigitsSegment = {
  color?: string;
  text: string;
};

// transitions.dev "Number pop-in" (frontend/transitions/number-pop-in.md)
// adapted to React: every character renders as a .t-digit span, the last two
// ride the 1×/2× stagger, and a value change replays the animation via the
// recipe's remove → reflow → re-add cycle. Segments carry per-part colors
// (e.g. black whole + muted fraction) without breaking the digit run.
// popOnChange=false pops only on mount — for values that scrub on hover or
// live-tick, where replaying on every change would flicker.
export function PopDigits({
  popOnChange = true,
  segments,
}: {
  popOnChange?: boolean;
  segments: PopDigitsSegment[];
}) {
  const groupRef = useRef<HTMLSpanElement>(null);
  const value = segments.map((segment) => segment.text).join("");
  const previousValue = useRef(value);

  useLayoutEffect(() => {
    if (!popOnChange || previousValue.current === value) {
      return;
    }
    previousValue.current = value;
    const group = groupRef.current;
    if (!group) {
      return;
    }
    group.classList.remove("is-animating");
    void group.offsetHeight; // force reflow so the animation replays
    group.classList.add("is-animating");
  }, [popOnChange, value]);

  const characters = segments.flatMap((segment) =>
    segment.text.split("").map((char) => ({
      // Inline-flex spans collapse plain spaces to zero width.
      char: char === " " ? " " : char,
      color: segment.color,
    }))
  );

  return (
    <span className="t-digit-group is-animating" ref={groupRef}>
      {characters.map((entry, index) => (
        <span
          className="t-digit"
          data-stagger={
            index === characters.length - 2
              ? "1"
              : index === characters.length - 1
                ? "2"
                : undefined
          }
          key={index}
          style={entry.color ? { color: entry.color } : undefined}
        >
          {entry.char}
        </span>
      ))}
    </span>
  );
}
