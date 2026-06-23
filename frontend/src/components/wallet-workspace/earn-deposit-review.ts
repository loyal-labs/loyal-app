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
  SmartAccountPreparedEarnUsdcCleanup,
  SmartAccountPreparedEarnUsdcDeposit,
  SmartAccountPreparedEarnUsdcWithdraw,
} from "@loyal-labs/smart-account-vaults";
import {
  KAMINO_ETHENA_MARKET,
  KAMINO_FIGURE_MARKET,
  KAMINO_MAIN_MARKET,
  KAMINO_MAPLE_MARKET,
  KAMINO_ONRE_MARKET,
  RISK_BASKET_MARKETS,
  STABLECOIN_MINTS,
} from "@loyal-labs/actions/constants";
import { RiskBasket, Stablecoin } from "@loyal-labs/actions/types";

import {
  getEarnDepositReviewStagePosition,
  getEarnDepositReviewStages,
  getFirstEarnDepositReviewStage,
  getNextEarnDepositReviewStage,
  type EarnDepositReviewStage,
} from "@/lib/yield-optimization/earn-deposit-flow.shared";

const EARN_VAULT_LABEL = "Earn vault";
const MAIN_ACCOUNT_FULL_ADDRESS =
  "BAqgbERmvUViqDSx961xpRBHGt68SpACiWL4t9696qZZ";

export type { EarnDepositReviewStage };
export type EarnAutodepositSetupReviewStage =
  | "authority"
  | "delegation"
  | "policy";
export type EarnWithdrawReviewStage = "autodeposit" | `withdraw-${number}`;

export type EarnDepositReviewState = {
  draft: EarnDepositDraft | null;
  isPolicySetupFlow: boolean;
  preparedDeposit: SmartAccountPreparedEarnUsdcDeposit | null;
  stage: EarnDepositReviewStage;
};

const KAMINO_MARKET_NAMES = new Map<string, string>([
  [KAMINO_MAIN_MARKET.toBase58(), "Main Kamino"],
  [KAMINO_FIGURE_MARKET.toBase58(), "Prime"],
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

function formatKaminoMarketLabel(market: string | null | undefined): string {
  if (!market) {
    return "Kamino Safe market";
  }

  const marketName = KAMINO_MARKET_NAMES.get(market);
  return formatNameWithShortId(
    marketName ? `${marketName} Market` : "Kamino market",
    market
  );
}

function formatSolLamports(lamports: number): string {
  if (!Number.isFinite(lamports) || lamports <= 0) {
    return "0 SOL";
  }

  return `${(lamports / 1_000_000_000).toLocaleString("en-US", {
    maximumFractionDigits: 6,
    minimumFractionDigits: 6,
  })} SOL`;
}

function getDepositTargetRows(
  preparedDeposit: SmartAccountPreparedEarnUsdcDeposit | null | undefined
): ApprovalReviewDisplaySection["rows"] {
  const market =
    preparedDeposit?.targetReserve.market.toBase58() ??
    preparedDeposit?.persistence.market;
  const reserve =
    preparedDeposit?.targetReserve.reserve.toBase58() ??
    preparedDeposit?.persistence.targetReserve;
  const liquidityMint =
    preparedDeposit?.targetReserve.liquidityMint.toBase58() ??
    preparedDeposit?.persistence.liquidityMint;

  return [
    {
      label: "Route",
      value: "Safe same-mint USDC through Kamino",
    },
    ...(market
      ? [{ label: "Market", value: formatKaminoMarketLabel(market) }]
      : []),
    ...(reserve ? [{ label: "Reserve", value: shortenAddress(reserve) }] : []),
    ...(liquidityMint
      ? [{ label: "Liquidity mint", value: shortenAddress(liquidityMint) }]
      : []),
  ];
}

function getWithdrawTargetRows(
  preparedWithdraw: SmartAccountPreparedEarnUsdcWithdraw | null | undefined,
  stepIndex = 0
): ApprovalReviewDisplaySection["rows"] {
  const step = preparedWithdraw?.withdrawSteps[stepIndex];
  const reserveWithdrawals = step?.reserveWithdrawals ?? [];
  if (reserveWithdrawals.length > 0) {
    return [
      {
        label: "Route",
        value: "Withdraw same-mint USDC from Kamino Safe",
      },
      ...reserveWithdrawals.flatMap((withdrawal, index) => [
        {
          label:
            reserveWithdrawals.length > 1 ? `Reserve ${index + 1}` : "Reserve",
          value: shortenAddress(withdrawal.accountingReserve),
        },
        ...(withdrawal.market
          ? [
              {
                label:
                  reserveWithdrawals.length > 1
                    ? `Market ${index + 1}`
                    : "Market",
                value: formatKaminoMarketLabel(withdrawal.market),
              },
            ]
          : []),
        ...(withdrawal.executionReserve !== withdrawal.accountingReserve
          ? [
              {
                label:
                  reserveWithdrawals.length > 1
                    ? `Kamino execution reserve ${index + 1}`
                    : "Kamino execution reserve",
                value: shortenAddress(withdrawal.executionReserve),
              },
            ]
          : []),
        {
          label:
            reserveWithdrawals.length > 1
              ? `Withdraw amount ${index + 1}`
              : "Withdraw amount",
          value: `${Number(BigInt(withdrawal.withdrawnAmountRaw)) / 1_000_000}`,
        },
      ]),
    ];
  }
  const market =
    step?.accountingReserve.market.toBase58() ??
    preparedWithdraw?.targetReserve.market.toBase58();
  const reserve =
    step?.accountingReserve.reserve.toBase58() ??
    preparedWithdraw?.targetReserve.reserve.toBase58();
  const executionReserve = step?.executionReserve.reserve.toBase58();
  const liquidityMint =
    step?.accountingReserve.liquidityMint.toBase58() ??
    preparedWithdraw?.targetReserve.liquidityMint.toBase58();

  return [
    {
      label: "Route",
      value: "Withdraw same-mint USDC from Kamino Safe",
    },
    ...(market
      ? [{ label: "Market", value: formatKaminoMarketLabel(market) }]
      : []),
    ...(reserve ? [{ label: "Reserve", value: shortenAddress(reserve) }] : []),
    ...(executionReserve && executionReserve !== reserve
      ? [
          {
            label: "Kamino execution reserve",
            value: shortenAddress(executionReserve),
          },
        ]
      : []),
    ...(liquidityMint
      ? [{ label: "Liquidity mint", value: shortenAddress(liquidityMint) }]
      : []),
  ];
}

function getWithdrawStageIndex(stage: EarnWithdrawReviewStage): number {
  if (stage === "autodeposit") {
    return 0;
  }
  const match = /^withdraw-(\d+)$/.exec(stage);
  return match ? Number(match[1]) : 0;
}

export function getEarnWithdrawReviewStages(args: {
  hasAutodepositTeardown?: boolean;
  preparedWithdraw?: SmartAccountPreparedEarnUsdcWithdraw | null;
}): EarnWithdrawReviewStage[] {
  const withdrawStepCount = Math.max(
    1,
    args.preparedWithdraw?.withdrawSteps.length ?? 1
  );
  return [
    ...(args.hasAutodepositTeardown ? (["autodeposit"] as const) : []),
    ...Array.from(
      { length: withdrawStepCount },
      (_, index) => `withdraw-${index}` as const
    ),
  ];
}

export function getNextEarnWithdrawReviewStage(args: {
  currentStage: EarnWithdrawReviewStage;
  hasAutodepositTeardown?: boolean;
  preparedWithdraw?: SmartAccountPreparedEarnUsdcWithdraw | null;
}): EarnWithdrawReviewStage | null {
  const stages = getEarnWithdrawReviewStages(args);
  const currentIndex = stages.indexOf(args.currentStage);
  return currentIndex >= 0
    ? stages[currentIndex + 1] ?? null
    : stages[0] ?? null;
}

function formatStablecoinMintLabels(): string {
  return Object.values(Stablecoin)
    .map((stablecoin) =>
      formatNameWithShortId(stablecoin, STABLECOIN_MINTS[stablecoin].toBase58())
    )
    .join(", ");
}

export function createSubmittedEarnDepositReviewState(args: {
  draft: EarnDepositDraft;
  preparedDeposit?: SmartAccountPreparedEarnUsdcDeposit | null;
  requiresPolicySetup: boolean;
}): EarnDepositReviewState {
  const preparedDeposit = args.preparedDeposit ?? null;
  const stages = getEarnDepositReviewStages({
    preparedDeposit,
    requiresPolicySetup: args.requiresPolicySetup,
  });

  return {
    draft: args.draft,
    isPolicySetupFlow: stages.some((stage) => stage !== "deposit"),
    preparedDeposit,
    stage: stages[0] ?? "deposit",
  };
}

export function advanceEarnDepositReviewStage(
  state: EarnDepositReviewState
): EarnDepositReviewState {
  if (!state.draft) {
    return state;
  }

  const nextStage = getNextEarnDepositReviewStage({
    currentStage: state.stage,
    preparedDeposit: state.preparedDeposit,
    requiresPolicySetup: state.isPolicySetupFlow,
  });

  return {
    draft: state.draft,
    isPolicySetupFlow: state.isPolicySetupFlow,
    preparedDeposit: state.preparedDeposit,
    stage: nextStage ?? state.stage,
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
  const preparedDeposit = args.preparedDeposit ?? null;
  const stage =
    args.stage ??
    getFirstEarnDepositReviewStage({
      preparedDeposit,
      requiresPolicySetup: args.isPolicySetupFlow,
    });
  const stages = getEarnDepositReviewStages({
    preparedDeposit,
    requiresPolicySetup: args.isPolicySetupFlow,
  });
  const { index: stageIndex, total: approvalCount } =
    getEarnDepositReviewStagePosition({
      preparedDeposit,
      requiresPolicySetup: args.isPolicySetupFlow,
      stage,
    });
  const isPolicySetupFlow =
    args.isPolicySetupFlow ?? stages.some((item) => item !== "deposit");
  const stablecoinMintLabels = formatStablecoinMintLabels();
  const safeMarketLabels = formatSafeMarketLabels();
  const targetRows = getDepositTargetRows(preparedDeposit);
  const depositRows: ApprovalReviewDisplaySection["rows"] = [
    {
      label: "Transfer",
      value: `Deposit $${args.draft.amountLabel} ${args.draft.symbol} into ${EARN_VAULT_LABEL}`,
    },
    {
      label: "Earn",
      value: `${EARN_VAULT_LABEL} deposits same-mint USDC through Kamino Safe`,
    },
    ...targetRows,
  ];
  const reviewSections: ApprovalReviewDisplaySection[] = stages.map(
    (item, itemIndex) => {
      const title =
        stages.length > 1
          ? `Approval #${itemIndex + 1}`
          : item === "deposit"
          ? "Transaction #1"
          : "Approval #1";

      if (item === "policy") {
        return {
          title,
          rows: [
            { label: "Setup", value: "Create Safe Earn route policy" },
            { label: "Kamino policy", value: "Deposit and withdraw USDC" },
            { label: "Markets", value: `Kamino markets: ${safeMarketLabels}` },
            { label: "Mints", value: stablecoinMintLabels },
            ...(preparedDeposit?.policy.account
              ? [
                  {
                    label: "Policy account",
                    value: shortenAddress(
                      preparedDeposit.policy.account.toBase58()
                    ),
                  },
                ]
              : []),
          ],
        };
      }

      if (item === "policy-finalize") {
        return {
          title,
          rows: [
            { label: "Setup", value: "Create Kamino obligation policy" },
            { label: "Permission", value: "Initialize the Earn obligation" },
            ...(preparedDeposit?.setupPolicy?.account
              ? [
                  {
                    label: "Policy account",
                    value: shortenAddress(
                      preparedDeposit.setupPolicy.account.toBase58()
                    ),
                  },
                ]
              : []),
          ],
        };
      }

      return {
        title,
        rows: depositRows,
      };
    }
  );

  const approvalTitle =
    approvalCount > 1
      ? `Approval ${stageIndex} of ${approvalCount}`
      : stage === "deposit"
      ? "Deposit"
      : "Approval";

  const policyPage: ApprovalReviewPage = {
    title: approvalTitle,
    heading: "Set up Safe Earn routing",
    mascotNote: `First, let's set up the policy that lets Loyal agents route your money across Kamino stablecoin reserves: ${safeMarketLabels}. You keep full custody the whole time.`,
    rows: [
      {
        label: "What you're approving",
        value: `Deposit and withdraw permissions for ${args.draft.symbol} Earn routing.`,
      },
    ],
    collapsibles: [
      {
        title: "Policy details",
        rows: [
          { label: "Kamino yield policy", value: "Deposit, withdraw" },
          { label: "Markets", value: safeMarketLabels },
          { label: "Stablecoins", value: stablecoinMintLabels },
          ...targetRows,
        ],
      },
    ],
  };
  const finalizePage: ApprovalReviewPage = {
    title: approvalTitle,
    heading: "Set up Earn obligation",
    mascotNote:
      "Next, let's add one more policy so your agent can keep Kamino deposit data up to date. That helps the routing policy do its job correctly.",
    rows: [
      {
        label: "Policy",
        value: "Initialize Kamino obligation",
      },
      ...(preparedDeposit?.setupPolicy?.account
        ? [
            {
              label: "Policy account",
              value: shortenAddress(
                preparedDeposit.setupPolicy.account.toBase58()
              ),
            },
          ]
        : []),
    ],
    collapsibles: [
      {
        title: "Routing details",
        rows: targetRows,
      },
    ],
  };
  const depositPage: ApprovalReviewPage = {
    title: approvalTitle,
    amount: `$${args.draft.amountLabel}`,
    heading: `Deposit into ${EARN_VAULT_LABEL}`,
    hideAmountHeading: true,
    mascotNote: isPolicySetupFlow
      ? `Now you'll deposit $${args.draft.amountLabel} into Earn. As soon as it lands, Loyal agents can start optimizing it across the Safe reserves.`
      : "Your Earn policy is already ready, so this deposit can go straight into Earn and route to the current Safe reserve.",
    rows: [
      {
        label: "First",
        value: `You send ${args.draft.amountLabel} ${args.draft.symbol} into ${EARN_VAULT_LABEL}.`,
      },
      {
        label: "Then",
        value: `${EARN_VAULT_LABEL} deposits ${args.draft.symbol} into the prepared Kamino Safe reserve.`,
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
          ...targetRows,
        ],
      },
    ],
  };
  const pages =
    stage === "policy"
      ? [policyPage]
      : stage === "policy-finalize"
      ? [finalizePage]
      : [depositPage];

  return {
    actionMode: "vote",
    amount: args.draft.amountLabel,
    destinationLabel: EARN_VAULT_LABEL,
    pages,
    primaryActionLabel:
      stage === "deposit" ? `Deposit $${args.draft.amountLabel}` : "Sign",
    reviewSections,
    secondaryActionLabel: "Cancel",
    sourceLabel: args.draft.source.label,
    status: "draft",
    statusLabel: "Ready to review",
    summaryLabel:
      stage === "policy"
        ? "Set up Safe Earn routing"
        : stage === "policy-finalize"
        ? "Set up Earn obligation"
        : `Deposit into ${EARN_VAULT_LABEL}`,
    symbol: args.draft.symbol,
    title: "Deposit",
  };
}

export function buildEarnWithdrawReviewItem(args: {
  draft: EarnWithdrawDraft;
  hasAutodepositTeardown?: boolean;
  preparedWithdraw?: SmartAccountPreparedEarnUsdcWithdraw | null;
  stage?: EarnWithdrawReviewStage;
}): ApprovalReviewDisplayItem {
  const source = args.draft.source ?? {
    amountRaw: "0",
    balance: 0,
    id: "reserve:fallback",
    label: EARN_VAULT_LABEL,
    liquidityMint: "",
    market: null,
    reserve: null,
    sourceId: "",
    tokenAccount: null,
    type: "reserve" as const,
  };
  const actionLabel = args.draft.mode === "full" ? "Withdraw all" : "Withdraw";
  const hasAutodepositTeardown =
    args.draft.mode === "full" && Boolean(args.hasAutodepositTeardown);
  const stages = getEarnWithdrawReviewStages({
    hasAutodepositTeardown,
    preparedWithdraw: args.preparedWithdraw,
  });
  const stage = args.stage ?? stages[0] ?? "withdraw-0";
  const currentStepIndex = getWithdrawStageIndex(stage);
  const targetRows = getWithdrawTargetRows(
    args.preparedWithdraw,
    currentStepIndex
  );
  const step = args.preparedWithdraw?.withdrawSteps[currentStepIndex];
  const idleVaultUsdcRaw = step?.persistence.vaultUsdcRemainderRaw
    ? BigInt(step.persistence.vaultUsdcRemainderRaw)
    : BigInt(0);
  const approvalNumber = Math.max(1, stages.indexOf(stage) + 1);
  const approvalCount = stages.length;
  const isFinalWithdrawStep =
    currentStepIndex ===
    Math.max(0, (args.preparedWithdraw?.withdrawSteps.length ?? 1) - 1);
  const finalWithdrawRows: ApprovalReviewDisplaySection["rows"] = [
    {
      label: "Withdraw",
      value: `${actionLabel} $${args.draft.amountLabel} ${args.draft.symbol} from ${EARN_VAULT_LABEL}`,
    },
    {
      label: "Source",
      value: source.label,
    },
    {
      label: "Destination",
      value: `${args.draft.destination.label} (${args.draft.destination.addressLabel})`,
    },
    ...targetRows,
    ...(args.draft.mode === "full" && isFinalWithdrawStep
      ? [
          ...(idleVaultUsdcRaw > BigInt(0)
            ? [
                {
                  label: "Idle vault USDC",
                  value: `${Number(idleVaultUsdcRaw) / 1_000_000} ${
                    args.draft.symbol
                  }`,
                },
              ]
            : []),
          {
            label: "Final cleanup",
            value:
              "Close vault-owned token accounts when safe and remove the Earn policy",
          },
        ]
      : args.draft.mode === "full"
      ? [
          {
            label: "Source cleanup",
            value: "Mark only the selected Earn source as withdrawn",
          },
        ]
      : []),
  ];
  const reviewSections: ApprovalReviewDisplaySection[] = [
    ...stages.map((reviewStage, index) =>
      reviewStage === "autodeposit"
        ? {
            title: `Approval #${index + 1}`,
            rows: [
              {
                label: "Autodeposit",
                value: "Close recurring allowance and refund rent",
              },
            ],
          }
        : {
            title:
              approvalCount > 1 ? `Approval #${index + 1}` : "Transaction #1",
            rows:
              reviewStage === stage
                ? finalWithdrawRows
                : [
                    {
                      label: "Withdraw",
                      value: `${actionLabel} from ${EARN_VAULT_LABEL}`,
                    },
                  ],
          }
    ),
  ];

  return {
    actionMode: "vote",
    amount: args.draft.amountLabel,
    destinationLabel: args.draft.destination.label,
    pages: [
      stage === "autodeposit"
        ? {
            title: `Approval ${approvalNumber} of ${approvalCount}`,
            heading: "Remove Autodeposit",
            mascotNote:
              "Before you fully exit, let's turn off Autodeposit so no future sweep can refill Earn after this withdrawal.",
            rows: [
              {
                label: "Autodeposit",
                value: "Close recurring allowance and refund rent",
              },
            ],
          }
        : {
            title: `Approval ${approvalNumber} of ${approvalCount}`,
            amount: `$${args.draft.amountLabel}`,
            heading: isFinalWithdrawStep
              ? "Withdraw from Earn vault"
              : "Withdraw reserve step",
            hideAmountHeading: true,
            mascotNote: isFinalWithdrawStep
              ? args.draft.mode === "full"
                ? "I'm sorry to see you go. This transaction returns your money, closes the Earn accounts, and refunds the rent you've paid. You're always welcome back."
                : "This returns USDC from the Earn source you selected. Your Earn setup stays active for the rest of your position."
              : "Your Earn balance is split across sources, so we'll withdraw this one first and then continue to the next step.",
            rows: [
              ...(step
                ? [
                    {
                      label: "Step amount",
                      value: `${Number(step.amountRaw) / 1_000_000} ${
                        args.draft.symbol
                      }`,
                    },
                  ]
                : []),
              ...finalWithdrawRows,
            ],
          },
    ],
    primaryActionLabel:
      stage === "autodeposit"
        ? "Remove Autodeposit"
        : isFinalWithdrawStep
        ? "Withdraw"
        : "Approve step",
    reviewSections,
    secondaryActionLabel: "Cancel",
    sourceLabel: source.label,
    status: "draft",
    statusLabel: "Ready to review",
    summaryLabel: "Withdraw from Earn vault",
    symbol: args.draft.symbol,
    title: actionLabel,
  };
}

export function buildEarnCleanupReviewItem(args: {
  preparedCleanup?: (SmartAccountPreparedEarnUsdcCleanup & {
    estimatedRefundLamports?: number | null;
  }) | null;
}): ApprovalReviewDisplayItem {
  const preparedCleanup = args.preparedCleanup ?? null;
  const idleTransferRaw = preparedCleanup?.persistence.idleTransferAmountRaw
    ? BigInt(preparedCleanup.persistence.idleTransferAmountRaw)
    : BigInt(0);
  const estimatedRefundLamports =
    preparedCleanup?.estimatedRefundLamports ?? null;
  const rows: ApprovalReviewDisplaySection["rows"] = [
    {
      label: "Earn balance",
      value: "$0.00 USDC",
    },
    {
      label: "Cleanup",
      value: "Close Earn routing policies and vault token accounts",
    },
    ...(preparedCleanup?.setupPolicy
      ? [
          {
            label: "Setup policy",
            value: shortenAddress(
              preparedCleanup.setupPolicy.account.toBase58()
            ),
          },
        ]
      : []),
    ...(preparedCleanup?.persistence.closedCollateralAtas.length
      ? [
          {
            label: "Collateral accounts",
            value: `${preparedCleanup.persistence.closedCollateralAtas.length}`,
          },
        ]
      : []),
    ...(idleTransferRaw > BigInt(0)
      ? [
          {
            label: "Idle vault USDC",
            value: `${Number(idleTransferRaw) / 1_000_000} USDC`,
          },
        ]
      : []),
    ...(preparedCleanup?.autodepositClosePrepared
      ? [
          {
            label: "Autodeposit",
            value: "Close recurring allowance and refund rent",
          },
        ]
      : []),
    ...(estimatedRefundLamports !== null
      ? [
          {
            label: "Estimated refund",
            value: formatSolLamports(estimatedRefundLamports),
          },
        ]
      : []),
  ];

  return {
    actionMode: "execute",
    amount: "$0",
    destinationLabel: "Main Account",
    pages: [
      {
        heading: "Close Earn setup",
        hideAmountHeading: true,
        mascotNote:
          "Your Earn balance is already withdrawn. This closes the remaining Earn accounts and refunds rent where possible.",
        rows,
        title: "Close Earn setup",
      },
    ],
    primaryActionLabel: "Close policies",
    reviewSections: [
      {
        rows,
        title: "Cleanup",
      },
    ],
    secondaryActionLabel: "Cancel",
    sourceLabel: EARN_VAULT_LABEL,
    status: "draft",
    statusLabel: "Ready to close",
    summaryLabel: "Close Earn setup",
    symbol: "USDC",
    title: "Close Earn setup",
  };
}

export function buildEarnAutodepositSetupReviewItem(args: {
  draft: EarnAutodepositDraft;
  preparedSetup?: SmartAccountPreparedEarnUsdcAutodepositSetup | null;
  stage?: EarnAutodepositSetupReviewStage;
}): ApprovalReviewDisplayItem {
  const stage =
    args.preparedSetup?.stage === "create_recurring_delegation"
      ? "delegation"
      : args.preparedSetup?.stage === "create_policy"
      ? "policy"
      : args.preparedSetup?.stage === "initialize_subscription_authority"
      ? "authority"
      : args.stage ?? "policy";
  const isEdit = Boolean(
    args.draft.amountChanged !== undefined ||
      args.draft.keepAmountChanged !== undefined
  );
  const requiresSignature = args.draft.requiresSignature ?? true;
  const autodepositFloorLabel = `${args.draft.keepAmountLabel} ${args.draft.symbol}`;
  const autodepositSweepRule = `Keep ${autodepositFloorLabel} in Main Account; move the rest to Earn`;
  const changeRows: ApprovalReviewDisplaySection["rows"] = [
    ...(args.draft.amountChanged ?? !isEdit
      ? [
          {
            label: "Sweep rule",
            value: autodepositSweepRule,
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
    : isEdit && stage === "authority"
    ? [
        {
          label: "Primitive",
          value: "Initialize allowance authority",
        },
        {
          label: "Policy",
          value: "Keep existing Autodeposit policy seed",
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
    : stage === "authority"
    ? [
        {
          label: "Primitive",
          value: "Initialize allowance authority",
        },
      ]
    : stage === "policy"
    ? [
        {
          label: "Primitive",
          value: "Create Autodeposit policy",
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
    ...(!requiresSignature
      ? [
          {
            title: "Database update",
            rows:
              changeRows.length > 0
                ? changeRows
                : [
                    {
                      label: "Changes",
                      value: "No Autodeposit changes detected",
                    },
                  ],
          },
        ]
      : !isEdit
      ? [
          {
            title: "Approval #1",
            rows: [
              {
                label: "Setup",
                value: "Initialize allowance authority",
              },
            ],
          },
          {
            title: "Approval #2",
            rows: [
              {
                label: "Policy",
                value:
                  "Create the Autodeposit policy for this recurring allowance",
              },
              {
                label: "Allowance",
                value: autodepositSweepRule,
              },
              {
                label: "Minimum balance",
                value: `Keep ${args.draft.keepAmountLabel} ${args.draft.symbol} in Main Account`,
              },
            ],
          },
          {
            title: "Approval #3",
            rows: [
              {
                label: "Allowance",
                value: autodepositSweepRule,
              },
              {
                label: "Minimum balance",
                value: `Keep ${args.draft.keepAmountLabel} ${args.draft.symbol} in Main Account`,
              },
              { label: "Delegatee", value: EARN_VAULT_LABEL },
              ...(recurringDelegation
                ? [
                    {
                      label: "Delegation",
                      value: shortenAddress(recurringDelegation),
                    },
                  ]
                : []),
            ],
          },
        ]
      : [
          {
            title: "Approval #1",
            rows: [
              ...(changeRows.length > 0
                ? changeRows
                : [
                    {
                      label: "Changes",
                      value: "No Autodeposit changes detected",
                    },
                  ]),
              ...onChainRows,
            ],
          },
        ]),
  ];
  const heading = !requiresSignature
    ? "Save Autodeposit setting"
    : isEdit
    ? "Update recurring allowance"
    : "Initialize allowance authority";
  const firstPageTitle = !requiresSignature
    ? "Autodeposit"
    : isEdit
    ? "Approval"
    : "Approval 1 of 3";

  return {
    actionMode: "vote",
    amount: args.draft.keepAmountLabel,
    destinationLabel: EARN_VAULT_LABEL,
    pages: [
      stage === "authority"
        ? {
            title: firstPageTitle,
            heading,
            mascotNote: !requiresSignature
              ? "Saved. This only updates your Autodeposit rule in Loyal, so there's no wallet approval this time."
              : isEdit
              ? "This updates your signed Autodeposit settings while keeping the same policy in place."
              : "Solana has native subscriptions now. Since this is your first Earn subscription, let's set up the authority that makes Autodeposit possible.",
            rows: changeRows,
            collapsibles: [
              {
                title: requiresSignature
                  ? "On-chain details"
                  : "Update details",
                rows: [...changeRows, ...onChainRows],
              },
            ],
          }
        : stage === "policy"
        ? {
            title: isEdit ? "Approval" : "Approval 2 of 3",
            heading: "Create policy",
            mascotNote: `This lowers the minimum USDC balance our agents keep in your wallet to $${args.draft.keepAmountLabel}.`,
            rows: changeRows,
            collapsibles: [
              {
                title: "On-chain details",
                rows: [...changeRows, ...onChainRows],
              },
            ],
          }
        : {
            title: isEdit ? "Approval" : "Approval 3 of 3",
            amount: args.draft.keepAmountLabel,
            heading: "Keep in Main Account",
            symbol: args.draft.symbol,
            mascotNote:
              "This lets Loyal agents sign the transaction that moves eligible USDC from your wallet to your smart account and into Earn.",
            rows: [
              {
                label: "Sweep rule",
                value: autodepositSweepRule,
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
      : stage === "authority"
      ? "Initialize authority"
      : stage === "policy"
      ? "Create policy"
      : "Create allowance",
    reviewSections,
    secondaryActionLabel: "Cancel",
    sourceLabel: args.draft.source.label,
    status: "draft",
    statusLabel: "Ready to review",
    summaryLabel: isEdit
      ? "Update Main Account floor"
      : "Set Main Account floor",
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
          "This closes the recurring delegation from your wallet and removes the smart account permission. Autodeposits stop, and refundable rent comes back to your wallet.",
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
