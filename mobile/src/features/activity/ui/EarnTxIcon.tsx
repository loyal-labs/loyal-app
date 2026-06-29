import { Image, StyleSheet, View } from "react-native";
import Svg, { Ellipse, Path, Rect } from "react-native-svg";

import { env } from "@/config/env";
import type {
  EarnTransactionAccount,
  EarnTransactionItem,
} from "@/lib/solana/earn/earn-api";

import MainAvatar from "../../../../assets/images/earn/main-avatar.svg";
import MapleVenue from "../../../../assets/images/earn/venues/earn-maple.svg";

// The compound icon's two coins, and the per-venue logos used inline. The
// backend hands each account an icon as a host path (e.g.
// "/wallet-workspace/earn-onre.png"), keyed by file name here.
const USDC_ICON = require("../../../../assets/images/earn/usdc.png");
const KAMINO_ICON = require("../../../../assets/images/earn/venues/earn-kamino.png");
const VENUE_PNG: Record<string, number> = {
  "earn-kamino.png": KAMINO_ICON,
  "earn-onre.png": require("../../../../assets/images/earn/venues/earn-onre.png"),
  "earn-prime.png": require("../../../../assets/images/earn/venues/earn-prime.png"),
  "earn-ethena.png": require("../../../../assets/images/earn/venues/earn-ethena.png"),
};

const INLINE_SIZE = 16;

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function absoluteUrl(icon: string): string {
  return icon.startsWith("http") ? icon : `${env.earnApiBaseUrl}${icon}`;
}

// The red Earn-vault coin, recreated from the web's inline SVG (a rounded-square
// brand mark). Used big as the single allowance icon and small inline beside the
// "Earn" label.
export function EarnYieldIcon({ size = 48 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Rect width="64" height="64" rx="16" fill="#F9363C" />
      <Path
        d="M36 9.39795C36.22 9.35546 36.4427 9.3335 36.667 9.3335C41.4533 9.33394 45.3329 19.1837 45.333 31.3335C45.333 43.4835 41.4533 53.3331 36.667 53.3335C36.4427 53.3335 36.22 53.3125 36 53.27V53.3335H28L28 9.3335H36V9.39795Z"
        fill="#FD9528"
      />
      <Ellipse cx="27.3346" cy="31.3335" rx="8.66667" ry="22" fill="#FFD41B" />
    </Svg>
  );
}

// One coin of the compound pair, in its fixed slot. A venue side renders that
// venue's logo (the lone SVG venue, Maple, is clipped into the slot); otherwise
// the USDC/Kamino default. Styles go straight on the <Image> — the proven,
// correctly-aligned layout.
function CompoundCoin({
  src,
  fallback,
  slot,
}: {
  src: string | null;
  fallback: number;
  slot: "back" | "front";
}) {
  const slotStyle = slot === "back" ? styles.iconBack : styles.iconFront;
  if (src) {
    const base = basename(src);
    if (base === "earn-maple.svg") {
      return (
        <View style={[slotStyle, styles.coinClip]}>
          <MapleVenue width={32} height={32} />
        </View>
      );
    }
    const local = VENUE_PNG[base];
    return (
      <Image
        source={local ?? { uri: absoluteUrl(src) }}
        style={slotStyle}
      />
    );
  }
  return <Image source={fallback} style={slotStyle} />;
}

// The 48px stacked icon: source (back, top-left) over destination (front,
// bottom-right). Mirrors the web `CompoundIcon` — deposits/sweeps flow
// USDC -> Kamino, withdrawals Kamino -> USDC, and rebalances/deposits/withdrawals
// pass each side's real venue logo. Allowance actions move no funds, so they
// show a single Earn coin.
export function EarnTxCompoundIcon({
  item,
}: {
  item: {
    kind: EarnTransactionItem["kind"];
    source?: EarnTransactionAccount;
    destination?: EarnTransactionAccount;
  };
}) {
  if (item.kind === "autodeposit_action") {
    return (
      <View style={styles.singleClip}>
        <EarnYieldIcon size={48} />
      </View>
    );
  }

  const isMovement =
    item.kind === "rebalance" || item.kind === "reconciliation";
  const isWithdraw = item.kind === "withdraw";
  const backSrc =
    isMovement || isWithdraw ? (item.source?.icon ?? null) : null;
  const frontSrc =
    isMovement || item.kind === "deposit"
      ? (item.destination?.icon ?? null)
      : null;

  return (
    <View style={styles.iconWrap}>
      <CompoundCoin
        src={backSrc}
        fallback={isWithdraw ? KAMINO_ICON : USDC_ICON}
        slot="back"
      />
      <CompoundCoin
        src={frontSrc}
        fallback={isWithdraw ? USDC_ICON : KAMINO_ICON}
        slot="front"
      />
    </View>
  );
}

// Small inline mark beside a "source -> destination" label. The Earn vault reads
// as the brand coin; "Main" as the user avatar; venues as their own logo;
// Autodeposit (no icon) shows nothing — mirroring the web `FlowAccount`.
export function EarnTxAccountIcon({
  account,
}: {
  account: EarnTransactionAccount;
}) {
  if (account.label === "Earn") {
    return <EarnYieldIcon size={INLINE_SIZE} />;
  }
  const { icon } = account;
  if (!icon) {
    return null;
  }
  const base = basename(icon);
  if (base === "main-avatar.svg" || base === "Agent-01.svg") {
    return (
      <View style={styles.inlineClip}>
        <MainAvatar width={INLINE_SIZE} height={INLINE_SIZE} />
      </View>
    );
  }
  const local = VENUE_PNG[base];
  if (local) {
    return <Image source={local} resizeMode="cover" style={styles.inlineImg} />;
  }
  if (base === "earn-maple.svg") {
    return (
      <View style={styles.inlineClip}>
        <MapleVenue width={INLINE_SIZE} height={INLINE_SIZE} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri: absoluteUrl(icon) }}
      resizeMode="cover"
      style={styles.inlineImg}
    />
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 48,
    height: 48,
    position: "relative",
  },
  iconBack: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2.286,
    borderColor: "#ffffff",
  },
  iconFront: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  // Clips the Maple SVG into a round compound slot (PNG coins clip via the
  // Image's own borderRadius; an SVG needs the wrapper to hide overflow).
  coinClip: {
    overflow: "hidden",
  },
  singleClip: {
    width: 48,
    height: 48,
    borderRadius: 9999,
    overflow: "hidden",
  },
  inlineImg: {
    width: INLINE_SIZE,
    height: INLINE_SIZE,
    borderRadius: 4,
  },
  inlineClip: {
    width: INLINE_SIZE,
    height: INLINE_SIZE,
    borderRadius: 4,
    overflow: "hidden",
  },
});
