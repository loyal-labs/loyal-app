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
export type EarnAutodepositSetupReviewStage = "delegation" | "policy";
export type EarnWithdrawReviewStage = "autodeposit" | "withdraw";

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
  preparedWithdraw: SmartAccountPreparedEarnUsdcWithdraw | null | undefined
): ApprovalReviewDisplaySection["rows"] {
  const market = preparedWithdraw?.targetReserve.market.toBase58();
  const reserve = preparedWithdraw?.targetReserve.reserve.toBase58();
  const liquidityMint = preparedWithdraw?.targetReserve.liquidityMint.toBase58();

  return [
    {
      label: "Route",
      value: "Withdraw same-mint USDC from Kamino Safe",
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
    mascotNote: `One-time setup so the ${EARN_VAULT_LABEL} can route your ${args.draft.symbol} through Kamino Safe same-mint reserves.`,
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
      "This one-time policy lets the Earn vault initialize its Kamino obligation before depositing.",
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
      ? "Final approval: move USDC into Earn and route it through Kamino."
      : `Top up your ${EARN_VAULT_LABEL} with ${args.draft.symbol}.`,
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
  const actionLabel = args.draft.mode === "full" ? "Withdraw all" : "Withdraw";
  const hasAutodepositTeardown =
    args.draft.mode === "full" && Boolean(args.hasAutodepositTeardown);
  const stage = args.stage ?? "withdraw";
  const targetRows = getWithdrawTargetRows(args.preparedWithdraw);
  const finalWithdrawRows: ApprovalReviewDisplaySection["rows"] = [
    {
      label: "Withdraw",
      value: `${actionLabel} $${args.draft.amountLabel} ${args.draft.symbol} from ${EARN_VAULT_LABEL}`,
    },
    {
      label: "Destination",
      value: `${args.draft.destination.label} (${args.draft.destination.addressLabel})`,
    },
    ...targetRows,
    ...(args.draft.mode === "full"
      ? [
          {
            label: "Cleanup",
            value:
              "Close vault-owned token accounts when safe and remove the Earn policy",
          },
        ]
      : []),
  ];
  const reviewSections: ApprovalReviewDisplaySection[] = [
    ...(hasAutodepositTeardown
      ? [
          {
            title: "Approval #1",
            rows: [
              {
                label: "Autodeposit",
                value: "Close recurring allowance and refund rent",
              },
            ],
          },
        ]
      : []),
    {
      title: hasAutodepositTeardown ? "Approval #2" : "Transaction #1",
      rows: finalWithdrawRows,
    },
  ];

  return {
    actionMode: "vote",
    amount: args.draft.amountLabel,
    destinationLabel: args.draft.destination.label,
    pages: hasAutodepositTeardown
      ? [
          stage === "autodeposit"
            ? {
                title: "Approval 1 of 2",
                heading: "Remove Autodeposit",
                mascotNote:
                  "First, close the recurring allowance before withdrawing everything.",
                rows: [
                  {
                    label: "Autodeposit",
                    value: "Close recurring allowance and refund rent",
                  },
                ],
              }
            : {
                title: "Approval 2 of 2",
                amount: `$${args.draft.amountLabel}`,
                heading: "Withdraw from Earn vault",
                hideAmountHeading: true,
                mascotNote:
                  "Now withdraw from Kamino, transfer USDC back to your wallet, and clean up Earn.",
                rows: finalWithdrawRows,
              },
        ]
      : undefined,
    primaryActionLabel: hasAutodepositTeardown
      ? stage === "autodeposit"
        ? "Remove Autodeposit"
        : "Withdraw"
      : "Withdraw",
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
                value: "Create allowance authority and Autodeposit policy",
              },
              {
                label: "Policy",
                value:
                  "Allow Loyal automation to use only this Autodeposit path",
              },
              ...(policyAccount
                ? [
                    {
                      label: "Policy account",
                      value: shortenAddress(policyAccount),
                    },
                  ]
                : []),
            ],
          },
          {
            title: "Approval #2",
            rows: [
              {
                label: "Allowance",
                value: `${args.draft.amountLabel} ${args.draft.symbol} every month`,
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
