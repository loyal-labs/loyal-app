"use client";

import {
  hapticFeedback,
} from "@telegram-apps/sdk-react";
import { motion, type PanInfo } from "framer-motion";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { getAvatarColor, getFirstLetter } from "@/components/summaries/avatar-utils";
import { MOCK_SUMMARIES } from "@/components/summaries/mock-data";
import { useSummaries } from "@/components/summaries/SummariesContext";
import ConnectBotModal from "@/components/telegram/ConnectBotModal";
import { useDeviceSafeAreaTop } from "@/hooks/useTelegramSafeArea";
import { publicEnv } from "@/lib/core/config/public";

type GroupChat = {
  id: string;
  title: string;
  subtitle: string;
  photoBase64?: string;
  photoMimeType?: string;
  photoUrl?: string;
};

interface ChatItemSkeletonProps {
  titleWidth?: string;
  subtitleWidth?: string;
}

function ChatItemSkeleton({
  titleWidth = "w-32",
  subtitleWidth = "w-48",
}: ChatItemSkeletonProps) {
  return (
    <div className="px-4">
      <div className="flex items-center w-full py-2">
        {/* Avatar Skeleton */}
        <div className="pr-3">
          <div className="w-12 h-12 rounded-full bg-black/5 animate-pulse" />
        </div>

        {/* Title and Subtitle Skeleton */}
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          <div className={`${titleWidth} h-5 bg-black/5 animate-pulse rounded`} />
          <div className={`${subtitleWidth} h-4 bg-black/5 animate-pulse rounded`} />
        </div>
      </div>
    </div>
  );
}

// Skeleton configurations for visual variety
const SKELETON_CONFIGS = [
  { titleWidth: "w-36", subtitleWidth: "w-52" },
  { titleWidth: "w-28", subtitleWidth: "w-44" },
  { titleWidth: "w-32", subtitleWidth: "w-56" },
  { titleWidth: "w-24", subtitleWidth: "w-40" },
  { titleWidth: "w-40", subtitleWidth: "w-48" },
];

function ChatListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <ChatItemSkeleton
          key={index}
          titleWidth={SKELETON_CONFIGS[index % SKELETON_CONFIGS.length].titleWidth}
          subtitleWidth={SKELETON_CONFIGS[index % SKELETON_CONFIGS.length].subtitleWidth}
        />
      ))}
    </>
  );
}

interface ChatItemProps {
  chat: { id: string; title: string; subtitle?: string; photoBase64?: string; photoMimeType?: string; photoUrl?: string };
  onClick: () => void;
}

function ChatItem({ chat, onClick }: ChatItemProps) {
  const avatarColor = getAvatarColor(chat.title);
  const firstLetter = getFirstLetter(chat.title);

  const photoSrc = chat.photoUrl
    ? chat.photoUrl
    : chat.photoBase64
      ? `data:${chat.photoMimeType || "image/jpeg"};base64,${chat.photoBase64}`
      : null;

  return (
    <div className="relative px-4">
      <button
        onClick={onClick}
        className="flex items-center w-full active:opacity-80 transition-opacity text-left"
      >
        {/* Avatar */}
        <div className="pr-3 py-1.5">
          {photoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoSrc}
              alt={chat.title}
              className="w-12 h-12 rounded-full object-cover"
            />
          ) : (
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ backgroundColor: avatarColor }}
            >
              <span className="text-lg font-medium text-white">{firstLetter}</span>
            </div>
          )}
        </div>

        {/* Title and Subtitle */}
        <div className="flex-1 min-w-0 flex flex-col gap-0.5 py-2.5">
          <p className="text-base text-black font-medium leading-5 truncate">{chat.title}</p>
          {chat.subtitle && (
            <p className="text-[13px] text-black/50 leading-4 truncate">
              {chat.subtitle}
            </p>
          )}
        </div>
      </button>
      {/* Separator */}
      <div className="absolute bottom-0 right-0 left-[76px] h-px">
        <div className="h-[0.33px] bg-black/12 w-full" />
      </div>
    </div>
  );
}

// Tab types
type TabId = "groups" | "direct" | "personal" | "work";

interface Tab {
  id: TabId;
  label: string;
  count: number;
  hasDividerAfter?: boolean;
}

// Tab data will be computed dynamically
const getTabsData = (groupCount: number): Tab[] => [
  { id: "groups", label: "Groups", count: groupCount, hasDividerAfter: true },
  // Temporarily hidden until non-group summaries are supported.
  // { id: "direct", label: "Direct", count: directCount },
  // { id: "personal", label: "Personal", count: 0 },
  // { id: "work", label: "Work", count: 0 },
];


interface EmptyStateBannerProps {
  onClose: () => void;
  onConnectChats: () => void;
}

function EmptyStateBanner({ onClose, onConnectChats }: EmptyStateBannerProps) {
  return (
    <div className="px-3 pt-1 pb-2">
      <div className="relative bg-black/[0.04] rounded-2xl overflow-hidden pl-4 pr-11 py-4">
        <div className="flex flex-col gap-3">
          {/* Text Content */}
          <div className="flex flex-col gap-0.5">
            <p className="text-base font-medium text-black leading-5 tracking-[-0.18px]">
              No summarized chats yet
            </p>
            <p className="text-[13px] text-black/50 leading-[18px] tracking-[-0.08px]">
              Connect your Telegram groups to start getting summaries here.
            </p>
          </div>

          {/* Connect Button */}
          <div>
            <button
              onClick={onConnectChats}
              className="bg-black/[0.06] rounded-full px-4 py-2 active:opacity-80 transition-opacity"
            >
              <span className="text-sm font-medium text-black leading-5">
                Connect Chats
              </span>
            </button>
          </div>
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-2 right-2 p-1 active:opacity-80 transition-opacity"
        >
          <X size={24} strokeWidth={1.5} className="text-black/40" />
        </button>
      </div>
    </div>
  );
}

const MOCK_DIRECT_CHATS: GroupChat[] = [
  {
    id: "dm-1",
    title: "Alice Morgan",
    subtitle: "Discussed the token migration timeline",
    photoUrl: "/uifaces-popular-avatar.jpg",
  },
  {
    id: "dm-2",
    title: "Jake Wilson",
    subtitle: "Shared the updated deployment config",
    photoUrl: "/uifaces-popular-avatar-1.jpg",
  },
];

const ACTIVE_TAB_STORAGE_KEY = "summaries_active_tab";

export default function SummariesPage() {
  const router = useRouter();
  const safeAreaInsetTop = useDeviceSafeAreaTop();
  const headerHeight = Math.max(safeAreaInsetTop || 0, 12) + 10 + 27 + 16;

  const [isBannerDismissed, setIsBannerDismissed] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    // Initialize from localStorage, default to "groups"
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
      if (saved === "groups") {
        return saved;
      }
    }
    return "groups";
  });
  const [isConnectBotModalOpen, setIsConnectBotModalOpen] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState<1 | -1>(1); // 1 = from right, -1 = from left
  const [isLoading, setIsLoading] = useState(true);

  const [groupChats, setGroupChats] = useState<GroupChat[]>([]);
  const [isGroupsLoading, setIsGroupsLoading] = useState(true);
  const { summaries: cachedSummaries, setSummaries, hasCachedData } = useSummaries();

  // Transform summaries to unique group chats format (deduplicate by group chat id)
  const transformToGroupChats = (summaries: Array<{
    chatId?: string;
    title: string;
    photoUrl?: string;
    photoBase64?: string;
    photoMimeType?: string;
    topics?: Array<{ content: string }>;
  }>) => {
    const groupMap = new Map<string, GroupChat>();

    for (const summary of summaries) {
      const groupKey = summary.chatId ?? summary.title;

      // Only keep the first (most recent) summary for each group
      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, {
          id: groupKey,
          title: summary.title,
          subtitle: summary.topics?.[0]?.content || "",
          photoUrl: summary.photoUrl,
          photoBase64: summary.photoBase64,
          photoMimeType: summary.photoMimeType,
        });
      }
    }

    return Array.from(groupMap.values());
  };

  // Initialize from cached data immediately
  useEffect(() => {
    if (hasCachedData && cachedSummaries.length > 0) {
      setGroupChats(transformToGroupChats(cachedSummaries));
      setIsGroupsLoading(false);
    }
  }, [hasCachedData, cachedSummaries]);

  // Fetch fresh data (in background if we have cache)
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const fetchGroupChats = async () => {
      // Use mock data in development when flag is set
      if (publicEnv.useMockSummaries) {
        setSummaries(MOCK_SUMMARIES);
        setGroupChats(transformToGroupChats(MOCK_SUMMARIES));
        setIsGroupsLoading(false);
        return;
      }

      // Only show loading if no cached data
      if (!hasCachedData) {
        setIsGroupsLoading(true);
      }
      try {
        const response = await fetch("/api/summaries");
        if (!response.ok) return;
        const data = await response.json();
        const summaries = data.summaries || [];

        // Update context (persists to sessionStorage)
        setSummaries(summaries);

        // Update list view
        setGroupChats(transformToGroupChats(summaries));
      } catch {
        // Silently fail - will show cached or empty state
      } finally {
        setIsGroupsLoading(false);
      }
    };
    fetchGroupChats();
  }, [setSummaries, hasCachedData]);

  // Mock DM data (dev only, controlled by NEXT_PUBLIC_USE_MOCK_SUMMARIES)
  const useMockDMs = publicEnv.useMockSummaries;
  const directChats = useMockDMs ? MOCK_DIRECT_CHATS : [];

  // Get tabs data and current chat list based on active tab
  const tabs = getTabsData(groupChats.length);
  const currentChatList =
    activeTab === "groups" ? groupChats :
    activeTab === "direct" ? directChats :
    [];

  // Save active tab to localStorage when it changes
  useEffect(() => {
    localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  // Loading state: use real loading for groups, brief delay for other tabs
  useEffect(() => {
    if (activeTab === "groups") {
      setIsLoading(isGroupsLoading);
    } else {
      // Brief delay for placeholder tabs for smooth transition
      setIsLoading(true);
      const timer = setTimeout(() => setIsLoading(false), 150);
      return () => clearTimeout(timer);
    }
  }, [activeTab, isGroupsLoading]);

  // Handle swipe to switch tabs
  const handleSwipe = useCallback(
    (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      const SWIPE_THRESHOLD = 50;
      const tabOrder: TabId[] = [
        "groups",
        // Temporarily hidden until non-group summaries are supported.
        // "direct",
        // "personal",
        // "work",
      ];
      const currentIndex = tabOrder.indexOf(activeTab);

      if (info.offset.x < -SWIPE_THRESHOLD && currentIndex < tabOrder.length - 1) {
        // Swipe left - go to next tab (content comes from right)
        if (hapticFeedback.impactOccurred.isAvailable()) {
          hapticFeedback.impactOccurred("light");
        }
        setSwipeDirection(1);
        setActiveTab(tabOrder[currentIndex + 1]);
      } else if (info.offset.x > SWIPE_THRESHOLD && currentIndex > 0) {
        // Swipe right - go to previous tab (content comes from left)
        if (hapticFeedback.impactOccurred.isAvailable()) {
          hapticFeedback.impactOccurred("light");
        }
        setSwipeDirection(-1);
        setActiveTab(tabOrder[currentIndex - 1]);
      }
    },
    [activeTab]
  );

  const handleChatClick = (chat: { id: string; title: string; subtitle?: string; messageCount?: number }) => {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }

    // Groups tab: navigate to SummaryFeed page (vertical swipe)
    if (activeTab === "groups") {
      router.push(
        `/telegram/summaries/feed?groupChatId=${encodeURIComponent(chat.id)}`
      );
      return;
    }

    // Direct and other tabs: navigate to DirectFeed page (horizontal swipe)
    router.push(`/telegram/summaries/direct?chatId=${chat.id}&tab=${activeTab}`);
  };

  const handleBannerClose = () => {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    setIsBannerDismissed(true);
  };

  const handleConnectChats = () => {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("medium");
    }
    // TODO: Navigate to connect chats flow
  };

  return (
    <main
      className="text-foreground font-sans overflow-y-auto relative flex flex-col max-w-md mx-auto w-full"
      style={{ background: "#fff", height: `calc(100vh - ${headerHeight}px)` }}
    >
      {/* Header - fixed at top */}
      <div
        className="sticky top-0 z-10"
        style={{ background: "#fff" }}
      >
        <div className="flex items-center px-4">
          <div className="flex-1 py-3">
            <h1 className="text-[22px] font-semibold text-black leading-7">Chat Highlights</h1>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex pl-4 border-b border-black/10">
          {tabs.map((tab, index) => (
            <div key={tab.id} className="flex items-center">
              <button
                onClick={() => {
                  if (hapticFeedback.impactOccurred.isAvailable()) {
                    hapticFeedback.impactOccurred("light");
                  }
                  const tabOrder: TabId[] = [
                    "groups",
                    // Temporarily hidden until non-group summaries are supported.
                    // "direct",
                    // "personal",
                    // "work",
                  ];
                  const currentIndex = tabOrder.indexOf(activeTab);
                  const targetIndex = tabOrder.indexOf(tab.id);
                  setSwipeDirection(targetIndex > currentIndex ? 1 : -1);
                  setActiveTab(tab.id);
                }}
                className={`flex items-center gap-1.5 pr-4 pb-2.5 pt-1 relative transition-colors ${
                  index > 0 ? "pl-4" : ""
                } ${activeTab === tab.id ? "text-black" : "text-black/40"}`}
              >
                <span className="text-base font-medium leading-5 tracking-[-0.176px]">{tab.label}</span>
                {tab.count > 0 && (
                  <span className="min-w-5 h-5 flex items-center justify-center text-xs font-medium rounded-full text-white bg-[#FF3B30] px-1.5">
                    {tab.count}
                  </span>
                )}
                {activeTab === tab.id && (
                  <div
                    className={`absolute bottom-0 right-3 h-[3px] rounded-t-[4px] rounded-b-[1px] bg-black ${
                      index > 0 ? "left-3" : "left-0"
                    }`}
                  />
                )}
              </button>
              {/* Vertical divider after tab if specified */}
              {tab.hasDividerAfter && (
                <div className="flex items-center self-stretch px-2">
                  <div className="w-px h-5 bg-black/15 rounded-[1px]" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Chat List or Empty State - Swipeable */}
      <motion.div
        className="flex-1 flex flex-col"
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.1}
        onDragEnd={handleSwipe}
        key={activeTab}
        initial={{ opacity: 0.7, x: swipeDirection * 30 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
      >
        {isLoading ? (
          <div className="flex-1 flex flex-col pt-2 pb-4">
            <ChatListSkeleton count={5} />

            {/* Bottom padding for navigation */}
            <div className="h-32 shrink-0" />
          </div>
        ) : currentChatList.length === 0 ? (
          <div className="flex-1 flex flex-col pt-1">
            {!isBannerDismissed && (
              <EmptyStateBanner
                onClose={handleBannerClose}
                onConnectChats={handleConnectChats}
              />
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col pt-2 pb-4">
            {currentChatList.map((chat) => (
              <ChatItem
                key={chat.id}
                chat={chat}
                onClick={() => handleChatClick(chat)}
              />
            ))}

            {/* Bottom padding for navigation */}
            <div className="h-32 shrink-0" />
          </div>
        )}
      </motion.div>

      {/* Connect Bot Modal */}
      <ConnectBotModal
        open={isConnectBotModalOpen}
        onOpenChange={setIsConnectBotModalOpen}
      />
    </main>
  );
}
