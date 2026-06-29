import { StyleSheet } from "react-native";

import { Skeleton } from "@/components/Skeleton";
import { View } from "@/tw";

// Pulsing placeholder rows shown while an Activity feed renders. The lists
// aren't virtualized, so switching segments (Wallet ↔ Earn) can take a beat —
// this stands in until the real rows commit. Mirrors the transaction row:
// avatar, two left-aligned lines, two right-aligned lines.
function SkeletonRow() {
  return (
    <View className="flex-row items-center px-4 py-2.5">
      <Skeleton style={styles.avatar} />
      <View className="ml-3 flex-1">
        <Skeleton style={styles.titleLine} />
        <Skeleton style={styles.subLine} />
      </View>
      <View className="items-end">
        <Skeleton style={styles.amountLine} />
        <Skeleton style={styles.timeLine} />
      </View>
    </View>
  );
}

export function ActivityListSkeleton({ count = 7 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonRow key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 48, height: 48, borderRadius: 24 },
  titleLine: { width: 96, height: 16, borderRadius: 6, marginBottom: 4 },
  subLine: { width: 112, height: 12, borderRadius: 6 },
  amountLine: { width: 80, height: 16, borderRadius: 6, marginBottom: 4 },
  timeLine: { width: 48, height: 12, borderRadius: 6 },
});
