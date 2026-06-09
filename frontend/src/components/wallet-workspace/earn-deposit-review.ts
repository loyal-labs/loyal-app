import type {
  ApprovalReviewDisplayItem,
  ApprovalReviewDisplaySection,
  ApprovalReviewPage,
} from "@/components/wallet-sidebar/approval-review-content";
import type {
  EarnDepositDraft,
  EarnWithdrawDraft,
} from "@/components/wallet-sidebar/earn-detail-view";
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
  isPolicySetupFlow?: boolean;
  stage?: "deposit" | "policy";
}): ApprovalReviewDisplayItem {
  const stage = args.stage ?? "policy";
  const isPolicySetupFlow = args.isPolicySetupFlow ?? stage === "policy";
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
          value: [SwapLane.Jupiter]
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

  const policyPage: ApprovalReviewPage = {
    title: "Approval 1 of 2",
    heading: "Set up yield routing",
    mascotNote: `One-time setup so the ${EARN_VAULT_LABEL} can route your ${args.draft.symbol} across Kamino's Safe markets.`,
    rows: [
      {
        label: "What you're approving",
        value: `Deposit, withdraw, and swap permissions for ${args.draft.symbol} yield.`,
      },
    ],
    collapsibles: [
      {
        title: "Policy details",
        rows: [
          { label: "Kamino yield policy", value: "Deposit, withdraw" },
          { label: "Markets", value: safeMarketLabels },
          { label: "Swap policy", value: "Swap via Jupiter" },
          { label: "Stablecoins", value: stablecoinMintLabels },
        ],
      },
    ],
  };
  const depositPage: ApprovalReviewPage = {
    title: isPolicySetupFlow ? "Approval 2 of 2" : "Deposit",
    amount: args.draft.amountLabel,
    symbol: args.draft.symbol,
    heading: `Deposit into ${EARN_VAULT_LABEL}`,
    mascotNote:
      isPolicySetupFlow
        ? "Now, last step to put the money in!"
        : `Top up your ${EARN_VAULT_LABEL} with ${args.draft.symbol}.`,
    rows: [
      {
        label: "First",
        value: `${args.draft.source.label} sends $${args.draft.amountLabel} ${args.draft.symbol} into ${EARN_VAULT_LABEL}.`,
      },
      {
        label: "Then",
        value: `${EARN_VAULT_LABEL} deposits the ${args.draft.symbol} into Kamino Main Market USDC.`,
      },
    ],
    collapsibles: [
      {
        title: "Transaction details",
        rows: [
          { label: "From", value: args.draft.source.label },
          { label: "To", value: EARN_VAULT_LABEL },
          { label: "Earning in", value: "Kamino Main Market USDC reserve" },
          {
            label: "Reserve address",
            value: USDC_MAIN_MARKET_RESERVE_ADDRESS,
          },
        ],
      },
    ],
  };
  const pages = stage === "policy" ? [policyPage] : [depositPage];

  return {
    actionMode: "vote",
    amount: args.draft.amountLabel,
    destinationLabel: EARN_VAULT_LABEL,
    pages,
    primaryActionLabel: stage === "policy" ? "Sign" : "Continue",
    reviewSections,
    secondaryActionLabel: "Cancel",
    sourceLabel: args.draft.source.label,
    status: "draft",
    statusLabel: "Ready to review",
    summaryLabel:
      stage === "policy"
        ? "Launch yield optimization policy"
        : `Deposit into ${EARN_VAULT_LABEL}`,
    symbol: args.draft.symbol,
    title: "Deposit",
  };
}

export function buildEarnWithdrawReviewItem(args: {
  draft: EarnWithdrawDraft;
}): ApprovalReviewDisplayItem {
  const actionLabel =
    args.draft.mode === "full" ? "Withdraw all" : "Withdraw";
  const reviewSections: ApprovalReviewDisplaySection[] = [
    {
      title: "Transaction #1",
      rows: [
        {
          label: "Withdraw",
          value: `${actionLabel} $${args.draft.amountLabel} ${args.draft.symbol} from ${EARN_VAULT_LABEL}`,
        },
        {
          label: "Destination",
          value: `${args.draft.destination.label} (${args.draft.destination.addressLabel})`,
        },
      ],
    },
  ];

  return {
    actionMode: "vote",
    amount: args.draft.amountLabel,
    destinationLabel: args.draft.destination.label,
    primaryActionLabel: "Continue",
    reviewSections,
    secondaryActionLabel: "Cancel",
    sourceLabel: EARN_VAULT_LABEL,
    status: "draft",
    statusLabel: "Ready to review",
    summaryLabel: "Withdraw from Earn vault",
    symbol: args.draft.symbol,
    title: actionLabel,
  };
}
