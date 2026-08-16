import { Image, StyleSheet, View } from "react-native";

import type { EarnVenueKey } from "@/lib/solana/earn/earn-position-display";

import MapleVenue from "../../../assets/images/earn/venues/earn-maple.svg";

// Per-market brand badges shown over the token coin on Earn positions/sources
// (Positions sheet + Withdraw picker). Every market without a dedicated badge
// falls back to the Kamino mark (`venue: "kamino"`). Kept in one place so the
// asset map isn't copied per sheet.
const VENUE_PNG: Record<Exclude<EarnVenueKey, "maple">, number> = {
  kamino: require("../../../assets/images/earn/venues/earn-kamino.png"),
  prime: require("../../../assets/images/earn/venues/earn-prime.png"),
  onre: require("../../../assets/images/earn/venues/earn-onre.png"),
  ethena: require("../../../assets/images/earn/venues/earn-ethena.png"),
};

export function VenueBadge({
  venue,
  size = 32,
}: {
  venue: EarnVenueKey;
  size?: number;
}) {
  return (
    <View
      style={[
        styles.badge,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      {venue === "maple" ? (
        <MapleVenue width={size * 0.84} height={size * 0.84} />
      ) : (
        <Image source={VENUE_PNG[venue]} style={styles.image} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderWidth: 2.29,
    borderColor: "#FFF",
    backgroundColor: "#0A1A2F",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  image: {
    width: "100%",
    height: "100%",
  },
});
