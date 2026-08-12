"use client";

import { ArrowUpToLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";
import { openTrackedLink } from "@/lib/core/analytics";

export interface HeroNavProps {
  isScrolledToAbout: boolean;
  isScrolledToRoadmap: boolean;
  isScrolledToBlog: boolean;
  isScrolledToLinks: boolean;
  onScrollToAbout: () => void;
  onScrollToRoadmap: () => void;
  onScrollToBlog: () => void;
  onScrollToLinks: () => void;
  onBackToTop: () => void;
}

export function HeroNav({
  isScrolledToAbout,
  isScrolledToRoadmap,
  isScrolledToBlog,
  isScrolledToLinks,
  onScrollToAbout,
  onScrollToRoadmap,
  onScrollToBlog,
  onScrollToLinks,
  onBackToTop,
}: HeroNavProps) {
  const publicEnv = usePublicEnv();
  const [hoveredNavIndex, setHoveredNavIndex] = useState<number | null>(null);
  const navItemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const prevScrolledToAbout = useRef(false);
  const prevScrolledToRoadmap = useRef(false);
  const prevScrolledToBlog = useRef(false);
  const prevScrolledToLinks = useRef(false);

  // Reset hover state when About or Roadmap button changes to/from icon mode
  // This forces the hover indicator to recalculate its position after DOM updates
  useEffect(() => {
    // Only recalculate if the state actually changed (not just on every render)
    const aboutChanged = prevScrolledToAbout.current !== isScrolledToAbout;
    const roadmapChanged =
      prevScrolledToRoadmap.current !== isScrolledToRoadmap;
    const blogChanged = prevScrolledToBlog.current !== isScrolledToBlog;
    const linksChanged = prevScrolledToLinks.current !== isScrolledToLinks;

    if (
      (aboutChanged || roadmapChanged || blogChanged || linksChanged) &&
      (hoveredNavIndex === 0 || hoveredNavIndex === 1 || hoveredNavIndex === 2 || hoveredNavIndex === 3)
    ) {
      // Index 0 is About, Index 1 is Roadmap, Index 2 is Blog, Index 3 is Links
      const currentIndex = hoveredNavIndex;
      setHoveredNavIndex(null);
      // Use double requestAnimationFrame to ensure layout has been recalculated
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setHoveredNavIndex(currentIndex);
        });
      });
    }

    prevScrolledToAbout.current = isScrolledToAbout;
    prevScrolledToRoadmap.current = isScrolledToRoadmap;
    prevScrolledToBlog.current = isScrolledToBlog;
    prevScrolledToLinks.current = isScrolledToLinks;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isScrolledToAbout, isScrolledToRoadmap, isScrolledToBlog, isScrolledToLinks]);

  return (
    <nav
      className="hidden md:flex"
      onMouseLeave={() => setHoveredNavIndex(null)}
      style={{
        position: "fixed",
        top: "12px",
        left: "50%",
        transform: "translateX(-50%)",
        alignItems: "center",
        gap: "1.5rem",
        background: "rgba(241, 241, 241, 0.7)",
        backdropFilter: "blur(48px)",
        borderRadius: "60px",
        padding: "4px",
        zIndex: 60,
      }}
    >
      {/* Nav items group */}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
        }}
      >
        {/* Sliding hover indicator */}
        {hoveredNavIndex !== null &&
          navItemRefs.current[hoveredNavIndex] && (
            <div
              style={{
                position: "absolute",
                top: "50%",
                left:
                  navItemRefs.current[hoveredNavIndex]?.offsetLeft || 0,
                width:
                  navItemRefs.current[hoveredNavIndex]?.offsetWidth ||
                  0,
                height:
                  navItemRefs.current[hoveredNavIndex]?.offsetHeight ||
                  0,
                transform: "translateY(-50%)",
                background: "rgba(0, 0, 0, 0.04)",
                backdropFilter: "blur(48px)",
                borderRadius: "9999px",
                boxShadow:
                  "0px 4px 8px 0px rgba(0, 0, 0, 0.04), 0px 2px 4px 0px rgba(0, 0, 0, 0.02)",
                transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                pointerEvents: "none",
                zIndex: 0,
              }}
            />
          )}
        {[
          {
            label: "About",
            onClick: isScrolledToAbout
              ? onBackToTop
              : onScrollToAbout,
            isAbout: true,
          },
          {
            label: "Roadmap",
            onClick: isScrolledToRoadmap
              ? onBackToTop
              : onScrollToRoadmap,
            isRoadmap: true,
          },
          {
            label: "Blog",
            onClick: isScrolledToBlog
              ? onBackToTop
              : onScrollToBlog,
            isBlog: true,
          },
          {
            label: "Links",
            onClick: isScrolledToLinks
              ? onBackToTop
              : onScrollToLinks,
            isLinks: true,
          },
          { label: "Docs", href: "https://docs.askloyal.com/" },
        ].map((item, index) => (
          <button
            key={item.label}
            onClick={
              item.href
                ? () =>
                    openTrackedLink(publicEnv, {
                      href: item.href,
                      linkText: item.label,
                      source: "hero_nav",
                    })
                : item.onClick
            }
            onMouseEnter={() => setHoveredNavIndex(index)}
            ref={(el) => {
              navItemRefs.current[index] = el;
            }}
            style={{
              position: "relative",
              color: "#000",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "16px",
              fontWeight: 400,
              lineHeight: "20px",
              fontFeatureSettings: "'liga' off, 'clig' off",
              padding: "8px 16px",
              background: "transparent",
              border: "none",
              borderRadius: "9999px",
              cursor: "pointer",
              transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
              outline: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              zIndex: 1,
              filter:
                (item.isAbout && isScrolledToAbout) ||
                (item.isRoadmap && isScrolledToRoadmap) ||
                (item.isBlog && isScrolledToBlog) ||
                (item.isLinks && isScrolledToLinks)
                  ? "drop-shadow(0 0 8px rgba(0, 0, 0, 0.3))"
                  : "none",
              overflow: "hidden",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                opacity:
                  (item.isAbout && isScrolledToAbout) ||
                  (item.isRoadmap && isScrolledToRoadmap) ||
                  (item.isBlog && isScrolledToBlog) ||
                  (item.isLinks && isScrolledToLinks)
                    ? 1
                    : 0,
                transform:
                  (item.isAbout && isScrolledToAbout) ||
                  (item.isRoadmap && isScrolledToRoadmap) ||
                  (item.isBlog && isScrolledToBlog) ||
                  (item.isLinks && isScrolledToLinks)
                    ? "scale(1) translateY(0)"
                    : "scale(0.8) translateY(4px)",
                transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                position:
                  (item.isAbout && isScrolledToAbout) ||
                  (item.isBlog && isScrolledToBlog) ||
                  (item.isLinks && isScrolledToLinks)
                    ? "relative"
                    : "absolute",
                pointerEvents:
                  (item.isAbout && isScrolledToAbout) ||
                  (item.isBlog && isScrolledToBlog) ||
                  (item.isLinks && isScrolledToLinks)
                    ? "auto"
                    : "none",
              }}
            >
              {(item.isAbout || item.isRoadmap || item.isBlog || item.isLinks) && (
                <ArrowUpToLine size={18} />
              )}
            </span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                opacity:
                  (item.isAbout && isScrolledToAbout) ||
                  (item.isRoadmap && isScrolledToRoadmap) ||
                  (item.isBlog && isScrolledToBlog) ||
                  (item.isLinks && isScrolledToLinks)
                    ? 0
                    : 1,
                transform:
                  (item.isAbout && isScrolledToAbout) ||
                  (item.isRoadmap && isScrolledToRoadmap) ||
                  (item.isBlog && isScrolledToBlog) ||
                  (item.isLinks && isScrolledToLinks)
                    ? "scale(0.8) translateY(-4px)"
                    : "scale(1) translateY(0)",
                transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                position:
                  (item.isAbout && isScrolledToAbout) ||
                  (item.isBlog && isScrolledToBlog) ||
                  (item.isLinks && isScrolledToLinks)
                    ? "absolute"
                    : "relative",
                pointerEvents:
                  (item.isAbout && isScrolledToAbout) ||
                  (item.isBlog && isScrolledToBlog) ||
                  (item.isLinks && isScrolledToLinks)
                    ? "none"
                    : "auto",
              }}
            >
              {item.label}
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}
