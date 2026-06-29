import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { RefreshControl, StyleSheet } from "react-native";

import { LogoHeader } from "@/components/LogoHeader";
import { ScrollView, Text, View } from "@/tw";

import type { ActivitySection } from "../model/activity-unread";
import { useActivity } from "../model/ActivityProvider";
import { ActivitySegmentedControl } from "./ActivitySegmentedControl";
import { EarnActivityList } from "./EarnActivityList";
import { WalletActivityList } from "./WalletActivityList";

const TAB_BAR_HEIGHT = 90;

export function ActivityScreen({
  initialSection,
}: {
  initialSection?: ActivitySection;
}) {
  const {
    walletUnread,
    earnUnread,
    loadWalletTransactions,
    refreshEarnTransactions,
    refreshAutodeposit,
    markSeen,
  } = useActivity();
  const [section, setSection] = useState<ActivitySection>(
    initialSection ?? "wallet",
  );
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

        {section === "wallet" ? <WalletActivityList /> : <EarnActivityList />}
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
