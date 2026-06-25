import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  fetchSolanaWeekQuestProgress,
  type SolanaWeekQuestKind,
  type SolanaWeekQuestProgressItem,
  type SolanaWeekQuestStatus,
} from "@/lib/solana/earn/earn-api";
import { useWallet } from "@/lib/wallet/wallet-provider";
import { Pressable, ScrollView, Text, View } from "@/tw";

// Plain test page (Solana Week) reached from the wallet "..." menu. Shows the
// two quests and their reported-to-Solana status, read from the `frontend`
// backend's quest-completion table.
type QuestMeta = {
  kind: SolanaWeekQuestKind;
  title: string;
  description: string;
};

const QUESTS: QuestMeta[] = [
  {
    kind: "earn_deposit",
    title: "Deposit in Earn",
    description: "Connect your wallet and make your first Earn deposit.",
  },
  {
    kind: "first_autodeposit_sweep",
    title: "Autodeposit to Earn",
    description: "Get your first Earn deposit via autodeposit.",
  },
];

const STATUS_LABEL: Record<SolanaWeekQuestStatus, string> = {
  reported: "Completed",
  pending: "Pending",
  failed: "Failed",
  not_started: "Not started",
};

const STATUS_COLOR: Record<SolanaWeekQuestStatus, string> = {
  reported: "#34C759",
  pending: "#FF9F0A",
  failed: "#FF3B30",
  not_started: "#8E8E93",
};

function shortenAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export default function QuestsScreen() {
  const router = useRouter();
  const { publicKey } = useWallet();
  const [items, setItems] = useState<SolanaWeekQuestProgressItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!publicKey) {
      setItems(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSolanaWeekQuestProgress(publicKey);
      setItems(res.quests);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load quests.");
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const byKind = new Map((items ?? []).map((quest) => [quest.kind, quest]));

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: "#FFF" }}>
      <View className="flex-row items-center px-4 py-3">
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ChevronLeft size={28} color="#000" strokeWidth={2} opacity={0.6} />
        </Pressable>
        <Text className="ml-2 text-[20px] font-semibold text-black">Quests</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16 }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} />
        }
      >
        <Text
          className="mb-4 text-[14px]"
          style={{ color: "rgba(60, 60, 67, 0.6)" }}
        >
          Solana Week ·{" "}
          {publicKey ? shortenAddress(publicKey) : "wallet locked"}
        </Text>

        {error ? (
          <Text className="mb-4 text-[14px]" style={{ color: "#FF3B30" }}>
            {error}
          </Text>
        ) : null}

        {items === null && loading ? (
          <View className="items-center py-10">
            <ActivityIndicator />
          </View>
        ) : (
          QUESTS.map((quest, index) => {
            const item = byKind.get(quest.kind);
            const status: SolanaWeekQuestStatus = item?.status ?? "not_started";
            return (
              <View
                key={quest.kind}
                className="mb-3 rounded-2xl p-4"
                style={{ backgroundColor: "#F2F2F7" }}
              >
                <View className="flex-row items-start justify-between">
                  <View className="flex-1 pr-3">
                    <Text className="text-[16px] font-semibold text-black">
                      {index + 1}. {quest.title}
                    </Text>
                    <Text
                      className="mt-1 text-[14px]"
                      style={{ color: "rgba(60, 60, 67, 0.6)" }}
                    >
                      {quest.description}
                    </Text>
                  </View>
                  <View
                    className="rounded-full px-3 py-1"
                    style={{ backgroundColor: `${STATUS_COLOR[status]}1A` }}
                  >
                    <Text
                      className="text-[13px] font-medium"
                      style={{ color: STATUS_COLOR[status] }}
                    >
                      {STATUS_LABEL[status]}
                    </Text>
                  </View>
                </View>

                {item && (item.solanaStatus || item.attempts > 0) ? (
                  <Text
                    className="mt-3 text-[12px]"
                    style={{ color: "rgba(60, 60, 67, 0.45)" }}
                  >
                    {item.solanaStatus ? `solana: ${item.solanaStatus} · ` : ""}
                    attempts: {item.attempts}
                    {item.reportedAt
                      ? ` · reported ${new Date(item.reportedAt).toLocaleString()}`
                      : ""}
                  </Text>
                ) : null}
              </View>
            );
          })
        )}

        {!publicKey ? (
          <Text
            className="mt-2 text-[14px]"
            style={{ color: "rgba(60, 60, 67, 0.6)" }}
          >
            Unlock your wallet to see quest progress.
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
