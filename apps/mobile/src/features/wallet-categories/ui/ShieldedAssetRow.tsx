import { ShieldCheck } from "lucide-react-native";
import { Image as RNImage } from "react-native";

import {
  formatShieldedUsd,
  type ShieldedRow,
} from "@/components/wallet/shielded-balance";
import { Pressable, Text, View } from "@/tw";

const MUTED = "rgba(60, 60, 67, 0.6)";

// Legacy shielded balance in the category asset list (ASK-2269). Same anatomy
// as CategoryAssetRow plus a shield badge on the token icon.
export function ShieldedAssetRow({
  row,
  onPress,
}: {
  row: ShieldedRow;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center px-4"
      accessibilityRole="button"
      accessibilityLabel={`Unshield ${row.symbol}`}
    >
      <View className="py-1.5 pr-3" style={{ position: "relative" }}>
        <RNImage
          source={{ uri: row.icon }}
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            backgroundColor: "#f2f2f7",
            borderWidth: 0.5,
            borderColor: "rgba(0, 0, 0, 0.08)",
          }}
        />
        <View
          style={{
            position: "absolute",
            left: 30,
            top: 34,
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: "#fff",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ShieldCheck size={16} color="#000" strokeWidth={2} />
        </View>
      </View>

      <View className="flex-1 py-2">
        <Text
          className="text-[17px] font-medium text-black"
          style={{ letterSpacing: -0.187, lineHeight: 22 }}
          numberOfLines={1}
        >
          {row.name}
        </Text>
        <Text
          className="mt-0.5 text-[15px]"
          style={{ color: MUTED, lineHeight: 20 }}
          numberOfLines={1}
        >
          {row.amountText} {row.symbol} shielded
        </Text>
      </View>

      {row.usd !== null ? (
        <View className="items-end pl-3">
          <Text
            className="text-[17px] font-medium text-black"
            style={{ letterSpacing: -0.187, lineHeight: 22 }}
          >
            {formatShieldedUsd(row.usd)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
