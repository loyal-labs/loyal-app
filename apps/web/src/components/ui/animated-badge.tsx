"use client";

import { ChevronRight } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";

type AnimatedBadgeProps = {
  text?: string;
  color?: string; // hex or css color value
  href?: string; // optional redirect link
};

function hexToRgba(hexColor: string, alpha: number): string {
  const hex = hexColor.replace("#", "");
  if (hex.length === 3) {
    const r = Number.parseInt(hex[0] + hex[0], 16);
    const g = Number.parseInt(hex[1] + hex[1], 16);
    const b = Number.parseInt(hex[2] + hex[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (hex.length === 6) {
    const r = Number.parseInt(hex.substring(0, 2), 16);
    const g = Number.parseInt(hex.substring(2, 4), 16);
    const b = Number.parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return hexColor;
}

const AnimatedBadge = ({
  text = "Introducing Eldoraui",
  color = "#22d3ee",
  href,
}: AnimatedBadgeProps) => {
  const content = (
    <motion.div
      className="group relative flex max-w-fit items-center justify-center gap-3 rounded-full border px-4 py-1.5 transition-all duration-300"
      initial={false}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
        e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.25)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)";
        e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.15)";
      }}
      style={{
        borderColor: "rgba(255, 255, 255, 0.15)",
        background: "rgba(255, 255, 255, 0.05)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        color: "rgba(255, 255, 255, 0.9)",
        cursor: "pointer",
      }}
      transition={{
        duration: 0.3,
        delay: 0.1,
        ease: "easeInOut",
      }}
      viewport={{ once: true }}
      whileInView={{
        opacity: 1,
        y: 0,
        filter: "blur(0px)",
      }}
    >
      <div className="pointer-events-none absolute inset-x-0 bottom-full h-20 w-[165px]">
        <svg
          className="h-full w-full"
          fill="none"
          height="100%"
          viewBox="0 0 50 50"
          width="100%"
        >
          {/* <g stroke="#fff" strokeWidth="0.4">
              <path d="M 69 49.8 h -30 q -3 0 -3 -3 v -15 q 0 -3 -3 -3 h -23 q -3 0 -3 -3 v -15 q 0 -3 -3 -3 h -30" />
            </g> */}
          <g mask="url(#ml-mask-1)">
            <circle
              className="multiline ml-light-1"
              cx="0"
              cy="0"
              fill="url(#ml-white-grad)"
              r="20"
            />
          </g>
          <defs>
            <mask id="ml-mask-1">
              <path
                d="M 69 49.8 h -30 q -3 0 -3 -3 v -13 q 0 -3 -3 -3 h -23 q -3 0 -3 -3 v -13 q 0 -3 -3 -3 h -30"
                stroke="white"
                strokeWidth="0.6"
              />
            </mask>
            <radialGradient fx="1" id="ml-white-grad">
              <stop offset="0%" stopColor={color} />
              <stop offset="20%" stopColor={color} />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
          </defs>
        </svg>
      </div>
      <div
        className="relative flex h-1 w-1 items-center justify-center rounded-full"
        style={{ backgroundColor: hexToRgba(color, 0.4) }}
      >
        <div
          className="flex h-2 w-2 animate-ping items-center justify-center rounded-full"
          style={{ backgroundColor: color }}
        >
          <div
            className="flex h-2 w-2 animate-ping items-center justify-center rounded-full"
            style={{ backgroundColor: color }}
          />
        </div>
        <div
          className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 flex h-1 w-1 items-center justify-center rounded-full"
          style={{ backgroundColor: hexToRgba(color, 0.8) }}
        />
      </div>
      <div
        className="mx-2 h-4 w-px"
        style={{ background: "rgba(255, 255, 255, 0.2)" }}
      />
      <span className="bg-clip-text font-medium text-xs">{text}</span>
      <ChevronRight
        className="ml-1 h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
        style={{ color: "rgba(255, 255, 255, 0.5)" }}
      />
    </motion.div>
  );
  return (
    <>
      {href ? (
        <Link className="inline-block" href={href}>
          {content}
        </Link>
      ) : (
        content
      )}
      <style>
        {`    
.multiline {
  offset-anchor: 10px 0px;
  animation: multiline-animation-path;
  animation-iteration-count: infinite;
  animation-timing-function: linear;
  animation-duration: 3s;
}

.ml-light-1 {
  offset-path: path(
    "M 69 49.8 h -30 q -3 0 -3 -3 v -13 q 0 -3 -3 -3 h -23 q -3 0 -3 -3 v -13 q 0 -3 -3 -3 h -50"
  );
}

@keyframes multiline-animation-path {
  0% {
    offset-distance: 0%;
  }
  50% {
    offset-distance: 100%;
  }
  100% {
    offset-distance: 100%;
  }
}`}
      </style>
    </>
  );
};

export default AnimatedBadge;
