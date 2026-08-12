"use client";
import { motion } from "motion/react";

type SpotlightProps = {
  gradientFirst?: string;
  gradientSecond?: string;
  gradientThird?: string;
  translateY?: number;
  width?: number;
  height?: number;
  smallWidth?: number;
  duration?: number;
  xOffset?: number;
};

export const Spotlight = ({
  gradientFirst = "radial-gradient(68.54% 68.72% at 55.02% 31.46%, hsla(210, 100%, 85%, .08) 0, hsla(210, 100%, 55%, .02) 50%, hsla(210, 100%, 45%, 0) 80%)",
  gradientSecond = "radial-gradient(50% 50% at 50% 50%, hsla(210, 100%, 85%, .06) 0, hsla(210, 100%, 55%, .02) 80%, transparent 100%)",
  gradientThird = "radial-gradient(50% 50% at 50% 50%, hsla(210, 100%, 85%, .04) 0, hsla(210, 100%, 45%, .02) 80%, transparent 100%)",
  translateY = -350,
  width = 560,
  height = 1380,
  smallWidth = 240,
  duration = 7,
  xOffset = 100,
}: SpotlightProps = {}) => (
  <motion.div
    animate={{
      opacity: 1,
    }}
    className="pointer-events-none absolute inset-0 h-full w-full"
    initial={{
      opacity: 0,
    }}
    transition={{
      duration: 1.5,
    }}
  >
    <motion.div
      animate={{
        x: [0, xOffset, 0],
      }}
      className="pointer-events-none absolute top-0 left-0 z-40 h-screen w-screen"
      transition={{
        duration,
        repeat: 0,
        repeatType: "reverse",
        ease: "easeInOut",
      }}
    >
      <div
        className={"absolute top-0 left-0"}
        style={{
          transform: `translateY(${translateY}px) rotate(-45deg)`,
          background: gradientFirst,
          width: `${width}px`,
          height: `${height}px`,
        }}
      />

      <div
        className={"absolute top-0 left-0 origin-top-left"}
        style={{
          transform: "rotate(-45deg) translate(5%, -50%)",
          background: gradientSecond,
          width: `${smallWidth}px`,
          height: `${height}px`,
        }}
      />

      <div
        className={"absolute top-0 left-0 origin-top-left"}
        style={{
          transform: "rotate(-45deg) translate(-180%, -70%)",
          background: gradientThird,
          width: `${smallWidth}px`,
          height: `${height}px`,
        }}
      />
    </motion.div>

    <motion.div
      animate={{
        x: [0, -xOffset, 0],
      }}
      className="pointer-events-none absolute top-0 right-0 z-40 h-screen w-screen"
      transition={{
        duration,
        repeat: 0,
        repeatType: "reverse",
        ease: "easeInOut",
      }}
    >
      <div
        className={"absolute top-0 right-0"}
        style={{
          transform: `translateY(${translateY}px) rotate(45deg)`,
          background: gradientFirst,
          width: `${width}px`,
          height: `${height}px`,
        }}
      />

      <div
        className={"absolute top-0 right-0 origin-top-right"}
        style={{
          transform: "rotate(45deg) translate(-5%, -50%)",
          background: gradientSecond,
          width: `${smallWidth}px`,
          height: `${height}px`,
        }}
      />

      <div
        className={"absolute top-0 right-0 origin-top-right"}
        style={{
          transform: "rotate(45deg) translate(180%, -70%)",
          background: gradientThird,
          width: `${smallWidth}px`,
          height: `${height}px`,
        }}
      />
    </motion.div>
  </motion.div>
);
