import { Zap } from "lucide-react-native";
import { useState } from "react";
import type { ReactNode } from "react";

import { Pressable, Text, View } from "@/tw";

import AutodepositIcon from "../../../../assets/images/earn/autodeposit.svg";
import { formatApyBps, splitUsd } from "../model/format";
import { CryptoGlyph, StablecoinsGlyph } from "./CategoryGlyphs";

const MUTED = "rgba(60, 60, 67, 0.6)";
const CENTS_DIM = "rgba(60, 60, 67, 0.4)";
const APY_TEXT = "#34C759";
const APY_BG = "rgba(52, 199, 89, 0.14)";
const RED = "#F9363C";

function UsdTitle({ value }: { value: number }) {
  const { whole, cents } = splitUsd(value);
  return (
    <Text
      className="text-[20px] font-semibold text-black"
      style={{ letterSpacing: -0.22, lineHeight: 24 }}
    >
      {whole}
      <Text style={{ color: CENTS_DIM }}>{cents}</Text>
    </Text>
  );
}

function CategoryRow({
  glyph,
  value,
  subtitle,
  onPress,
  right,
}: {
  glyph: ReactNode;
  value: number;
  subtitle: ReactNode;
  onPress?: () => void;
  right?: ReactNode;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={!onPress}
      className="flex-row items-center px-4"
      style={{
        borderRadius: 16,
        backgroundColor: pressed ? "#f2f2f7" : "transparent",
      }}
    >
      <View className="py-1.5 pr-3">{glyph}</View>
      <View className="flex-1 py-2.5">
        <UsdTitle value={value} />
        <View className="mt-0.5 flex-row items-center gap-1">{subtitle}</View>
      </View>
      {right ? <View className="items-center justify-end pl-3">{right}</View> : null}
    </Pressable>
  );
}

export function WalletCategorySummary({
  earnUsd,
  earnApyBps,
  stablecoinsUsd,
  cryptoUsd,
  onPressEarn,
  onPressDeposit,
  onPressStablecoins,
  onPressCrypto,
}: {
  earnUsd: number;
  earnApyBps: number | null;
  stablecoinsUsd: number;
  cryptoUsd: number;
  onPressEarn: () => void;
  onPressDeposit: () => void;
  onPressStablecoins: () => void;
  onPressCrypto: () => void;
}) {
  const [depositPressed, setDepositPressed] = useState(false);

  return (
    <View className="px-4 py-1">
      <CategoryRow
        glyph={<AutodepositIcon width={48} height={48} />}
        value={earnUsd}
        onPress={onPressEarn}
        subtitle={
          <>
            <Text className="text-[15px]" style={{ color: MUTED, lineHeight: 20 }}>
              Earn
            </Text>
            {earnApyBps && earnApyBps > 0 ? (
              <View
                className="flex-row items-center rounded-md"
                style={{ backgroundColor: APY_BG, paddingHorizontal: 4, paddingVertical: 1, gap: 2 }}
              >
                <Zap size={10} color={APY_TEXT} fill={APY_TEXT} strokeWidth={2.5} />
                <Text
                  className="text-[11px] font-medium"
                  style={{ color: APY_TEXT, lineHeight: 13, letterSpacing: 0.06 }}
                >
                  {formatApyBps(earnApyBps)} APY
                </Text>
              </View>
            ) : null}
          </>
        }
        right={
          <Pressable
            onPress={onPressDeposit}
            onPressIn={() => setDepositPressed(true)}
            onPressOut={() => setDepositPressed(false)}
            accessibilityRole="button"
            accessibilityLabel="Deposit to Earn"
            className="items-center justify-center rounded-full"
            style={{
              backgroundColor: RED,
              paddingHorizontal: 16,
              paddingVertical: 6,
              opacity: depositPressed ? 0.85 : 1,
            }}
          >
            <Text className="text-[14px] font-medium text-white" style={{ lineHeight: 20 }}>
              Deposit
            </Text>
          </Pressable>
        }
      />
      <CategoryRow
        glyph={<StablecoinsGlyph size={48} />}
        value={stablecoinsUsd}
        onPress={onPressStablecoins}
        subtitle={
          <Text className="text-[15px]" style={{ color: MUTED, lineHeight: 20 }}>
            Stablecoins
          </Text>
        }
      />
      <CategoryRow
        glyph={<CryptoGlyph size={48} />}
        value={cryptoUsd}
        onPress={onPressCrypto}
        subtitle={
          <Text className="text-[15px]" style={{ color: MUTED, lineHeight: 20 }}>
            Crypto
          </Text>
        }
      />
    </View>
  );
}
