import { Zap } from "lucide-react-native";
import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  StyleSheet,
  useWindowDimensions,
  type View as RNView,
} from "react-native";

import { EarnSparkline } from "@/components/earn/EarnSparkline";
import { Skeleton } from "@/components/Skeleton";
import type { EarnForecastSummary } from "@/lib/solana/earn/earn-api";
import { Pressable, Text, View } from "@/tw";

import { formatApyBps, splitUsd } from "../model/format";
import type { CardRect, CardSourceRect } from "../routes";
import { CryptoGlyph, EarnGlyph, StablecoinsGlyph } from "./CategoryGlyphs";

const CENTS_DIM = "rgba(60, 60, 67, 0.4)";
const SUBTITLE_MUTED = "rgba(60, 60, 67, 0.6)";
const APY_GREEN = "#32B67C";
const BRAND_RED = "#F9363C";
const EARN_BG = "#F7F7F7";
const CELL_BG_SOFT = "rgba(0, 0, 0, 0.03)";

// Deterministic grid sizing — flex distribution can't be trusted here (the grid
// lives inside a ScrollView and the cells are react-native-css wrappers), so we
// size cells explicitly: the Earn card spans the full content width on its own
// row, and the Stablecoins/Crypto pair splits the row beneath it. A shared
// minimum row height keeps the two rows visually balanced.
const GRID_PADDING = 16;
const GRID_GAP = 8;
const ROW_MIN_HEIGHT = 188;

// Red pill that deposits straight into Earn without leaving the wallet. Anchored
// to the right of the Earn card's bottom row (Figma 257:82753).
function DepositButton({ onPress }: { onPress: () => void }) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel="Deposit to Earn"
      style={[styles.deposit, pressed && { opacity: 0.85 }]}
    >
      <Text style={styles.depositText}>Deposit</Text>
    </Pressable>
  );
}

// Cents keep the same weight as the dollars (Geist SemiBold) — only the color
// dims. Setting the family explicitly so the nested run doesn't fall back to a
// lighter face.
function UsdValue({ value }: { value: number }) {
  const { whole, cents } = splitUsd(value);
  return (
    <Text style={styles.value} numberOfLines={1}>
      {whole}
      <Text style={styles.valueCents}>{cents}</Text>
    </Text>
  );
}

// Full-width Earn card: a 7-day Loyal APY sparkline fills the top, with the
// Earn balance + APY badge and the Deposit pill on the bottom row. The whole
// card navigates to Earn; only the Deposit pill (a nested pressable) opts out.
function EarnCard({
  width,
  usd,
  loading,
  apyBps,
  summary,
  chartReplayKey,
  onPress,
  onPressDeposit,
}: {
  width: number;
  usd: number;
  loading?: boolean;
  apyBps: number | null;
  summary: EarnForecastSummary | null;
  chartReplayKey: number;
  onPress: () => void;
  onPressDeposit: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel="Open Earn"
      style={[
        styles.cell,
        { backgroundColor: EARN_BG, width },
        pressed && styles.cellPressed,
      ]}
    >
      <EarnSparkline summary={summary} replayKey={chartReplayKey} />
      <View style={styles.earnMiddle}>
        <View style={styles.earnIcon}>
          <EarnGlyph size={40} />
        </View>
        <View style={styles.earnCenter}>
          <View style={styles.earnRow}>
            <Text
              className="text-[15px]"
              style={{ color: SUBTITLE_MUTED, lineHeight: 20 }}
            >
              Earn
            </Text>
            {apyBps && apyBps > 0 ? (
              <View style={styles.apyBadge}>
                <Zap size={11} color="#FFFFFF" fill="#FFFFFF" strokeWidth={2.5} />
                <Text style={styles.apyText}>{formatApyBps(apyBps)} APY</Text>
              </View>
            ) : null}
          </View>
          {loading ? (
            <Skeleton style={styles.valueSkeleton} />
          ) : (
            <UsdValue value={usd} />
          )}
        </View>
        <DepositButton onPress={onPressDeposit} />
      </View>
    </Pressable>
  );
}

// One category card (Stablecoins / Crypto). Its `width` is set explicitly
// (identical for both) instead of via flex, so content can never skew it wider
// than its neighbour; it stretches vertically to fill the row height.
function Cell({
  icon,
  bg,
  width,
  onPress,
  children,
}: {
  icon: ReactNode;
  bg?: string;
  width: number;
  // Receives the card's on-screen rect (window coords) so the destination can
  // expand out of it. `undefined` when the rect couldn't be measured.
  onPress?: (rect?: CardRect) => void;
  children: ReactNode;
}) {
  const [pressed, setPressed] = useState(false);
  const cardRef = useRef<RNView>(null);

  const handlePress = useCallback(() => {
    if (!onPress) return;
    const node = cardRef.current;
    if (node?.measureInWindow) {
      node.measureInWindow((x, y, w, h) =>
        onPress({ x, y, width: w, height: h }),
      );
    } else {
      onPress(undefined);
    }
  }, [onPress]);

  return (
    <Pressable
      ref={cardRef}
      onPress={handlePress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={!onPress}
      style={[
        styles.cell,
        { backgroundColor: bg ?? "transparent", width },
        pressed && styles.cellPressed,
      ]}
    >
      <View>{icon}</View>
      <View style={styles.cellBottom}>{children}</View>
    </Pressable>
  );
}

export function WalletCategoryGrid({
  earnUsd,
  earnLoading,
  earnApyBps,
  apySummary,
  chartReplayKey,
  stablecoinsUsd,
  cryptoUsd,
  // banner,
  onPressEarn,
  onPressDeposit,
  onPressStablecoins,
  onPressCrypto,
}: {
  earnUsd: number;
  /** Skeleton the balance figure while the Earn read-model is loading. */
  earnLoading?: boolean;
  earnApyBps: number | null;
  /** Global Loyal APY forecast + history that feeds the Earn card sparkline. */
  apySummary: EarnForecastSummary | null;
  /** Bumped on screen focus / pull-to-refresh to replay the sparkline draw-on. */
  chartReplayKey: number;
  stablecoinsUsd: number;
  cryptoUsd: number;
  /** The promo banner that fills the bottom-right cell. */
  // banner: ReactNode;
  onPressEarn: () => void;
  onPressDeposit: () => void;
  onPressStablecoins: (rect?: CardSourceRect) => void;
  onPressCrypto: (rect?: CardSourceRect) => void;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const contentWidth = windowWidth - GRID_PADDING * 2;
  const cellWidth = (contentWidth - GRID_GAP) / 2;

  return (
    <View style={styles.grid}>
      <View style={styles.row}>
        <EarnCard
          width={contentWidth}
          usd={earnUsd}
          loading={earnLoading}
          apyBps={earnApyBps}
          summary={apySummary}
          chartReplayKey={chartReplayKey}
          onPress={onPressEarn}
          onPressDeposit={onPressDeposit}
        />
      </View>
      <View style={styles.row}>
        <Cell
          icon={<StablecoinsGlyph size={40} />}
          bg={CELL_BG_SOFT}
          width={cellWidth}
          onPress={(rect) =>
            onPressStablecoins(rect ? { ...rect, usd: stablecoinsUsd } : undefined)
          }
        >
          <Text
            className="text-[15px]"
            style={{ color: SUBTITLE_MUTED, lineHeight: 20 }}
          >
            Stablecoins
          </Text>
          <UsdValue value={stablecoinsUsd} />
        </Cell>
        <Cell
          icon={<CryptoGlyph size={40} />}
          bg={CELL_BG_SOFT}
          width={cellWidth}
          onPress={(rect) =>
            onPressCrypto(rect ? { ...rect, usd: cryptoUsd } : undefined)
          }
        >
          <Text
            className="text-[15px]"
            style={{ color: SUBTITLE_MUTED, lineHeight: 20 }}
          >
            Crypto
          </Text>
          <UsdValue value={cryptoUsd} />
        </Cell>
      </View>
      {/* Promo banner row — commented out for now. */}
      {/* <View style={styles.row}>{banner}</View> */}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flex: 1,
    gap: GRID_GAP,
    paddingHorizontal: GRID_PADDING,
  },
  // Both rows share the same flex grow and the same minimum height, so they are
  // always balanced: when there's spare vertical space they split it evenly, and
  // when space is tight they both settle at ROW_MIN_HEIGHT.
  row: {
    flex: 1,
    minHeight: ROW_MIN_HEIGHT,
    flexDirection: "row",
    alignItems: "stretch",
    gap: GRID_GAP,
  },
  // Width is set explicitly per cell. No `flex` on the cell, so its width can't
  // be skewed by content; it stretches vertically to fill the row height.
  // `overflow: hidden` clips rather than grows.
  cell: {
    borderRadius: 24,
    padding: 16,
    justifyContent: "space-between",
    overflow: "hidden",
  },
  cellPressed: {
    opacity: 0.85,
  },
  cellBottom: {
    gap: 4,
  },
  // Earn card bottom row: icon, balance/badge block, and the Deposit pill.
  earnMiddle: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 12,
  },
  earnIcon: {
    marginRight: 12,
  },
  earnCenter: {
    flex: 1,
  },
  earnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  apyBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: APY_GREEN,
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  apyText: {
    color: "#FFFFFF",
    fontFamily: "Geist_500Medium",
    fontSize: 11,
    lineHeight: 13,
    letterSpacing: 0.06,
  },
  value: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.22,
    color: "#000000",
  },
  // Stand-in for the balance figure while it loads. Sized to the 24px value
  // line (20 + 2 + 2) so the real number drops in without nudging the row.
  valueSkeleton: {
    height: 20,
    width: 96,
    marginVertical: 2,
    borderRadius: 6,
  },
  valueCents: {
    fontFamily: "Geist_600SemiBold",
    color: CENTS_DIM,
  },
  deposit: {
    marginLeft: 12,
    backgroundColor: BRAND_RED,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  depositText: {
    color: "#FFFFFF",
    fontFamily: "Geist_500Medium",
    fontSize: 14,
    lineHeight: 20,
  },
});
