import type {
  ApprovalReviewDisplayItem,
  ApprovalReviewDisplaySection,
} from "@/components/wallet-sidebar/approval-review-content";
import type { EarnDepositDraft } from "@/components/wallet-sidebar/earn-detail-view";
import {
  KAMINO_ETHENA_MARKET,
  KAMINO_FIGURE_MARKET,
  KAMINO_MAIN_MARKET,
  KAMINO_MAPLE_MARKET,
  KAMINO_ONRE_MARKET,
  RISK_BASKET_MARKETS,
  STABLECOIN_MINTS,
} from "@loyal/actions/constants";
import { RiskBasket, Stablecoin, SwapLane } from "@loyal/actions/types";

const EARN_VAULT_LABEL = "Earn vault";
const USDC_MAIN_MARKET_RESERVE_ADDRESS =
  "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59";

const KAMINO_MARKET_NAMES = new Map<string, string>([
  [KAMINO_MAIN_MARKET.toBase58(), "Main"],
  [KAMINO_FIGURE_MARKET.toBase58(), "Figure"],
  [KAMINO_MAPLE_MARKET.toBase58(), "Maple"],
  [KAMINO_ONRE_MARKET.toBase58(), "OnRe"],
  [KAMINO_ETHENA_MARKET.toBase58(), "Ethena"],
]);

function shortenAddress(value: string): string {
  return value.length <= 12
    ? value
    : `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function formatNameWithShortId(name: string, id: string | null): string {
  return id ? `${name} (${shortenAddress(id)})` : name;
}

function formatSafeMarketLabels(): string {
  return RISK_BASKET_MARKETS[RiskBasket.Safe]
    .map((market) => {
      const id = market.toBase58();
      return KAMINO_MARKET_NAMES.get(id) ?? "Market";
    })
    .join(", ");
}

function formatStablecoinMintLabels(): string {
  return Object.values(Stablecoin)
    .map((stablecoin) =>
      formatNameWithShortId(stablecoin, STABLECOIN_MINTS[stablecoin].toBase58())
    )
    .join(", ");
}

function formatSwapLaneLabel(lane: SwapLane): string {
  return lane.charAt(0).toUpperCase() + lane.slice(1);
}

export function buildEarnDepositReviewItem(args: {
  draft: EarnDepositDraft;
}): ApprovalReviewDisplayItem {
  const stablecoinMintLabels = formatStablecoinMintLabels();
  const safeMarketLabels = formatSafeMarketLabels();
  const reviewSections: ApprovalReviewDisplaySection[] = [
    {
      title: "Transaction #1",
      rows: [
        {
          label: "Deposit",
          value: `Deposit $${args.draft.amountLabel} ${args.draft.symbol} into ${EARN_VAULT_LABEL}`,
        },
      ],
    },
    {
      title: "Policy #1",
      rows: [
        { label: "Policy", value: "Kamino yield policy" },
        { label: "Actions", value: "Deposit, withdraw" },
        {
          label: "Markets",
          value: `Kamino markets: ${safeMarketLabels}`,
        },
        { label: "Mints", value: stablecoinMintLabels },
      ],
    },
    {
      title: "Policy #2",
      rows: [
        { label: "Policy", value: "Swap policy" },
        { label: "Actions", value: "Swap" },
        {
          label: "Supported lanes",
          value: [SwapLane.Jupiter, SwapLane.Loyal]
            .map(formatSwapLaneLabel)
            .join(", "),
        },
        { label: "Mints", value: stablecoinMintLabels },
      ],
    },
    {
      title: "Transaction #2",
      rows: [
        {
          label: "Deposit",
          value: `${EARN_VAULT_LABEL} sends $${args.draft.amountLabel} ${args.draft.symbol} to Main Market USDC reserve (${USDC_MAIN_MARKET_RESERVE_ADDRESS})`,
        },
      ],
    },
  ];

  return {
    actionMode: "vote",
    amount: args.draft.amountLabel,
    destinationLabel: EARN_VAULT_LABEL,
    primaryActionLabel: "Continue",
    reviewSections,
    secondaryActionLabel: "Cancel",
    sourceLabel: args.draft.source.label,
    status: "draft",
    statusLabel: "Ready to review",
    summaryLabel: "Launch yield optimization policy",
    symbol: args.draft.symbol,
    title: "Deposit",
  };
}
