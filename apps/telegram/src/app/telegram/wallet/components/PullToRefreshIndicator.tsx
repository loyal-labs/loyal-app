interface PullToRefreshIndicatorProps {
  pullDistance: number;
  isRefreshing: boolean;
  threshold: number;
}

export function PullToRefreshIndicator({
  pullDistance,
  isRefreshing,
  threshold,
}: PullToRefreshIndicatorProps) {
  if (pullDistance === 0 && !isRefreshing) return null;

  const progress = Math.min(pullDistance / threshold, 1);

  return (
    <div
      className="absolute left-0 right-0 flex justify-center pointer-events-none"
      style={{
        top: -40,
        opacity: isRefreshing ? 1 : progress,
      }}
    >
      {isRefreshing ? (
        <div className="w-6 h-6 border-2 border-black/10 border-t-black/40 rounded-full animate-spin" />
      ) : (
        <div
          className="w-6 h-6 border-2 border-black/10 border-t-black/40 rounded-full"
          style={{
            transform: `rotate(${progress * 360}deg)`,
          }}
        />
      )}
    </div>
  );
}
