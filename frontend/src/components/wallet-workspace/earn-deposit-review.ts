import type {
  ApprovalReviewDisplayItem,
  ApprovalReviewDisplaySection,
  ApprovalReviewPage,
} from "@/components/wallet-sidebar/approval-review-content";
import type {
  EarnAutodepositDraft,
  EarnDepositDraft,
  EarnWithdrawDraft,
} from "@/components/wallet-sidebar/earn-detail-view";
import type {
  SmartAccountPreparedEarnUsdcAutodepositClose,
  SmartAccountPreparedEarnUsdcAutodepositSetup,
  SmartAccountPreparedEarnUsdcDeposit,
} from "@loyal-labs/smart-account-vaults";
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
const MAIN_ACCOUNT_FULL_ADDRESS =
  "BAqgbERmvUViqDSx961xpRBHGt68SpACiWL4t9696qZZ";

export type EarnDepositReviewStage = "deposit" | "policy";
export type EarnAutodepositSetupReviewStage = "delegation" | "policy";

export type EarnDepositReviewState = {
  draft: EarnDepositDraft | null;
  isPolicySetupFlow: boolean;
  preparedDeposit: SmartAccountPreparedEarnUsdcDeposit | null;
  stage: EarnDepositReviewStage;
};

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

export function createSubmittedEarnDepositReviewState(args: {
  draft: EarnDepositDraft;
  preparedDeposit?: SmartAccountPreparedEarnUsdcDeposit | null;
  requiresPolicySetup: boolean;
}): EarnDepositReviewState {
  return {
    draft: args.draft,
    isPolicySetupFlow: args.requiresPolicySetup,
    preparedDeposit: args.preparedDeposit ?? null,
    stage: args.requiresPolicySetup ? "policy" : "deposit",
  };
}

export function advanceEarnDepositReviewAfterPolicySetup(
  state: EarnDepositReviewState
): EarnDepositReviewState {
  if (!state.draft) {
    return state;
  }

  return {
    draft: state.draft,
    isPolicySetupFlow: true,
    preparedDeposit: state.preparedDeposit,
    stage: "deposit",
  };
}

export function setEarnDepositReviewPreparedDeposit(
  state: EarnDepositReviewState,
  preparedDeposit: SmartAccountPreparedEarnUsdcDeposit
): EarnDepositReviewState {
  return {
    ...state,
    preparedDeposit,
  };
}

export function applyEarnDepositFormDraftChange(
  state: EarnDepositReviewState,
  draft: EarnDepositDraft | null
): EarnDepositReviewState {
  if (draft === null && state.draft) {
    return state;
  }

  const isSameDraft = draft === state.draft;

  return {
    draft,
    isPolicySetupFlow: draft ? state.isPolicySetupFlow : false,
    preparedDeposit: draft && isSameDraft ? state.preparedDeposit : null,
    stage: draft ? state.stage : "deposit",
  };
}

function formatLamportsAsSol(lamports: string): string {
  const value = BigInt(lamports);
  const whole = value / BigInt(1_000_000_000);
  const fraction = (value % BigInt(1_000_000_000)).toString().padStart(9, "0");
  return `${whole.toString()}.${fraction} SOL`;
}

export function buildEarnDepositReviewItem(args: {
  draft: EarnDepositDraft;
  isPolicySetupFlow?: boolean;
  preparedDeposit?: SmartAccountPreparedEarnUsdcDeposit | null;
  stage?: EarnDepositReviewStage;
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
          value: [SwapLane.Jupiter].map(formatSwapLaneLabel).join(", "),
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
    amount: `$${args.draft.amountLabel}`,
    heading: `Deposit into ${EARN_VAULT_LABEL}`,
    hideAmountHeading: true,
    mascotNote: isPolicySetupFlow
      ? "Now, last step to put the money in!"
      : `Top up your ${EARN_VAULT_LABEL} with ${args.draft.symbol}.`,
    rows: [
      {
        label: "First",
        value: `You send ${args.draft.amountLabel} ${args.draft.symbol} into ${EARN_VAULT_LABEL}.`,
      },
      {
        label: "Then",
        value: `${EARN_VAULT_LABEL} deposits the ${args.draft.symbol} into Kamino Main Market USDC.`,
      },
    ],
    collapsibles: [
      ...(args.preparedDeposit?.kaminoSetupRequired
        ? [
            {
              title: "One-time Kamino setup",
              rows: [
                {
                  label: "Setup",
                  value: `Creates the ${EARN_VAULT_LABEL}'s Kamino accounts and reserves about ${formatLamportsAsSol(
                    args.preparedDeposit.kaminoSetupRentLamports
                  )} for rent.`,
                },
              ],
            },
          ]
        : []),
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
    primaryActionLabel:
      stage === "policy"
        ? "Sign"
        : `Deposit ${args.draft.amountLabel} ${args.draft.symbol}`,
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
  const actionLabel = args.draft.mode === "full" ? "Withdraw all" : "Withdraw";
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

export function buildEarnAutodepositSetupReviewItem(args: {
  draft: EarnAutodepositDraft;
  preparedSetup?: SmartAccountPreparedEarnUsdcAutodepositSetup | null;
  stage?: EarnAutodepositSetupReviewStage;
}): ApprovalReviewDisplayItem {
  const stage = args.stage ?? "policy";
  const isEdit = Boolean(
    args.draft.amountChanged !== undefined ||
      args.draft.keepAmountChanged !== undefined
  );
  const requiresSignature = args.draft.requiresSignature ?? true;
  const changeRows: ApprovalReviewDisplaySection["rows"] = [
    ...(args.draft.amountChanged ?? !isEdit
      ? [
          {
            label: "Max deposit",
            value: `${args.draft.amountLabel} ${args.draft.symbol} every month`,
          },
        ]
      : []),
    ...(args.draft.keepAmountChanged ?? !isEdit
      ? [
          {
            label: "Minimum balance",
            value: `Keep ${args.draft.keepAmountLabel} ${args.draft.symbol} in Main Account (${MAIN_ACCOUNT_FULL_ADDRESS})`,
          },
        ]
      : []),
  ];
  const recurringDelegation =
    args.preparedSetup?.persistence.recurringDelegation ?? null;
  const policyAccount = args.preparedSetup?.persistence.policyAccount ?? null;
  const onChainRows: ApprovalReviewDisplaySection["rows"] = !requiresSignature
    ? [
        {
          label: "Update",
          value: "Save database-only Autodeposit setting",
        },
      ]
    : isEdit && stage === "policy"
    ? [
        {
          label: "Primitive",
          value: "Update recurring allowance",
        },
        {
          label: "Policy",
          value: "Reuse existing Autodeposit policy",
        },
        ...(args.draft.existingPolicySeed
          ? [
              {
                label: "Policy seed",
                value: args.draft.existingPolicySeed,
              },
            ]
          : []),
      ]
    : stage === "policy"
    ? [
        {
          label: "Primitive",
          value: "Create allowance authority and policy",
        },
        {
          label: "Policy",
          value: "Allow Loyal automation to pull only this allowance into Earn",
        },
        ...(policyAccount
          ? [
              {
                label: "Policy account",
                value: shortenAddress(policyAccount),
              },
            ]
          : []),
      ]
    : [
        {
          label: "Primitive",
          value: "Create recurring allowance",
        },
        {
          label: "Delegatee",
          value: EARN_VAULT_LABEL,
        },
        ...(recurringDelegation
          ? [
              {
                label: "Delegation",
                value: shortenAddress(recurringDelegation),
              },
            ]
          : []),
        ...(policyAccount
          ? [
              {
                label: "Policy account",
                value: shortenAddress(policyAccount),
              },
            ]
          : []),
      ];
  const reviewSections: ApprovalReviewDisplaySection[] = [
    {
      title: isEdit ? "Autodeposit changes" : "Allowance",
      rows:
        changeRows.length > 0
          ? changeRows
          : [{ label: "Changes", value: "No Autodeposit changes detected" }],
    },
    {
      title: requiresSignature ? "On-chain setup" : "Database update",
      rows: onChainRows,
    },
  ];
  const heading = !requiresSignature
    ? "Save Autodeposit setting"
    : isEdit
    ? "Update recurring allowance"
    : "Create allowance authority and policy";
  const firstPageTitle = !requiresSignature
    ? "Autodeposit"
    : isEdit
    ? "Approval"
    : "Approval 1 of 2";

  return {
    actionMode: "vote",
    amount: args.draft.amountLabel,
    destinationLabel: EARN_VAULT_LABEL,
    pages: [
      stage === "policy"
        ? {
            title: firstPageTitle,
            heading,
            mascotNote: !requiresSignature
              ? "This setting updates your saved Autodeposit rule only."
              : isEdit
              ? "This updates the signed allowance while keeping the same Earn policy."
              : "First, create the allowance authority and policy that lets Loyal use only this Autodeposit path.",
            rows: changeRows,
            collapsibles: [
              {
                title: requiresSignature
                  ? "On-chain details"
                  : "Update details",
                rows: reviewSections.flatMap((section) => section.rows),
              },
            ],
          }
        : {
            title: "Approval 2 of 2",
            amount: args.draft.amountLabel,
            symbol: args.draft.symbol,
            heading: "Create recurring allowance",
            mascotNote:
              "Now create the recurring allowance from Main Account to the Earn vault.",
            rows: [
              {
                label: "Frequency",
                value: `${args.draft.amountLabel} ${args.draft.symbol} every month`,
              },
              {
                label: "Minimum balance",
                value: `Keep ${args.draft.keepAmountLabel} ${args.draft.symbol} in Main Account (${MAIN_ACCOUNT_FULL_ADDRESS})`,
              },
            ],
            collapsibles: [
              {
                title: "Delegation details",
                rows: reviewSections.flatMap((section) => section.rows),
              },
            ],
          },
    ],
    primaryActionLabel: !requiresSignature
      ? "Save changes"
      : stage === "policy"
      ? "Sign"
      : "Create recurring allowance",
    reviewSections,
    secondaryActionLabel: "Cancel",
    sourceLabel: args.draft.source.label,
    status: "draft",
    statusLabel: "Ready to review",
    summaryLabel: isEdit
      ? "Update monthly Autodeposit"
      : "Create monthly Autodeposit",
    symbol: args.draft.symbol,
    title: "Autodeposit",
  };
}

export function buildEarnAutodepositCloseReviewItem(args: {
  amountLabel: string;
  preparedClose?: SmartAccountPreparedEarnUsdcAutodepositClose | null;
}): ApprovalReviewDisplayItem {
  const delegation = args.preparedClose?.persistence.recurringDelegation;
  const policy = args.preparedClose?.persistence.policyAccount;
  const reviewSections: ApprovalReviewDisplaySection[] = [
    {
      title: "Close Autodeposit",
      rows: [
        {
          label: "Allowance",
          value: "Revoke the recurring allowance and refund allowance rent",
        },
        {
          label: "Policy",
          value: "Remove the automation policy and refund policy rent",
        },
        ...(delegation
          ? [{ label: "Delegation", value: shortenAddress(delegation) }]
          : []),
        ...(policy
          ? [{ label: "Policy account", value: shortenAddress(policy) }]
          : []),
      ],
    },
  ];

  return {
    actionMode: "vote",
    amount: args.amountLabel,
    destinationLabel: "Main Account",
    pages: [
      {
        title: "Autodeposit",
        heading: "Turn off Autodeposit",
        mascotNote:
          "This closes the allowance path and removes Loyal's automation policy.",
        rows: [
          {
            label: "Refunds",
            value:
              "Allowance and policy rent return through the owning programs.",
          },
        ],
        collapsibles: [
          {
            title: "Close details",
            rows: reviewSections.flatMap((section) => section.rows),
          },
        ],
      },
    ],
    primaryActionLabel: "Turn off Autodeposit",
    reviewSections,
    secondaryActionLabel: "Cancel",
    sourceLabel: EARN_VAULT_LABEL,
    status: "draft",
    statusLabel: "Ready to review",
    summaryLabel: "Close Autodeposit",
    symbol: "USDC",
    title: "Autodeposit",
  };
}
