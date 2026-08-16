import type { ImageSourcePropType } from "react-native";

export type BalanceBackgroundOption = {
  /** null = no background (solid card). */
  id: string | null;
  /** Full-bleed image rendered behind the balance card. */
  source: ImageSourcePropType | null;
  /** Smaller circular preview rendered in the picker carousel. */
  thumb: ImageSourcePropType | null;
  /** Hand-picked dominant color used by the scroll-morph header. */
  dominantColor: string;
  /** Text color paired with `dominantColor` for legibility. */
  dominantTextColor: string;
};

export const BALANCE_BACKGROUND_OPTIONS: BalanceBackgroundOption[] = [
  {
    id: "balance-bg-01",
    source: require("../../../assets/images/balance-bgs/balance-bg-01.png"),
    thumb: require("../../../assets/images/balance-bgs/thumbs/balance-bg-01-thumb.png"),
    dominantColor: "#f9363c",
    dominantTextColor: "#ffffff",
  },
  {
    id: "balance-bg-02",
    source: require("../../../assets/images/balance-bgs/balance-bg-02.png"),
    thumb: require("../../../assets/images/balance-bgs/thumbs/balance-bg-02-thumb.png"),
    dominantColor: "#a64dff",
    dominantTextColor: "#ffffff",
  },
  {
    id: "balance-bg-03",
    source: require("../../../assets/images/balance-bgs/balance-bg-03.png"),
    thumb: require("../../../assets/images/balance-bgs/thumbs/balance-bg-03-thumb.png"),
    dominantColor: "#b8902b",
    dominantTextColor: "#ffffff",
  },
  {
    id: "balance-bg-04",
    source: require("../../../assets/images/balance-bgs/balance-bg-04.png"),
    thumb: require("../../../assets/images/balance-bgs/thumbs/balance-bg-04-thumb.png"),
    dominantColor: "#3c1d6e",
    dominantTextColor: "#ffffff",
  },
  {
    id: "balance-bg-05",
    source: require("../../../assets/images/balance-bgs/balance-bg-05.png"),
    thumb: require("../../../assets/images/balance-bgs/thumbs/balance-bg-05-thumb.png"),
    dominantColor: "#ef6259",
    dominantTextColor: "#ffffff",
  },
  {
    id: null,
    source: null,
    thumb: null,
    dominantColor: "#f2f2f7",
    dominantTextColor: "#1c1c1e",
  },
];

export function findBalanceBackground(
  id: string | null,
): BalanceBackgroundOption | undefined {
  return BALANCE_BACKGROUND_OPTIONS.find((option) => option.id === id);
}

export const DEFAULT_BALANCE_BACKGROUND_ID = "balance-bg-01";
