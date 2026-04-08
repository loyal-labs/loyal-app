"use client";

import { AnimatePresence, motion, type PanInfo } from "motion/react";
import { memo, useState } from "react";
import { roadmapEvents } from "@/data/roadmap";

const GEIST = "var(--font-geist-sans), sans-serif";

function RoadmapSectionComponent() {
  const q2_2026Index = roadmapEvents.findIndex(
    (item) =>
      item.year === 2026 &&
      item.periodType === "Q" &&
      item.periodNumber === 2
  );
  const initialRoadmapIndex = q2_2026Index >= 0 ? q2_2026Index : 0;
  const [currentIndex, setCurrentIndex] = useState(initialRoadmapIndex);
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(true);

  const formatPeriod = (item: (typeof roadmapEvents)[0]) => {
    if (item.periodType === "Q") {
      return `Q${item.periodNumber} ${item.year}`;
    }
    if (item.periodType === "H") {
      return `H${item.periodNumber} ${item.year}`;
    }
    return `${item.year}`;
  };

  const getStatus = (item: (typeof roadmapEvents)[0]) => {
    if (item.isChecked) {
      return {
        label: "Completed",
        dotColor: "#34C759",
        textColor: "#34C759",
        bgColor: "rgba(52, 199, 89, 0.08)",
      };
    }

    if (item.isActive) {
      return {
        label: "In progress",
        dotColor: "#F9363C",
        textColor: "#F9363C",
        bgColor: "rgba(249, 54, 60, 0.08)",
      };
    }

    const hasCompletedEvents = item.events.some((event) => event.isChecked);

    if (hasCompletedEvents) {
      return {
        label: "In progress",
        dotColor: "#F9363C",
        textColor: "#F9363C",
        bgColor: "rgba(249, 54, 60, 0.08)",
      };
    }

    return {
      label: "Planned",
      dotColor: "rgba(60, 60, 67, 0.6)",
      textColor: "rgba(60, 60, 67, 0.6)",
      bgColor: "rgba(0, 0, 0, 0.04)",
    };
  };

  const toggleExpand = (index: number) => {
    if (index === currentIndex) {
      setIsDetailsExpanded((prev) => !prev);
    }
  };

  const nextSlide = () => {
    setCurrentIndex((prev) =>
      prev === roadmapEvents.length - 1 ? 0 : prev + 1
    );
  };

  const prevSlide = () => {
    setCurrentIndex((prev) =>
      prev === 0 ? roadmapEvents.length - 1 : prev - 1
    );
  };

  const goToSlide = (index: number) => {
    setCurrentIndex(index);
  };

  const handleDragEnd = (
    event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
    index: number
  ) => {
    const SWIPE_THRESHOLD = 50;
    if (info.offset.x > SWIPE_THRESHOLD && index === currentIndex) {
      prevSlide();
    } else if (info.offset.x < -SWIPE_THRESHOLD && index === currentIndex) {
      nextSlide();
    }
  };

  const cardVariants = {
    active: {
      x: 0,
      scale: 1,
      opacity: 1,
      zIndex: 10,
    },
    inactive: {
      scale: 1,
      opacity: 0.4,
      zIndex: 2,
    },
  };

  const cardTransition = { duration: 0.3, ease: "easeInOut" as const };

  return (
    <section
      id="roadmap-section"
      style={{
        padding: "64px 16px",
        background: "#FFFFFF",
        position: "relative",
        overflowX: "hidden",
        fontFamily: GEIST,
      }}
    >
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <h2
          style={{
            fontFamily: GEIST,
            fontSize: "48px",
            fontWeight: 600,
            color: "#000",
            textAlign: "center",
            marginBottom: "20px",
            letterSpacing: "-0.96px",
            lineHeight: "48px",
          }}
        >
          Roadmap
        </h2>
        <p
          style={{
            fontFamily: GEIST,
            fontSize: "24px",
            fontWeight: 400,
            color: "rgba(60, 60, 67, 0.6)",
            textAlign: "center",
            marginBottom: "64px",
            maxWidth: "800px",
            margin: "0 auto 64px",
            lineHeight: "28px",
          }}
        >
          Our journey to building the most private AI assistant
        </p>

        <div style={{ position: "relative" }}>
          {/* Navigation buttons */}
          <button
            className="desktop-nav-btn"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              prevSlide();
            }}
            style={{
              position: "absolute",
              left: "-60px",
              top: "50%",
              transform: "translateY(-50%)",
              zIndex: 100,
              background: "rgba(0, 0, 0, 0.04)",
              border: "none",
              borderRadius: "9999px",
              width: "48px",
              height: "48px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              transition: "background 0.2s ease",
            }}
            type="button"
          >
            <svg
              fill="none"
              height="20"
              style={{
                transform: "rotate(180deg)",
                color: "#3C3C43",
              }}
              viewBox="0 0 24 24"
              width="20"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M10.75 8.75L14.25 12L10.75 15.25"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
              />
            </svg>
          </button>
          <button
            className="desktop-nav-btn"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              nextSlide();
            }}
            style={{
              position: "absolute",
              right: "-60px",
              top: "50%",
              transform: "translateY(-50%)",
              zIndex: 100,
              background: "rgba(0, 0, 0, 0.04)",
              border: "none",
              borderRadius: "9999px",
              width: "48px",
              height: "48px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              transition: "background 0.2s ease",
            }}
            type="button"
          >
            <svg
              fill="none"
              height="20"
              style={{ color: "#3C3C43" }}
              viewBox="0 0 24 24"
              width="20"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M10.75 8.75L14.25 12L10.75 15.25"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
              />
            </svg>
          </button>

          {/* Carousel container */}
          <div
            style={{
              position: "relative",
              overflow: "hidden",
              height: "400px",
              touchAction: "pan-y",
            }}
          >
            {/* Edge fade gradients */}
            <div
              onClick={prevSlide}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: "96px",
                background:
                  "linear-gradient(to right, #FFFFFF 0%, rgba(255, 255, 255, 0) 100%)",
                zIndex: 5,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
                paddingLeft: "0.75rem",
              }}
            >
              <svg
                className="mobile-nav-chevron"
                fill="none"
                height="32"
                style={{
                  color: "rgba(60, 60, 67, 0.6)",
                  transform: "rotate(180deg)",
                }}
                viewBox="0 0 24 24"
                width="32"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M10.75 8.75L14.25 12L10.75 15.25"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                />
              </svg>
            </div>
            <div
              onClick={nextSlide}
              style={{
                position: "absolute",
                right: 0,
                top: 0,
                bottom: 0,
                width: "96px",
                background:
                  "linear-gradient(to left, #FFFFFF 0%, rgba(255, 255, 255, 0) 100%)",
                zIndex: 5,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                paddingRight: "0.75rem",
              }}
            >
              <svg
                className="mobile-nav-chevron"
                fill="none"
                height="32"
                style={{
                  color: "rgba(60, 60, 67, 0.6)",
                }}
                viewBox="0 0 24 24"
                width="32"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M10.75 8.75L14.25 12L10.75 15.25"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                />
              </svg>
            </div>
            {/* CSS for responsive navigation */}
            <style jsx>{`
              @media (max-width: 767px) {
                .desktop-nav-btn {
                  display: none !important;
                }
              }
              @media (min-width: 768px) {
                .mobile-nav-chevron {
                  display: none;
                }
              }
            `}</style>

            <div
              style={{
                display: "flex",
                height: "100%",
                alignItems: "center",
                justifyContent: "center",
                gap: "20px",
              }}
            >
              {roadmapEvents.map((item, index) => {
                const status = getStatus(item);

                return (
                  <motion.div
                    animate={index === currentIndex ? "active" : "inactive"}
                    drag="x"
                    dragConstraints={{ left: -50, right: 50 }}
                    dragElastic={0.1}
                    initial="inactive"
                    key={index}
                    onClick={() => {
                      if (index !== currentIndex) {
                        goToSlide(index);
                      }
                    }}
                    onDragEnd={(e, info) => handleDragEnd(e, info, index)}
                    style={{
                      position: "absolute",
                      width: "288px",
                      x: `${Math.round((index - currentIndex) * 308)}px`,
                      willChange: "transform",
                      transform: "translateZ(0)",
                      cursor: index !== currentIndex ? "pointer" : "default",
                    }}
                    transition={cardTransition}
                    variants={cardVariants}
                  >
                    <motion.div
                      layout
                      style={{ width: "100%" }}
                      transition={{ duration: 0.3, ease: "easeInOut" }}
                    >
                      <div
                        style={{
                          position: "relative",
                          background: "#F5F5F5",
                          borderRadius: "24px",
                          overflow: "hidden",
                          fontFamily: GEIST,
                        }}
                      >
                        {/* Card header */}
                        <div
                          onClick={() => toggleExpand(index)}
                          style={{
                            padding: "32px 16px",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            textAlign: "center",
                            cursor:
                              index === currentIndex ? "pointer" : "default",
                          }}
                        >
                          {/* Quarter label */}
                          <h3
                            style={{
                              fontSize: "20px",
                              fontWeight: 600,
                              lineHeight: "24px",
                              color: "#000",
                              marginBottom: "12px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {formatPeriod(item)}
                          </h3>

                          {/* Status badge */}
                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "6px",
                              padding: "4px 12px 4px 8px",
                              borderRadius: "100px",
                              background: status.bgColor,
                            }}
                          >
                            <div
                              style={{
                                width: "8px",
                                height: "8px",
                                borderRadius: "50%",
                                background: status.dotColor,
                                flexShrink: 0,
                              }}
                            />
                            <span
                              style={{
                                fontSize: "14px",
                                fontWeight: 400,
                                lineHeight: "20px",
                                color: status.textColor,
                              }}
                            >
                              {status.label}
                            </span>
                          </div>

                          {/* Expand indicator */}
                          {index === currentIndex && (
                            <motion.div
                              animate={{
                                rotate: isDetailsExpanded ? 180 : 0,
                              }}
                              style={{ marginTop: "12px" }}
                              transition={{ duration: 0.3 }}
                            >
                              <svg
                                fill="none"
                                height="20"
                                style={{ color: "rgba(60, 60, 67, 0.6)" }}
                                viewBox="0 0 24 24"
                                width="20"
                                xmlns="http://www.w3.org/2000/svg"
                              >
                                <path
                                  d="M6 9L12 15L18 9"
                                  stroke="currentColor"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth="2"
                                />
                              </svg>
                            </motion.div>
                          )}
                        </div>

                        {/* Expanded content */}
                        <AnimatePresence>
                          {isDetailsExpanded && index === currentIndex && (
                            <motion.div
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              initial={{ height: 0, opacity: 0 }}
                              style={{ overflow: "hidden" }}
                              transition={{
                                duration: 0.3,
                                ease: "easeInOut",
                              }}
                            >
                              <div
                                style={{
                                  padding: "0 20px 20px 20px",
                                }}
                              >
                                <h4
                                  style={{
                                    fontSize: "14px",
                                    fontWeight: 600,
                                    lineHeight: "20px",
                                    color: "#000",
                                    marginBottom: "12px",
                                  }}
                                >
                                  Events
                                </h4>
                                <ul
                                  style={{
                                    display: "grid",
                                    gap: "8px",
                                    listStyle: "none",
                                    margin: 0,
                                    padding: 0,
                                  }}
                                >
                                  {item.events.map((event, i) => (
                                    <motion.li
                                      animate={{ opacity: 1, x: 0 }}
                                      initial={{ opacity: 0, x: -20 }}
                                      key={i}
                                      style={{
                                        display: "flex",
                                        alignItems: "flex-start",
                                        gap: "8px",
                                      }}
                                      transition={{
                                        duration: 0.3,
                                        delay: i * 0.1,
                                        ease: "easeOut",
                                      }}
                                    >
                                      <div
                                        style={{
                                          width: "8px",
                                          height: "20px",
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          flexShrink: 0,
                                        }}
                                      >
                                        <div
                                          style={{
                                            width: "6px",
                                            height: "6px",
                                            borderRadius: "50%",
                                            background: event.isChecked
                                              ? "#34C759"
                                              : item.isChecked
                                                ? "#FFCC00"
                                                : "#F9363C",
                                          }}
                                        />
                                      </div>
                                      <span
                                        style={{
                                          fontSize: "14px",
                                          fontWeight: 400,
                                          lineHeight: "20px",
                                          color: "rgba(60, 60, 67, 0.6)",
                                        }}
                                      >
                                        {event.title}
                                      </span>
                                    </motion.li>
                                  ))}
                                </ul>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* Pagination dots */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              paddingTop: "32px",
              gap: "8px",
            }}
          >
            {roadmapEvents.map((_, index) => (
              <button
                aria-label={`Go to slide ${index + 1}`}
                key={index}
                onClick={() => goToSlide(index)}
                style={{
                  width: index === currentIndex ? "24px" : "6px",
                  height: "6px",
                  borderRadius: "100px",
                  background: "#F9363C",
                  opacity: index === currentIndex ? 0.6 : 0.14,
                  border: "none",
                  cursor: "pointer",
                  transition: "all 0.3s ease",
                  padding: 0,
                }}
                type="button"
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export const RoadmapSection = memo(RoadmapSectionComponent);
