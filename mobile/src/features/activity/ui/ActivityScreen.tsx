import { useFocusEffect } from "expo-router";
import { useCallback, useDeferredValue, useEffect, useState } from "react";
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  RefreshControl,
  StyleSheet,
} from "react-native";

import { LogoHeader } from "@/components/LogoHeader";
import { ScrollView, Text, View } from "@/tw";

import type { ActivitySection } from "../model/activity-unread";
import { useActivity } from "../model/ActivityProvider";
import { ActivityListSkeleton } from "./ActivityListSkeleton";
import { ActivitySegmentedControl } from "./ActivitySegmentedControl";
import { EarnActivityList } from "./EarnActivityList";
import { WalletActivityList } from "./WalletActivityList";

const TAB_BAR_HEIGHT = 90;

// The Earn feed can be hundreds of icon-heavy rows. The screen is a plain
// ScrollView (not virtualized), so rendering them all at once blocks the tab
// switch for seconds even though the data is already loaded. Render a page at a
// time and grow as the user scrolls toward the bottom (infinite scroll).
const EARN_PAGE_SIZE = 20;
// Start loading the next page this many px before the end so it's ready by the
// time the user reaches it (no visible gap).
const EARN_LOAD_AHEAD_PX = 600;

export function ActivityScreen({
  initialSection,
}: {
  initialSection?: ActivitySection;
}) {
  const {
    walletUnread,
    earnUnread,
    earnTransactions,
    loadWalletTransactions,
    refreshEarnTransactions,
    refreshAutodeposit,
    markSeen,
  } = useActivity();
  const [section, setSection] = useState<ActivitySection>(
    initialSection ?? "wallet",
  );
  // How many Earn rows are currently rendered. Reset to one page each time the
  // Earn section is (re)entered so the switch stays cheap; grows on scroll.
  const [earnLimit, setEarnLimit] = useState(EARN_PAGE_SIZE);
  // The segmented control reacts to `section` immediately (snappy pill), but the
  // heavy, non-virtualized feed renders off a deferred copy so the tap never
  // blocks. While they differ we're mid-switch — show a skeleton instead of the
  // outgoing feed so it reads as loading, not frozen.
  const deferredSection = useDeferredValue(section);
  const isSwitching = deferredSection !== section;
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Deep links (e.g. landing here right after setting up an Autodeposit) select
  // a section via route param; honor it when it changes without fighting manual
  // taps afterwards.
  useEffect(() => {
    if (initialSection) {
      setSection(initialSection);
    }
  }, [initialSection]);

  // Viewing a section clears its dot. Re-runs when the active section changes
  // or new items arrive while the screen is focused, so it stays cleared.
  useFocusEffect(
    useCallback(() => {
      markSeen(section);
      // The provider fetches Autodeposit state once at mount, so a sweep
      // scheduled afterwards (e.g. landing here right after setup) wouldn't show
      // until something refetches it. Re-read it whenever the Earn section is
      // focused so the "Scheduled" row appears without a manual pull.
      if (section === "earn") {
        void refreshAutodeposit();
      }
    }, [section, markSeen, refreshAutodeposit]),
  );

  // Each time the Earn section becomes active, start from the first page so the
  // transition renders ~20 rows, not hundreds.
  useEffect(() => {
    if (section === "earn") {
      setEarnLimit(EARN_PAGE_SIZE);
    }
  }, [section]);

  // Grow the Earn window as the user nears the bottom. Adding a page increases
  // contentSize, which pushes the bottom away again, so this self-limits to one
  // page per approach (onEndReached-style) without extra debouncing.
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (section !== "earn") {
        return;
      }
      const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
      const distanceFromBottom =
        contentSize.height - contentOffset.y - layoutMeasurement.height;
      if (distanceFromBottom > EARN_LOAD_AHEAD_PX) {
        return;
      }
      setEarnLimit((n) =>
        n < earnTransactions.length ? n + EARN_PAGE_SIZE : n,
      );
    },
    [section, earnTransactions.length],
  );

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await (section === "earn"
        ? Promise.all([refreshEarnTransactions(), refreshAutodeposit()])
        : loadWalletTransactions({ force: true }));
    } finally {
      setIsRefreshing(false);
    }
  }, [
    section,
    loadWalletTransactions,
    refreshEarnTransactions,
    refreshAutodeposit,
  ]);

  return (
    <View className="flex-1 bg-white">
      <LogoHeader />
      <ScrollView
        className="flex-1 bg-white"
        contentContainerStyle={styles.contentContainer}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
        }
      >
        <View style={styles.headerBlock}>
          <Text style={styles.pageTitle}>Activity</Text>
          <ActivitySegmentedControl
            value={section}
            onChange={setSection}
            earnUnread={earnUnread}
            walletUnread={walletUnread}
          />
        </View>

        {isSwitching ? (
          <ActivityListSkeleton />
        ) : deferredSection === "wallet" ? (
          <WalletActivityList />
        ) : (
          <EarnActivityList limit={earnLimit} />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  contentContainer: {
    paddingBottom: TAB_BAR_HEIGHT + 42,
  },
  headerBlock: {
    gap: 16,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  pageTitle: {
    color: "#000",
    fontFamily: "Geist_700Bold",
    fontSize: 32,
    letterSpacing: -0.7,
  },
});
