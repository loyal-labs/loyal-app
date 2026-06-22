import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { RefreshControl, StyleSheet } from "react-native";

import { LogoHeader } from "@/components/LogoHeader";
import { ScrollView, Text, View } from "@/tw";

import type { ActivitySection } from "../model/activity-unread";
import { useActivity } from "../model/ActivityProvider";
import { ActivitySegmentedControl } from "./ActivitySegmentedControl";
import { EarnActivityList } from "./EarnActivityList";
import { WalletActivityList } from "./WalletActivityList";

const TAB_BAR_HEIGHT = 90;

export function ActivityScreen() {
  const {
    walletUnread,
    earnUnread,
    loadWalletTransactions,
    refreshEarnTransactions,
    markSeen,
  } = useActivity();
  const [section, setSection] = useState<ActivitySection>("wallet");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Viewing a section clears its dot. Re-runs when the active section changes
  // or new items arrive while the screen is focused, so it stays cleared.
  useFocusEffect(
    useCallback(() => {
      markSeen(section);
    }, [section, markSeen]),
  );

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await (section === "earn"
        ? refreshEarnTransactions()
        : loadWalletTransactions({ force: true }));
    } finally {
      setIsRefreshing(false);
    }
  }, [section, loadWalletTransactions, refreshEarnTransactions]);

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
