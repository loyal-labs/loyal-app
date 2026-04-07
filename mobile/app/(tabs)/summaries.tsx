import { LogoHeader } from "@/components/LogoHeader";
import { ChatItem } from "@/components/summaries/ChatItem";
import { ChatListSkeleton } from "@/components/summaries/ChatListSkeleton";
import {
  fetchSummaries,
  transformSummariesToGroups,
  type GroupChat,
} from "@/services/api";
import { Pressable, ScrollView, Text, View } from "@/tw";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { RefreshControl, StyleSheet } from "react-native";

const TAB_BAR_HEIGHT = 90;

function GroupsTab({ count }: { count: number }) {
  return (
    <View style={styles.tabContainer}>
      <View style={styles.tab}>
        <Text style={styles.tabLabel}>Groups</Text>
        {count > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{count}</Text>
          </View>
        )}
      </View>
      <View style={styles.tabIndicator} />
    </View>
  );
}

export default function SummariesListScreen() {
  const router = useRouter();
  const [groups, setGroups] = useState<GroupChat[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSummaries = useCallback(async (isRefresh = false) => {
    try {
      if (!isRefresh) setIsLoading(true);
      setError(null);
      const summaries = await fetchSummaries();
      setGroups(transformSummariesToGroups(summaries));
    } catch (err) {
      setError("Failed to load summaries");
      console.error(err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadSummaries();
  }, [loadSummaries]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    loadSummaries(true);
  }, [loadSummaries]);

  const handleGroupPress = useCallback(
    (group: GroupChat) => {
      if (process.env.EXPO_OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      router.push(`/summaries/${group.id}`);
    },
    [router],
  );

  if (isLoading) {
    return (
      <ScrollView
        className="flex-1 bg-white"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: TAB_BAR_HEIGHT }}
      >
        <LogoHeader />
        <Text style={styles.title}>Chat Highlights</Text>
        <ChatListSkeleton count={5} />
      </ScrollView>
    );
  }

  if (error) {
    return (
      <View className="flex-1 bg-white">
        <LogoHeader />
        <Text style={styles.title}>Chat Highlights</Text>
        <View className="flex-1 items-center justify-center gap-4">
          <Text className="text-black/50">{error}</Text>
          <Pressable
            className="px-4 py-2 bg-black/5 rounded-lg"
            onPress={() => loadSummaries()}
          >
            <Text className="text-sm text-black">Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (groups.length === 0) {
    return (
      <ScrollView
        className="flex-1 bg-white"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: TAB_BAR_HEIGHT }}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
        }
      >
        <LogoHeader />
        <Text style={styles.title}>Chat Highlights</Text>
        <View className="items-center justify-center py-16">
          <Text className="text-black/50">No summaries available</Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: TAB_BAR_HEIGHT }}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
      }
    >
      <LogoHeader />
      <View style={styles.titleRow}>
        <Text style={styles.titleInRow}>Chat Highlights</Text>
        <Pressable onPress={() => router.push("/login")}>
          <Text style={styles.devLink}>Login flow →</Text>
        </Pressable>
      </View>
      <GroupsTab count={groups.length} />
      {groups.map((group) => (
        <ChatItem
          key={group.id}
          title={group.title}
          subtitle={group.subtitle}
          photoUrl={group.photoUrl}
          photoBase64={group.photoBase64}
          photoMimeType={group.photoMimeType}
          onPress={() => handleGroupPress(group)}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: "Geist_700Bold",
    fontSize: 28,
    color: "#000",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  titleInRow: {
    fontFamily: "Geist_700Bold",
    fontSize: 28,
    color: "#000",
  },
  devLink: {
    fontFamily: "Geist_500Medium",
    fontSize: 13,
    color: "rgba(0,0,0,0.35)",
  },
  tabContainer: {
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.12)",
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingBottom: 8,
  },
  tabLabel: {
    fontFamily: "Geist_500Medium",
    fontSize: 15,
    color: "#000",
  },
  badge: {
    backgroundColor: "#F9363C",
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  badgeText: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 11,
    color: "#fff",
  },
  tabIndicator: {
    height: 2,
    backgroundColor: "#000",
    width: 80,
    borderRadius: 1,
  },
});
