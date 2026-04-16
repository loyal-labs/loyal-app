import { useCallback, useEffect, useRef, useState } from "react";

import bannerFollowImg from "~/assets/banner-follow.png";
import bannerEarnImg from "~/assets/banner-earn.png";

// ---------------------------------------------------------------------------
// Types & config
// ---------------------------------------------------------------------------

interface Banner {
  id: string;
  title: string;
  cta: string;
  image: string;
  onClick: () => void;
}

const AUTO_ROTATE_MS = 4000;
const SLIDE_DURATION_MS = 250;

const FONT = "var(--font-geist-sans), sans-serif";

// ---------------------------------------------------------------------------
// Banner card
// ---------------------------------------------------------------------------

function BannerCard({ banner }: { banner: Banner }) {
  const [btnHovered, setBtnHovered] = useState(false);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        borderRadius: "20px",
        overflow: "hidden",
        background:
          "linear-gradient(90deg, rgba(249,54,60,0) 0%, rgba(249,54,60,0.14) 100%), #F5F5F5",
        display: "flex",
        alignItems: "stretch",
        height: "96px",
      }}
    >
      {/* Text + CTA */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "12px 0 12px 16px",
          gap: "8px",
          zIndex: 1,
          minWidth: 0,
        }}
      >
        <p
          style={{
            fontFamily: FONT,
            fontSize: "15px",
            fontWeight: 500,
            lineHeight: "20px",
            color: "#000",
            letterSpacing: "-0.187px",
            margin: 0,
            maxWidth: "180px",
          }}
        >
          {banner.title}
        </p>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            banner.onClick();
          }}
          onMouseEnter={() => setBtnHovered(true)}
          onMouseLeave={() => setBtnHovered(false)}
          style={{
            alignSelf: "flex-start",
            background: btnHovered ? "#e0292f" : "#F9363C",
            color: "#fff",
            border: "none",
            borderRadius: "20px",
            padding: "6px 14px",
            fontFamily: FONT,
            fontSize: "13px",
            fontWeight: 400,
            lineHeight: "18px",
            cursor: "pointer",
            transition: "background 0.15s ease",
          }}
        >
          {banner.cta}
        </button>
      </div>

      {/* Image */}
      <div
        style={{
          position: "absolute",
          right: 0,
          bottom: 0,
          width: "140px",
          height: "100%",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "flex-end",
          pointerEvents: "none",
        }}
      >
        <img
          src={banner.image}
          alt=""
          style={{
            width: "100%",
            height: "auto",
            objectFit: "contain",
            objectPosition: "right bottom",
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Carousel
// ---------------------------------------------------------------------------

export function BannerCarousel({
  onShieldUsdc,
}: {
  onShieldUsdc: () => void;
}) {
  const banners: Banner[] = [
    {
      id: "earn",
      title: "Shield Assets and Earn up to 5.21% APY",
      cta: "Shield Now",
      image: bannerEarnImg,
      onClick: onShieldUsdc,
    },
    {
      id: "follow",
      title: "Follow Loyal on X",
      cta: "Follow",
      image: bannerFollowImg,
      onClick: () => {
        globalThis.open("https://x.com/loyal_hq", "_blank", "noopener,noreferrer");
      },
    },
  ];

  const [activeIndex, setActiveIndex] = useState(0);
  const [direction, setDirection] = useState<"left" | "right">("left");
  const [animating, setAnimating] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const goTo = useCallback(
    (index: number, dir: "left" | "right") => {
      if (animating || index === activeIndex) return;
      setDirection(dir);
      setAnimating(true);
      setActiveIndex(index);
      setTimeout(() => setAnimating(false), SLIDE_DURATION_MS);
    },
    [animating, activeIndex]
  );

  const next = useCallback(() => {
    const nextIdx = (activeIndex + 1) % banners.length;
    goTo(nextIdx, "left");
  }, [activeIndex, banners.length, goTo]);

  // Auto-rotate
  useEffect(() => {
    timerRef.current = setInterval(next, AUTO_ROTATE_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [next]);

  if (banners.length === 0) return null;

  return (
    <div style={{ padding: "0 8px", width: "100%", boxSizing: "border-box" }}>
      {/* Banner */}
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: "20px",
        }}
      >
        <div
          key={activeIndex}
          style={{
            animation: animating
              ? `banner-slide-${direction} ${SLIDE_DURATION_MS}ms ease forwards`
              : undefined,
          }}
        >
          <BannerCard banner={banners[activeIndex]} />
        </div>
      </div>

      {/* Dots */}
      {banners.length > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "6px",
            padding: "8px 0 0",
          }}
        >
          {banners.map((b, i) => (
            <button
              key={b.id}
              type="button"
              onClick={() => goTo(i, i > activeIndex ? "left" : "right")}
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "9999px",
                border: "none",
                padding: 0,
                cursor: "pointer",
                background: i === activeIndex ? "#F9363C" : "rgba(0, 0, 0, 0.12)",
                transition: "background 0.2s ease",
              }}
            />
          ))}
        </div>
      )}

      {/* Slide animations */}
      <style>{`
        @keyframes banner-slide-left {
          from { opacity: 0; transform: translateX(30px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes banner-slide-right {
          from { opacity: 0; transform: translateX(-30px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
