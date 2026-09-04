import { View } from "@/tw";

import EarnCoinsSvg from "../../../../assets/images/wallet/earn-coins.svg";
import StablecoinsGlyphSvg from "../../../../assets/images/wallet/stablecoins-glyph.svg";

// Green rounded square with a white "$", straight from the design asset.
export function StablecoinsGlyph({ size = 48 }: { size?: number }) {
  return <StablecoinsGlyphSvg width={size} height={size} />;
}

// Brand-red rounded square with stacked gold coins (Figma 141:5892).
export function EarnGlyph({ size = 40 }: { size?: number }) {
  return <EarnCoinsSvg width={size} height={size} />;
}

// Purple rounded square with three white bars (Figma 74:18073). Recreated with
// views so it scales cleanly between the 48px row icon and 64px balance icon.
export function CryptoGlyph({ size = 48 }: { size?: number }) {
  const unit = size / 48;
  const bar = {
    position: "absolute" as const,
    width: 6 * unit,
    borderRadius: 2 * unit,
    backgroundColor: "#FFFFFF",
  };
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 12 * unit,
        backgroundColor: "#9946FC",
        overflow: "hidden",
      }}
    >
      <View style={{ ...bar, left: 8 * unit, top: 24 * unit, height: 16 * unit }} />
      <View style={{ ...bar, left: 21 * unit, top: 8 * unit, height: 32 * unit }} />
      <View style={{ ...bar, left: 34 * unit, top: 16 * unit, height: 24 * unit }} />
    </View>
  );
}
