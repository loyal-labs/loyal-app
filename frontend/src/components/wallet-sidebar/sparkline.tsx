"use client";

import { useLayoutEffect, useRef, useState } from "react";

export function Sparkline({
  data,
  width = 120,
  height = 36,
  color = "#F9363C",
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (data.length < 2) return null;

  return (
    <SparklineInner data={data} width={width} height={height} color={color} />
  );
}

function SparklineInner({
  data,
  width,
  height,
  color,
}: {
  data: number[];
  width: number;
  height: number;
  color: string;
}) {
  const lineRef = useRef<SVGPolylineElement>(null);
  const [revealed, setRevealed] = useState(false);

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const padding = 2;
  const chartHeight = height - padding * 2;
  const stepX = (width - padding * 2) / (data.length - 1);

  const points = data
    .map((value, i) => {
      const x = padding + i * stepX;
      const y =
        padding + chartHeight - ((value - min) / range) * chartHeight;
      return `${x},${y}`;
    })
    .join(" ");

  const gradientId = `sparkline-grad-${color.replace("#", "")}`;
  const firstX = padding;
  const lastX = padding + (data.length - 1) * stepX;
  const fillPoints = `${firstX},${height} ${points} ${lastX},${height}`;

  // Animate draw-on effect on first render, then smooth transitions on updates
  // useLayoutEffect runs before paint — prevents flash of fully-drawn line
  useLayoutEffect(() => {
    const line = lineRef.current;
    if (!line) return;

    if (!revealed) {
      // getTotalLength throws InvalidStateError on non-rendered elements
      // (e.g. inside a collapsed parent) in stricter engines like Android
      // WebView. If unavailable, skip the draw-on animation and reveal
      // immediately rather than crashing the whole tree.
      let length = 0;
      try {
        length = line.getTotalLength();
      } catch {
        setRevealed(true);
        return;
      }

      line.style.strokeDasharray = `${length}`;
      line.style.strokeDashoffset = `${length}`;
      line.style.transition = "none";

      // Force reflow then start animation
      line.getBoundingClientRect();

      line.style.transition =
        "stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)";
      line.style.strokeDashoffset = "0";

      const timeout = setTimeout(() => setRevealed(true), 850);
      return () => clearTimeout(timeout);
    }

    // After initial reveal, clear dash props so the line renders normally
    line.style.strokeDasharray = "";
    line.style.strokeDashoffset = "";
    line.style.transition = "";
  }, [revealed]);

  return (
    <svg
      fill="none"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        fill={`url(#${gradientId})`}
        points={fillPoints}
        style={{
          opacity: revealed ? 1 : 0,
          transition: "opacity 0.4s ease-in 0.5s",
        }}
      />
      <polyline
        ref={lineRef}
        fill="none"
        points={points}
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}
