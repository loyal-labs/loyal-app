import { Zap } from "lucide-react-native";
import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  StyleSheet,
  useWindowDimensions,
  type View as RNView,
} from "react-native";

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
const CELL_BORDER = "rgba(0, 0, 0, 0.03)";

// Deterministic grid sizing — flex distribution can't be trusted here (the grid
// lives inside a ScrollView and the cells are react-native-css wrappers), so we
// size cells explicitly: equal widths from the window, and a shared minimum row
// height so both rows are always identical and the Earn card's extra Deposit
// button still fits.
const GRID_PADDING = 16;
const GRID_GAP = 8;
const ROW_MIN_HEIGHT = 172;

// Full-width "Deposit now" button anchored to the bottom of the Earn card —
// deposits straight into Earn without leaving the wallet.
function DepositNowButton({ onPress }: { onPress: () => void }) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel="Deposit to Earn"
      style={[styles.depositNow, pressed && { opacity: 0.85 }]}
    >
      <Text style={styles.depositNowText}>Deposit now</Text>
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

// One card in the wallet grid. Its `width` is set explicitly (identical for all
// cells) instead of via flex, so content can never skew it wider than its
// neighbour; it stretches vertically to fill the row height.
//
// Layout: the glyph is pinned to the top and the text block to the bottom
// (`space-between`). When `footer` is supplied (the Earn card) the footer button
// joins the bottom block right under the label/value, so the extra element fits
// inside the same height as the other cards.
function Cell({
  icon,
  bg,
  width,
  bordered,
  onPress,
  footer,
  children,
}: {
  icon: ReactNode;
  bg?: string;
  width: number;
  bordered?: boolean;
  // Receives the card's on-screen rect (window coords) so the destination can
  // expand out of it. `undefined` when the rect couldn't be measured.
  onPress?: (rect?: CardRect) => void;
  footer?: ReactNode;
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
        bordered && styles.cellBordered,
        pressed && styles.cellPressed,
      ]}
    >
      <View>{icon}</View>
      {footer ? (
        <View style={styles.cellFooterGroup}>
          <View style={styles.cellBottom}>{children}</View>
          {footer}
        </View>
      ) : (
        <View style={styles.cellBottom}>{children}</View>
      )}
    </Pressable>
  );
}

export function WalletCategoryGrid({
  earnUsd,
  earnApyBps,
  stablecoinsUsd,
  cryptoUsd,
  banner,
  onPressEarn,
  onPressDeposit,
  onPressStablecoins,
  onPressCrypto,
}: {
  earnUsd: number;
  earnApyBps: number | null;
  stablecoinsUsd: number;
  cryptoUsd: number;
  /** The promo banner that fills the bottom-right cell. */
  banner: ReactNode;
  onPressEarn: () => void;
  onPressDeposit: () => void;
  onPressStablecoins: (rect?: CardSourceRect) => void;
  onPressCrypto: (rect?: CardSourceRect) => void;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const cellWidth = (windowWidth - GRID_PADDING * 2 - GRID_GAP) / 2;

  return (
    <View style={styles.grid}>
      <View style={styles.row}>
        <Cell
          icon={<EarnGlyph size={40} />}
          bg={EARN_BG}
          width={cellWidth}
          onPress={onPressEarn}
          footer={<DepositNowButton onPress={onPressDeposit} />}
        >
          <View style={styles.earnRow}>
            <Text
              className="text-[15px] font-semibold text-black"
              style={{ lineHeight: 20 }}
            >
              Earn
            </Text>
            {earnApyBps && earnApyBps > 0 ? (
              <View style={styles.apyBadge}>
                <Zap size={11} color="#FFFFFF" fill="#FFFFFF" strokeWidth={2.5} />
                <Text style={styles.apyText}>{formatApyBps(earnApyBps)} APY</Text>
              </View>
            ) : null}
          </View>
          <UsdValue value={earnUsd} />
        </Cell>
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
      </View>
      <View style={styles.row}>
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
        <View style={{ width: cellWidth }}>{banner}</View>
      </View>
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
  // always the same height: when there's spare vertical space they split it
  // evenly, and when space is tight they both settle at ROW_MIN_HEIGHT.
  row: {
    flex: 1,
    minHeight: ROW_MIN_HEIGHT,
    flexDirection: "row",
    alignItems: "stretch",
    gap: GRID_GAP,
  },
  // Width is set explicitly per cell (equal for all four). No `flex` on the
  // cell, so its width can't be skewed by content; it stretches vertically to
  // fill the row height. `overflow: hidden` clips rather than grows.
  cell: {
    borderRadius: 24,
    padding: 16,
    justifyContent: "space-between",
    overflow: "hidden",
  },
  cellBordered: {
    borderWidth: 1,
    borderColor: CELL_BORDER,
  },
  cellPressed: {
    opacity: 0.85,
  },
  cellBottom: {
    gap: 4,
  },
  // Bottom block of the Earn card: the label/value group plus the Deposit
  // button, spaced so the extra button fits within the shared cell height.
  cellFooterGroup: {
    gap: 8,
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
  valueCents: {
    fontFamily: "Geist_600SemiBold",
    color: CENTS_DIM,
  },
  depositNow: {
    backgroundColor: BRAND_RED,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  depositNowText: {
    color: "#FFFFFF",
    fontFamily: "Geist_500Medium",
    fontSize: 15,
    lineHeight: 20,
  },
});