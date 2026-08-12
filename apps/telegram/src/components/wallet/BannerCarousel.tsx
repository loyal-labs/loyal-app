"use client";

import { addToHomeScreen, postEvent } from "@telegram-apps/sdk";
import { hapticFeedback } from "@telegram-apps/sdk-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  trackWalletBannerClose,
  trackWalletBannerPress,
} from "@/components/wallet/banner-analytics";
import {
  getCachedDismissedBannerIds,
  loadDismissedBannerIds,
  saveDismissedBannerIds,
} from "@/components/wallet/banner-dismissals";
import { setLoyalEmojiStatus } from "@/lib/telegram/mini-app/emoji-status";

type Banner = {
  id: string;
  title: string;
  cta: string;
  image: string;
  onPress: () => void;
};

const SWIPE_THRESHOLD = 30;
const SLIDE_DURATION = 180;
const AUTO_ROTATE_INTERVAL = 3000;

type TrackedBannerConfig = {
  id: string;
  title: string;
  cta: string;
  image: string;
  action: () => void;
};

const createTrackedBanner = ({
  id,
  title,
  cta,
  image,
  action,
}: TrackedBannerConfig): Banner => ({
  id,
  title,
  cta,
  image,
  onPress: () => {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    trackWalletBannerPress(id);
    action();
  },
});

function BannerCard({
  banner,
  onClose,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
}: {
  banner: Banner;
  onClose: () => void;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
}) {
  return (
    <div
      className="relative w-full rounded-[20px] overflow-clip h-[112px]"
      style={{
        backgroundImage:
          "linear-gradient(90deg, rgba(249, 54, 60, 0) 0%, rgba(249, 54, 60, 0.14) 100%), linear-gradient(90deg, #f2f2f7 0%, #f2f2f7 100%)",
        touchAction: "pan-y",
      }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className="flex flex-col justify-between h-full pl-4 pr-[172px] py-3">
        <p className="font-medium text-[17px] leading-[22px] tracking-[-0.187px] text-black">
          {banner.title}
        </p>
        <button
          className="flex items-center justify-center min-w-[72px] w-fit px-3 py-2 rounded-[20px] font-normal text-[15px] leading-5 text-white active:opacity-80 transition-opacity"
          style={{ backgroundColor: "#f9363c" }}
          onClick={banner.onPress}
        >
          {banner.cta}
        </button>
      </div>

      {/* Mascot image */}
      <div className="absolute bottom-0 right-0 w-[172px] h-[112px] rounded-br-[20px] pointer-events-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={banner.image}
          alt=""
          className="absolute bottom-0 right-0 w-[85%] h-auto"
        />
      </div>

      {/* Close button */}
      <button
        className="absolute top-[10px] right-[10px] w-[28px] h-[28px] z-10 active:opacity-60 transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/banners/close_icon.png" alt="Close" className="w-full h-full" />
      </button>
    </div>
  );
}

export type BannerCarouselProps = {
  isMobilePlatform: boolean;
};

export default function BannerCarousel({
  isMobilePlatform,
}: BannerCarouselProps) {
  const router = useRouter();
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(
    () => getCachedDismissedBannerIds() ?? new Set()
  );

  useEffect(() => {
    if (getCachedDismissedBannerIds()) return;

    let isCancelled = false;

    const loadDismissed = async () => {
      const ids = await loadDismissedBannerIds();
      if (isCancelled) return;
      setDismissedIds(ids);
    };

    void loadDismissed();

    return () => {
      isCancelled = true;
    };
  }, []);

  const allBanners = useMemo(() => {
    const list: Banner[] = [];

    if (isMobilePlatform) {
      list.push(createTrackedBanner({
        id: "home-screen",
        title: "Add App to Home Screen",
        cta: "Add",
        image: "/banners/banner1.png",
        action: () => {
          if (addToHomeScreen.isAvailable()) {
            addToHomeScreen();
          } else {
            postEvent("web_app_add_to_home_screen");
          }
        },
      }));
    }

    list.push(createTrackedBanner({
      id: "emoji-status",
      title: "Set Emoji Status",
      cta: "Set",
      image: "/banners/banner2.png",
      action: () => {
        void setLoyalEmojiStatus();
      },
    }));

    list.push(createTrackedBanner({
      id: "community-summary",
      title: "View Community Summary",
      cta: "View",
      image: "/banners/banner3.png",
      action: () => {
        router.push("/telegram/summaries");
      },
    }));

    return list;
  }, [isMobilePlatform]); // eslint-disable-line react-hooks/exhaustive-deps -- router is intentionally omitted: it's unstable (new ref each render) and callbacks only use router.push on click, which works from stale closures

  const banners = useMemo(
    () => allBanners.filter((b) => !dismissedIds.has(b.id)),
    [allBanners, dismissedIds],
  );

  const [activeIndex, setActiveIndex] = useState(0);
  const [swipeX, setSwipeX] = useState(0);
  const [slideDirection, setSlideDirection] = useState<
    "left" | "right" | null
  >(null);
  const [isSliding, setIsSliding] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);

  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const isSwipingRef = useRef(false);
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const bannersRef = useRef(banners);
  bannersRef.current = banners;

  // Preload all banner images on mount
  useEffect(() => {
    for (const banner of banners) {
      const img = new Image();
      img.src = banner.image;
    }
  }, [banners]);

  // Auto-rotate timer
  useEffect(() => {
    if (!autoRotate || bannersRef.current.length <= 1) return;

    const timer = setInterval(() => {
      const count = bannersRef.current.length;
      const next = (activeIndexRef.current + 1) % count;
      setSlideDirection("left");
      setIsSliding(true);
      setActiveIndex(next);

      setTimeout(() => {
        setIsSliding(false);
        setSlideDirection(null);
      }, SLIDE_DURATION);
    }, AUTO_ROTATE_INTERVAL);

    return () => clearInterval(timer);
  }, [autoRotate]);

  const goTo = useCallback(
    (index: number, direction: "left" | "right") => {
      const count = banners.length;
      const wrapped = ((index % count) + count) % count;
      if (wrapped === activeIndex) return;

      if (hapticFeedback.impactOccurred.isAvailable()) {
        hapticFeedback.impactOccurred("light");
      }

      setAutoRotate(false);
      setSlideDirection(direction);
      setIsSliding(true);
      setActiveIndex(wrapped);

      setTimeout(() => {
        setIsSliding(false);
        setSlideDirection(null);
      }, SLIDE_DURATION);
    },
    [activeIndex, banners.length],
  );

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
    isSwipingRef.current = false;
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStartRef.current) return;

      const deltaX = e.touches[0].clientX - touchStartRef.current.x;
      const deltaY = e.touches[0].clientY - touchStartRef.current.y;

      if (
        !isSwipingRef.current &&
        Math.abs(deltaX) > 10 &&
        Math.abs(deltaX) > Math.abs(deltaY) * 1.2
      ) {
        isSwipingRef.current = true;
      }

      if (isSwipingRef.current) {
        setSwipeX(deltaX * 0.5);

        if (
          Math.abs(deltaX) >= SWIPE_THRESHOLD &&
          Math.abs(deltaX - (deltaX > 0 ? 5 : -5)) < SWIPE_THRESHOLD
        ) {
          if (hapticFeedback.selectionChanged.isAvailable()) {
            hapticFeedback.selectionChanged();
          }
        }
      }
    },
    [],
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStartRef.current) return;

      const deltaX =
        e.changedTouches[0].clientX - touchStartRef.current.x;
      const deltaY =
        e.changedTouches[0].clientY - touchStartRef.current.y;

      if (
        Math.abs(deltaX) > SWIPE_THRESHOLD &&
        Math.abs(deltaX) > Math.abs(deltaY) * 1.2
      ) {
        if (deltaX < 0) {
          goTo(activeIndex + 1, "left");
        } else {
          goTo(activeIndex - 1, "right");
        }
      }

      setSwipeX(0);
      touchStartRef.current = null;
      isSwipingRef.current = false;
    },
    [activeIndex, goTo],
  );

  const dismissBanner = useCallback(
    (id: string) => {
      if (hapticFeedback.impactOccurred.isAvailable()) {
        hapticFeedback.impactOccurred("light");
      }
      trackWalletBannerClose(id);
      setDismissedIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        void saveDismissedBannerIds(next);
        return next;
      });
      setAutoRotate(false);
      // Adjust active index so we don't show an out-of-bounds slide
      setActiveIndex((prev) => {
        const remaining = banners.filter((b) => b.id !== id).length;
        if (remaining === 0) return 0;
        return prev >= remaining ? remaining - 1 : prev;
      });
    },
    [banners]
  );

  const banner = banners[activeIndex];

  // Compute card transform: swipe drag OR slide animation
  const getCardStyle = (): React.CSSProperties => {
    if (swipeX !== 0) {
      return {
        transform: `translateX(${swipeX}px)`,
        transition: "none",
      };
    }
    if (isSliding && slideDirection) {
      return {
        animation: `banner-slide-in-${slideDirection} ${SLIDE_DURATION}ms ease-out forwards`,
      };
    }
    return {
      transform: "translateX(0)",
      transition: "transform 200ms ease-out",
    };
  };

  if (banners.length === 0) return null;

  return (
    <div className={`flex flex-col pt-4 px-4 ${banners.length <= 1 ? "pb-4" : ""}`}>
      {/* Slide-in keyframes */}
      <style>{`
        @keyframes banner-slide-in-left {
          from { transform: translateX(40px); opacity: 0; }
          to   { transform: translateX(0); opacity: 1; }
        }
        @keyframes banner-slide-in-right {
          from { transform: translateX(-40px); opacity: 0; }
          to   { transform: translateX(0); opacity: 1; }
        }
      `}</style>

      {/* Swipe area — overflow visible so mascot can poke above */}
      <div className="relative overflow-visible">
        <div style={getCardStyle()}>
          <BannerCard
            banner={banner}
            onClose={() => dismissBanner(banner.id)}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          />
        </div>
      </div>

      {/* Dot indicators */}
      {banners.length > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          {banners.map((b, i) => (
            <div
              key={b.id}
              className="rounded-full transition-all duration-200"
              style={{
                width: 8,
                height: 8,
                backgroundColor:
                  i === activeIndex
                    ? "#F9363C"
                    : "rgba(60, 60, 67, 0.18)",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
