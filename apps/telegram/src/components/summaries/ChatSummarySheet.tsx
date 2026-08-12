"use client";

import { hapticFeedback } from "@telegram-apps/sdk-react";
import { Modal, VisuallyHidden } from "@telegram-apps/telegram-ui";
import { Drawer } from "@xelene/vaul-with-scroll-fix";
import { CheckCheck, MessageCircleWarning, Undo2 } from "lucide-react";
import {
  type CSSProperties,
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { useModalSnapPoint, useTelegramSafeArea } from "@/hooks/useTelegramSafeArea";

export type ChatSummarySheetProps = {
  trigger?: ReactNode | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  chat?: {
    id: string;
    title: string;
    messageCount?: number;
  } | null;
  onUndo?: () => void;
  onMarkRead?: () => void;
  onKeepUnread?: () => void;
};

export type ChatSummarySheetRef = {
  triggerMarkRead: () => void;
  triggerKeepUnread: () => void;
};

// Mock summary data - placeholder
const MOCK_SUMMARY = {
  remainingCount: 6,
  topics: [
    {
      id: "1",
      title: "Topic",
      paragraphs: [
        {
          id: "1-1",
          text: "Blockchain technology offers a way to coordinate many independent actors around a single, append-only record of events. It combines cryptography. Blockchain technology offers a way to coordinate many independent actors around a single, append-only record of events. It combines cryptography.",
          sources: ["Alice", "Bob"],
        },
        {
          id: "1-2",
          text: "This structure makes the history tamper-evident: if someone tries to modify a past block, all following references stop matching. Blockchain technology offers a way to coordinate many independent actors around a single, append-only record of events. It combines cryptography.",
          sources: ["Charlie", "David"],
        },
        {
          id: "1-3",
          text: "Within this general idea, there are many variations: public vs permissioned networks, simple value-transfer systems vs expressive smart contract. Blockchain technology offers a way to coordinate many independent actors around a single, append-only record of events. It combines cryptography. Blockchain technology offers a way to coordinate many independent actors around a single, append-only record of events. It combines cryptography.",
          sources: ["Eve", "Frank"],
        },
      ],
    },
  ],
};

// Generate a consistent color based on name
function getAvatarColor(name: string): string {
  const colors = [
    "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7",
    "#DDA0DD", "#98D8C8", "#F7DC6F", "#BB8FCE", "#85C1E9",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

// Get first letter of name
function getFirstLetter(name: string): string {
  const cleaned = name.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, "").trim();
  return cleaned.charAt(0).toUpperCase() || name.charAt(0).toUpperCase();
}

// Source avatars component (overlapping circles)
function SourceAvatars({ sources }: { sources: string[] }) {
  return (
    <div className="flex items-center h-10">
      <div className="flex items-center pl-1 pr-3">
        <div className="flex items-center">
          {sources.slice(0, 3).map((source, index) => (
            <div
              key={source}
              className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium text-white border border-[#28282c]"
              style={{
                backgroundColor: getAvatarColor(source),
                marginLeft: index > 0 ? -4 : 0,
                zIndex: sources.length - index,
              }}
            >
              {getFirstLetter(source)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Swipe threshold to trigger action (in pixels)
const SWIPE_THRESHOLD = 100;
// Max rotation angle in degrees
const MAX_ROTATION = 8;
// Back card rotation
const BACK_CARD_ROTATION = -2;

const ChatSummarySheet = forwardRef<ChatSummarySheetRef, ChatSummarySheetProps>(function ChatSummarySheet({
  trigger,
  open,
  onOpenChange,
  chat,
  onUndo,
  onMarkRead,
  onKeepUnread,
}, ref) {
  const snapPoint = useModalSnapPoint();
  const { bottom: safeBottom } = useTelegramSafeArea();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Swipe state
  const [swipeX, setSwipeX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);
  const [isBackCardTransitioning, setIsBackCardTransitioning] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const isHorizontalSwipeRef = useRef<boolean | null>(null);

  // Track card index for animation key (forces re-render of new card)
  const [cardKey, setCardKey] = useState(0);
  // Track if we're in the final reset phase (to avoid visual noise)
  const [isResetting, setIsResetting] = useState(false);
  // Track the current swipe direction for back card positioning
  const [activeSwipeDirection, setActiveSwipeDirection] = useState<"left" | "right" | null>(null);

  // Reset scroll position when modal opens or after swipe completes
  useEffect(() => {
    if (open && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [open]);

  // Reset scroll after swipe animation completes
  const resetScrollPosition = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, []);

  const modalStyle = useMemo(
    () =>
      ({
        "--tgui--bg_color": "transparent",
        "--tgui--divider": "rgba(255, 255, 255, 0.05)",
      }) as CSSProperties,
    []
  );

  const [snapPoints] = useMemo(() => [[snapPoint]], [snapPoint]);

  const handleUndo = () => {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    onUndo?.();
  };

  // Calculate rotation based on swipe distance
  const rotation = useMemo(() => {
    const normalizedX = Math.min(Math.abs(swipeX) / 200, 1);
    const angle = normalizedX * MAX_ROTATION;
    return swipeX > 0 ? angle : -angle;
  }, [swipeX]);

  // Calculate overlay opacity based on swipe distance
  const overlayOpacity = useMemo(() => {
    return Math.min(Math.abs(swipeX) / SWIPE_THRESHOLD, 1);
  }, [swipeX]);

  // Swipe direction: 'left' for keep unread, 'right' for mark read
  const swipeDirection = swipeX > 0 ? "right" : swipeX < 0 ? "left" : null;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    isHorizontalSwipeRef.current = null;
    setIsDragging(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current || isAnimatingOut) return;

    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;

    // Determine swipe direction on first significant movement
    if (isHorizontalSwipeRef.current === null) {
      if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
        isHorizontalSwipeRef.current = Math.abs(deltaX) > Math.abs(deltaY);
      }
    }

    // Only handle horizontal swipes
    if (isHorizontalSwipeRef.current) {
      if (e.cancelable) e.preventDefault();
      setSwipeX(deltaX);

      // Haptic feedback at threshold
      if (Math.abs(deltaX) >= SWIPE_THRESHOLD && Math.abs(swipeX) < SWIPE_THRESHOLD) {
        if (hapticFeedback.impactOccurred.isAvailable()) {
          hapticFeedback.impactOccurred("medium");
        }
      }
    }
  }, [isAnimatingOut, swipeX]);

  // Complete swipe action (used by both touch and button triggers)
  const completeSwipe = useCallback((direction: "left" | "right") => {
    // Set the swipe direction for back card positioning
    setActiveSwipeDirection(direction);

    // Animate out
    setIsAnimatingOut(true);

    // Haptic feedback
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("heavy");
    }

    // Animate card off screen
    const targetX = direction === "right" ? 500 : -500;
    setSwipeX(targetX);

    // After front card flies off, start back card transition
    setTimeout(() => {
      // Start back card animation to center
      setIsBackCardTransitioning(true);

      // After back card transitions to center, do the swap
      setTimeout(() => {
        // Hide everything during the instant swap
        setIsResetting(true);

        // Use requestAnimationFrame to batch the state updates
        requestAnimationFrame(() => {
          // Increment card key to reset the front card
          setCardKey(k => k + 1);
          // Reset all states
          setSwipeX(0);
          setIsAnimatingOut(false);
          setIsBackCardTransitioning(false);
          setIsDragging(false);
          setActiveSwipeDirection(null);
          resetScrollPosition();

          // Trigger callback after state is reset
          if (direction === "right") {
            onMarkRead?.();
          } else {
            onKeepUnread?.();
          }

          // Show cards again after reset is complete
          requestAnimationFrame(() => {
            setIsResetting(false);
          });
        });
      }, 300);
    }, 300);
  }, [onMarkRead, onKeepUnread, resetScrollPosition]);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging || isAnimatingOut) return;

    const shouldTriggerAction = Math.abs(swipeX) >= SWIPE_THRESHOLD;

    if (shouldTriggerAction) {
      const direction = swipeX > 0 ? "right" : "left";
      completeSwipe(direction);
    } else {
      // Snap back
      setSwipeX(0);
      setIsDragging(false);
    }

    touchStartRef.current = null;
    isHorizontalSwipeRef.current = null;
  }, [isDragging, isAnimatingOut, swipeX, completeSwipe]);

  // Programmatic swipe triggers for buttons
  const triggerSwipeRight = useCallback(() => {
    if (isAnimatingOut) return;
    completeSwipe("right");
  }, [isAnimatingOut, completeSwipe]);

  const triggerSwipeLeft = useCallback(() => {
    if (isAnimatingOut) return;
    completeSwipe("left");
  }, [isAnimatingOut, completeSwipe]);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    triggerMarkRead: triggerSwipeRight,
    triggerKeepUnread: triggerSwipeLeft,
  }), [triggerSwipeRight, triggerSwipeLeft]);

  if (!chat) return null;

  const chatFirstLetter = getFirstLetter(chat.title);
  const chatAvatarColor = getAvatarColor(chat.title);

  return (
    <Modal
      aria-label="Chat Summary"
      trigger={trigger || <button style={{ display: "none" }} />}
      open={open}
      onOpenChange={onOpenChange}
      style={modalStyle}
      snapPoints={snapPoints}
    >
      <div
        style={{
          background: "#000",
          paddingBottom: Math.max(safeBottom, 80),
          height: "100%",
          maxHeight: "100%",
        }}
        className="flex flex-col text-white relative overflow-hidden rounded-t-3xl"
      >
        <Drawer.Title asChild>
          <VisuallyHidden>Chat Summary</VisuallyHidden>
        </Drawer.Title>

        {/* Header - Fixed */}
        <div className="relative h-[52px] flex items-center justify-center shrink-0">
          {/* Center - Remaining count */}
          <div className="flex items-center gap-1.5">
            <div className="bg-[#2990ff] h-6 min-w-6 px-1.5 rounded-full flex items-center justify-center">
              <span className="text-sm font-medium text-white">
                {MOCK_SUMMARY.remainingCount}
              </span>
            </div>
            <span className="text-base text-white">Left</span>
          </div>

          {/* Right - Undo button */}
          <button
            onClick={handleUndo}
            className="absolute right-4 p-1.5 rounded-full active:scale-95 transition-transform"
            style={{
              background: "rgba(255, 255, 255, 0.06)",
              mixBlendMode: "lighten",
            }}
          >
            <Undo2 size={24} strokeWidth={1.5} className="text-white" />
          </button>
        </div>

        {/* Card Container - Fixed structure with scrollable content */}
        <div className="flex-1 flex flex-col mx-4 mb-4 min-h-0 overflow-visible relative">
          {/* Back Card (next card - shows actual content) */}
          <div
            className="absolute inset-0 flex flex-col rounded-[24px] overflow-hidden pointer-events-none"
            style={{
              background: "#28282c",
              transform: isBackCardTransitioning
                ? "rotate(0deg) translateX(0px)"
                : (() => {
                    // Determine direction from active swipe or current drag
                    const dir = activeSwipeDirection || (swipeX > 0 ? "right" : swipeX < 0 ? "left" : null);
                    // Swipe right (mark as read) -> back card comes from left
                    // Swipe left (keep unread) -> back card comes from right
                    if (dir === "right") {
                      return `rotate(${BACK_CARD_ROTATION}deg) translateX(-8px)`;
                    } else if (dir === "left") {
                      return `rotate(${-BACK_CARD_ROTATION}deg) translateX(8px)`;
                    }
                    return `rotate(${BACK_CARD_ROTATION}deg) translateX(-8px)`;
                  })(),
              transformOrigin: "center bottom",
              opacity: isResetting
                ? 0
                : isBackCardTransitioning
                  ? 1
                  : swipeX !== 0 || isAnimatingOut
                    ? 0.5
                    : 0,
              transition: isResetting ? "none" : "transform 0.3s ease-out, opacity 0.3s ease-out",
              zIndex: 0,
            }}
          >
            {/* Back card header - same structure as front */}
            <div
              className="flex items-center gap-4 p-1 border-b shrink-0"
              style={{ borderColor: "rgba(255, 255, 255, 0.1)" }}
            >
              <div className="w-10 h-10 rounded-full opacity-0" />
              <div className="flex-1 flex flex-col items-center justify-center h-11 gap-0.5">
                <p className="text-base font-medium text-white leading-5 tracking-[-0.176px] truncate max-w-full">
                  {chat.title}
                </p>
                {chat.messageCount && (
                  <p className="text-[13px] text-white/60 leading-5">
                    {chat.messageCount.toLocaleString()} messages
                  </p>
                )}
              </div>
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-medium text-white"
                style={{ backgroundColor: chatAvatarColor }}
              >
                {chatFirstLetter}
              </div>
            </div>
            {/* Back card content - same structure as front */}
            <div className="flex-1 overflow-hidden px-5 pt-4 pb-6">
              {MOCK_SUMMARY.topics.map((topic) => (
                <div key={topic.id} className="flex flex-col">
                  <h2 className="text-2xl font-semibold text-white leading-8 pb-2">
                    {topic.title}
                  </h2>
                  {topic.paragraphs.map((paragraph, index) => (
                    <div key={paragraph.id} className="flex flex-col">
                      <p
                        className={`text-base text-white leading-7 ${
                          index > 0 ? "pt-2" : ""
                        }`}
                      >
                        {paragraph.text}
                      </p>
                      <SourceAvatars sources={paragraph.sources} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Front Card with swipe functionality */}
          <div
            key={cardKey}
            ref={cardRef}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            className="flex-1 flex flex-col rounded-[24px] overflow-hidden min-h-0 relative"
            style={{
              background: "#28282c",
              transform: `translateX(${swipeX}px) rotate(${rotation}deg)`,
              transition: isDragging ? "none" : "transform 0.3s ease-out",
              transformOrigin: "center bottom",
              zIndex: 1,
              opacity: isBackCardTransitioning ? 0 : 1,
            }}
          >
            {/* Chat Header - Fixed at top of card */}
            <div
              className="flex items-center gap-4 p-1 border-b shrink-0"
              style={{
                borderColor: "rgba(255, 255, 255, 0.1)",
              }}
            >
              {/* Left avatar (invisible for spacing) */}
              <div className="w-10 h-10 rounded-full opacity-0" />

              {/* Center - Chat info */}
              <div className="flex-1 flex flex-col items-center justify-center h-11 gap-0.5">
                <p className="text-base font-medium text-white leading-5 tracking-[-0.176px] truncate max-w-full">
                  {chat.title}
                </p>
                {chat.messageCount && (
                  <p className="text-[13px] text-white/60 leading-5">
                    {chat.messageCount.toLocaleString()} messages
                  </p>
                )}
              </div>

              {/* Right avatar */}
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-medium text-white"
                style={{ backgroundColor: chatAvatarColor }}
              >
                {chatFirstLetter}
              </div>
            </div>

            {/* Summary Content - Scrollable */}
            <div
              ref={scrollContainerRef}
              data-vaul-no-drag
              className="flex-1 overflow-y-auto overscroll-contain px-5 pt-4 pb-6 min-h-0"
              style={{ touchAction: "pan-y" }}
            >
              {MOCK_SUMMARY.topics.map((topic) => (
                <div key={topic.id} className="flex flex-col">
                  {/* Topic Title */}
                  <h2 className="text-2xl font-semibold text-white leading-8 pb-2">
                    {topic.title}
                  </h2>

                  {/* Paragraphs */}
                  {topic.paragraphs.map((paragraph, index) => (
                    <div key={paragraph.id} className="flex flex-col">
                      <p
                        className={`text-base text-white leading-7 ${
                          index > 0 ? "pt-2" : ""
                        }`}
                      >
                        {paragraph.text}
                      </p>
                      {/* Sources */}
                      <SourceAvatars sources={paragraph.sources} />
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Swipe Overlay */}
            {swipeDirection && (
              <div
                className="absolute inset-0 flex items-center justify-center pointer-events-none rounded-[24px]"
                style={{
                  background:
                    swipeDirection === "right"
                      ? `linear-gradient(to bottom, rgba(41, 144, 255, ${overlayOpacity * 0.2}), rgba(41, 144, 255, ${overlayOpacity}))`
                      : `linear-gradient(to bottom, rgba(40, 40, 44, ${overlayOpacity * 0.2}), rgba(40, 40, 44, ${overlayOpacity}))`,
                  opacity: overlayOpacity,
                  transition: isDragging ? "none" : "opacity 0.3s ease-out",
                }}
              >
                {/* Icon */}
                <div
                  style={{
                    opacity: overlayOpacity,
                    transform: `scale(${0.5 + overlayOpacity * 0.5})`,
                    transition: isDragging ? "none" : "all 0.3s ease-out",
                  }}
                >
                  {swipeDirection === "right" ? (
                    <CheckCheck size={96} strokeWidth={1.5} className="text-white" />
                  ) : (
                    <MessageCircleWarning size={96} strokeWidth={1.5} className="text-white" />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

      </div>
    </Modal>
  );
});

export default ChatSummarySheet;
