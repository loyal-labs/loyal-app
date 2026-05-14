"use client";

import Image from "next/image";
import { useMemo, useState } from "react";

import { roadmapEvents, type RoadmapEvent } from "@/data/roadmap";

const CARD_WIDTH = 360;
const CARD_GAP = 24;

function formatPeriod(item: RoadmapEvent) {
  if (item.periodType === "Q") {
    return `Q${item.periodNumber} ${item.year}`;
  }

  if (item.periodType === "H") {
    return `H${item.periodNumber} ${item.year}`;
  }

  return `${item.year}`;
}

function getStatus(item: RoadmapEvent) {
  if (item.isChecked) {
    return {
      label: "Completed",
      dotClass: "bg-[#34c759]",
      textClass: "text-[#147a2e]",
      badgeClass: "bg-[#34c759]/10",
    };
  }

  if (item.isActive || item.events.some((event) => event.isChecked)) {
    return {
      label: "In progress",
      dotClass: "bg-[#f9363c]",
      textClass: "text-[#f9363c]",
      badgeClass: "bg-[#f9363c]/10",
    };
  }

  return {
    label: "Planned",
    dotClass: "bg-black/35",
    textClass: "text-black/45",
    badgeClass: "bg-black/[0.04]",
  };
}

export function LandingRoadmap() {
  const initialIndex = useMemo(() => {
    const activeIndex = roadmapEvents.findIndex((item) => item.isActive);
    return activeIndex >= 0 ? activeIndex : 0;
  }, []);

  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const currentItem = roadmapEvents[currentIndex];
  const currentStatus = getStatus(currentItem);

  const previous = () => {
    setCurrentIndex((index) =>
      index === 0 ? roadmapEvents.length - 1 : index - 1
    );
  };

  const next = () => {
    setCurrentIndex((index) =>
      index === roadmapEvents.length - 1 ? 0 : index + 1
    );
  };

  return (
    <section className="w-full bg-white py-24" id="roadmap">
      <div>
        <div className="mx-auto flex max-w-[560px] items-center justify-between gap-6 px-4 pb-12 lg:max-w-[1560px] lg:px-6">
          <h2
            className="text-[48px] font-semibold leading-[48px] text-black"
            data-reveal="left"
          >
            Roadmap
          </h2>

          <div className="flex items-center gap-2" data-reveal="right">
            <button
              aria-label="Previous roadmap item"
              className="grid h-12 w-12 place-items-center rounded-full bg-black/[0.04] transition duration-150 ease-out hover:-translate-x-0.5 hover:bg-black/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black active:translate-x-0"
              onClick={previous}
              type="button"
            >
              <Image
                alt=""
                aria-hidden="true"
                height={20}
                src="/landing/figma/roadmap-arrow.svg"
                width={20}
              />
            </button>
            <button
              aria-label="Next roadmap item"
              className="grid h-12 w-12 place-items-center rounded-full bg-black/[0.04] transition duration-150 ease-out hover:translate-x-0.5 hover:bg-black/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black active:translate-x-0"
              onClick={next}
              type="button"
            >
              <Image
                alt=""
                aria-hidden="true"
                className="rotate-180"
                height={20}
                src="/landing/figma/roadmap-arrow.svg"
                width={20}
              />
            </button>
          </div>
        </div>

        <div
          className="relative h-[478px] overflow-hidden bg-[#f5f5f5]"
          data-reveal="lift"
          data-reveal-delay="1"
        >
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 hidden w-20 bg-gradient-to-r from-[#f5f5f5] to-transparent lg:block" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 hidden w-20 bg-gradient-to-l from-[#f5f5f5] to-transparent lg:block" />

          <article className="mx-auto my-4 flex h-[calc(100%-32px)] w-[calc(100%-32px)] max-w-[528px] flex-col rounded-[24px] bg-white p-5 lg:hidden">
            <div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span
                    className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3 py-2 text-[13px] leading-4 ${currentStatus.badgeClass} ${currentStatus.textClass}`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${currentStatus.dotClass}`}
                    />
                    {currentStatus.label}
                  </span>
                  <h3 className="mt-2 text-[44px] font-semibold leading-[44px] text-black">
                    {formatPeriod(currentItem)}
                  </h3>
                </div>
              </div>

              <ul className="mt-7 grid gap-3">
                {currentItem.events.map((event) => (
                  <li
                    className="flex items-start gap-3 text-[15px] leading-5 text-black"
                    key={event.title}
                  >
                    <span
                      className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${
                        event.isChecked ? "bg-[#34c759]" : "bg-[#f9363c]"
                      }`}
                    />
                    <span
                      className={
                        event.isChecked ? "text-black" : "text-black/62"
                      }
                    >
                      {event.title}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </article>

          <div
            className="absolute left-1/2 hidden h-full items-center gap-6 transition-transform duration-500 ease-out lg:flex"
            style={{
              transform: `translateX(-${
                currentIndex * (CARD_WIDTH + CARD_GAP) + CARD_WIDTH / 2
              }px)`,
            }}
          >
            {roadmapEvents.map((item, index) => {
              const status = getStatus(item);
              const isCurrent = index === currentIndex;

              return (
                <button
                  aria-label={`Show ${formatPeriod(item)} roadmap item`}
                  className={`flex h-[342px] w-[360px] shrink-0 cursor-pointer flex-col justify-between rounded-[24px] bg-white p-6 text-left transition duration-500 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black ${
                    isCurrent
                      ? "scale-100 opacity-100"
                      : "scale-[0.92] opacity-45 hover:scale-[0.95] hover:opacity-65"
                  }`}
                  key={`${item.year}-${item.periodType}-${item.periodNumber}`}
                  onClick={() => setCurrentIndex(index)}
                  type="button"
                >
                  <div>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <span
                          className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3 py-2 text-[14px] leading-4 ${status.badgeClass} ${status.textClass}`}
                        >
                          <span
                            className={`h-2 w-2 rounded-full ${status.dotClass}`}
                          />
                          {status.label}
                        </span>
                        <h3 className="mt-2 text-[48px] font-semibold leading-[48px] text-black">
                          {formatPeriod(item)}
                        </h3>
                      </div>
                    </div>

                    <ul className="mt-8 grid gap-3">
                      {item.events.map((event) => (
                        <li
                          className="flex items-start gap-3 text-[16px] leading-5 text-black"
                          key={event.title}
                        >
                          <span
                            className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${
                              event.isChecked ? "bg-[#34c759]" : "bg-[#f9363c]"
                            }`}
                          />
                          <span
                            className={
                              event.isChecked ? "text-black" : "text-black/62"
                            }
                          >
                            {event.title}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
