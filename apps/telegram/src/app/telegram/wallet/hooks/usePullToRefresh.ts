import { hapticFeedback } from "@telegram-apps/sdk-react";
import { useCallback, useEffect, useRef, useState } from "react";

const PULL_THRESHOLD = 80;
const MAX_PULL = 140;
const REFRESH_HOLD_DISTANCE = 60;
const RESISTANCE = 0.45;
const AXIS_LOCK_RATIO = 1.5;

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
  disabled?: boolean;
}

export function usePullToRefresh({
  onRefresh,
  disabled = false,
}: UsePullToRefreshOptions) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const startYRef = useRef(0);
  const startXRef = useRef(0);
  const isPullingRef = useRef(false);
  const axisLockedRef = useRef<"vertical" | "horizontal" | null>(null);
  const crossedThresholdRef = useRef(false);

  const handleRefreshEnd = useCallback(() => {
    setIsRefreshing(false);
    setPullDistance(0);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || disabled) return;

    const onTouchStart = (e: TouchEvent) => {
      if (isRefreshing) return;
      if (window.scrollY > 0) return;

      const touch = e.touches[0];
      startYRef.current = touch.clientY;
      startXRef.current = touch.clientX;
      isPullingRef.current = false;
      axisLockedRef.current = null;
      crossedThresholdRef.current = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (isRefreshing) return;

      const touch = e.touches[0];
      const deltaY = touch.clientY - startYRef.current;
      const deltaX = touch.clientX - startXRef.current;

      // Lock axis on first significant movement
      if (axisLockedRef.current === null) {
        const absY = Math.abs(deltaY);
        const absX = Math.abs(deltaX);
        if (absY < 5 && absX < 5) return;

        if (absY > absX * AXIS_LOCK_RATIO) {
          axisLockedRef.current = "vertical";
        } else {
          axisLockedRef.current = "horizontal";
          return;
        }
      }

      if (axisLockedRef.current === "horizontal") return;

      // Only activate when at top of page and pulling down
      if (deltaY <= 0 || window.scrollY > 0) {
        if (isPullingRef.current) {
          isPullingRef.current = false;
          setPullDistance(0);
        }
        return;
      }

      if (e.cancelable) e.preventDefault();
      isPullingRef.current = true;

      const distance = Math.min(deltaY * RESISTANCE, MAX_PULL);
      setPullDistance(distance);

      // Haptic on threshold crossing
      if (
        !crossedThresholdRef.current &&
        distance >= PULL_THRESHOLD &&
        hapticFeedback.impactOccurred.isAvailable()
      ) {
        crossedThresholdRef.current = true;
        hapticFeedback.impactOccurred("light");
      }
      if (crossedThresholdRef.current && distance < PULL_THRESHOLD) {
        crossedThresholdRef.current = false;
      }
    };

    const onTouchEnd = () => {
      if (isRefreshing || !isPullingRef.current) return;
      isPullingRef.current = false;
      axisLockedRef.current = null;

      if (pullDistance >= PULL_THRESHOLD) {
        setIsRefreshing(true);
        setPullDistance(REFRESH_HOLD_DISTANCE);
        onRefresh().finally(handleRefreshEnd);
      } else {
        setPullDistance(0);
      }
    };

    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
    };
  }, [disabled, isRefreshing, pullDistance, onRefresh, handleRefreshEnd]);

  return { pullDistance, isRefreshing, containerRef };
}
