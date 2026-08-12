"use client";

import { hapticFeedback } from "@telegram-apps/sdk-react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";

import type { OnboardingCompletionMethod } from "@/app/telegram/onboarding-analytics";
import { ONBOARDING_COMPLETION_METHODS } from "@/app/telegram/onboarding-analytics";

const screens = [
  {
    title: "Group Summaries",
    description:
      "Filter noise and Instantly see what’s happening in group chats you don’t have time to read.",
    image: "/onboarding/on1.png",
  },
  {
    title: "Swipe Through Your DMs",
    description: "Quickly review and manage your Telegram DMs in one place.",
    image: "/onboarding/on2.png",
  },
  {
    title: "Private Transactions",
    description:
      "Send crypto privately over Telegram username. Don’t reveal your address and sensitive data onchain.",
    image: "/onboarding/on3.png",
  },
];

const swipeConfidenceThreshold = 10000;
const swipePower = (offset: number, velocity: number) =>
  Math.abs(offset) * velocity;

// Parallax: image travels further than text for a layered feel
const imageVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 400 : -400,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 400 : -400,
    opacity: 0,
  }),
};

const textVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 200 : -200,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 200 : -200,
    opacity: 0,
  }),
};

export default function Onboarding({
  onDone,
  headerHeight,
}: {
  onDone: (method: OnboardingCompletionMethod) => void;
  headerHeight: number;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [[page, direction], setPage] = useState([0, 0]);
  const isLast = currentIndex === screens.length - 1;

  // Preload all images on mount
  useEffect(() => {
    screens.forEach((screen) => {
      const img = new Image();
      img.src = screen.image;
    });
  }, []);

  const paginate = useCallback(
    (newDirection: number) => {
      const next = currentIndex + newDirection;
      if (next < 0 || next >= screens.length) return;
      if (hapticFeedback.impactOccurred.isAvailable()) {
        hapticFeedback.impactOccurred("light");
      }
      setCurrentIndex(next);
      setPage([page + newDirection, newDirection]);
    },
    [currentIndex, page]
  );

  const handleNext = () => {
    if (isLast) {
      onDone(ONBOARDING_COMPLETION_METHODS.completed);
    } else {
      paginate(1);
    }
  };

  const handleSkip = () => {
    onDone(ONBOARDING_COMPLETION_METHODS.skipped);
  };

  return (
    <div
      className="font-sans fixed inset-x-0 bottom-0 z-[60] flex flex-col bg-white"
      style={{
        top: headerHeight,
        paddingBottom:
          "calc(max(var(--tg-content-safe-area-inset-bottom, 0px), 8px) + 16px)",
      }}
    >
      {/* Pagination dots + skip */}
      <div className="relative flex shrink-0 items-center justify-center px-4 pt-4 pb-2">
        <div className="flex items-center gap-[6px]">
          {screens.map((_, i) => (
            <div
              key={i}
              className="h-[8px] w-[8px] rounded-full transition-colors duration-300"
              style={{
                backgroundColor:
                  i === currentIndex ? "#F9363C" : "rgba(249, 54, 60, 0.25)",
              }}
            />
          ))}
        </div>

        <AnimatePresence>
          {!isLast && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.15 }}
              onClick={handleSkip}
              className="absolute right-4 flex h-[44px] items-center justify-center rounded-full px-4"
              style={{ backgroundColor: "rgba(249, 54, 60, 0.14)" }}
            >
              <span className="font-medium text-[17px] leading-[22px] text-black">
                Skip
              </span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Swipeable content */}
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        onPointerDownCapture={(e) => {
          // Prevent text selection while swiping
          e.preventDefault();
        }}
      >
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <motion.div
            key={page}
            custom={direction}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ opacity: { duration: 0.15 } }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={1}
            onDragEnd={(_e, { offset, velocity }) => {
              const swipe = swipePower(offset.x, velocity.x);
              if (swipe < -swipeConfidenceThreshold) {
                paginate(1);
              } else if (swipe > swipeConfidenceThreshold) {
                paginate(-1);
              }
            }}
            className="absolute inset-0 flex flex-col items-center justify-center gap-8 px-8"
          >
            {/* Image — fixed-height wrapper prevents layout shift */}
            <motion.div
              key={`img-${page}`}
              custom={direction}
              variants={imageVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{
                x: { type: "spring", stiffness: 260, damping: 26 },
                opacity: { duration: 0.2 },
              }}
              className="flex w-full max-w-[400px] items-center justify-center"
              style={{ height: "min(50vh, 400px)" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={screens[currentIndex].image}
                alt={screens[currentIndex].title}
                className="max-h-full max-w-full object-contain"
                draggable={false}
              />
            </motion.div>

            {/* Text */}
            <motion.div
              key={`txt-${page}`}
              custom={direction}
              variants={textVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{
                x: { type: "spring", stiffness: 300, damping: 30 },
                opacity: { duration: 0.2 },
              }}
              className="flex shrink-0 flex-col items-center gap-1 text-center"
            >
              <h2 className="font-semibold text-[22px] leading-[28px] text-black">
                {screens[currentIndex].title}
              </h2>
              <p
                className="text-[17px] leading-[22px]"
                style={{ color: "rgba(60, 60, 67, 0.6)" }}
              >
                {screens[currentIndex].description}
              </p>
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom button */}
      <div className="shrink-0 px-8 pt-2">
        <button
          onClick={handleNext}
          className="flex h-[50px] w-full items-center justify-center rounded-full bg-black active:opacity-80"
        >
          <span className="text-[17px] leading-[22px] text-white">
            {isLast ? "Get Started" : "Next"}
          </span>
        </button>
      </div>
    </div>
  );
}
