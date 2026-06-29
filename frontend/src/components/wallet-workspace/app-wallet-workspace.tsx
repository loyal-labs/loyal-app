"use client";

import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  Copy,
  Eye,
  EyeOff,
  File as FileIcon,
  KeyRound,
  LayoutTemplate,
  LogOut,
  Plus,
  ReceiptText,
  RefreshCw,
  Repeat2,
  Shield as ShieldIcon,
  Sparkles,
  Wallet,
} from "lucide-react";
import type { PortfolioPosition } from "@loyal-labs/solana-wallet";
import {
  createSmartAccountVaultsClient,
  SOL_SPENDING_LIMIT_MINT,
  type SmartAccountEarnUsdcDepositInput,
  type SmartAccountEarnUsdcReserveTargetInput,
  type SmartAccountEarnUsdcWithdrawInput,
  type SmartAccountOverview,
  type SmartAccountPreparedEarnUsdcAutodepositClose,
  type SmartAccountPreparedEarnUsdcAutodepositSetup,
  type SmartAccountPreparedEarnUsdcDeposit,
  type SmartAccountPreparedEarnUsdcWithdraw,
} from "@loyal-labs/smart-account-vaults";
import { resolveSolanaEnv } from "@loyal-labs/solana-rpc";
import {
  AccountLayout,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { type Connection, PublicKey } from "@solana/web3.js";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";

import { WalletReconnectPrompt } from "@/components/auth/wallet-reconnect-prompt";
import { PrivateClientPreloader } from "@/components/solana/private-client-preloader";
import { AgentPageView } from "@/components/wallet-sidebar/agent-page-view";
import {
  ApprovalReviewContent,
  type ApprovalReviewDisplayItem,
} from "@/components/wallet-sidebar/approval-review-content";
import { ConnectRequestContent } from "@/components/wallet-sidebar/connect-request-content";
import {
  PortfolioContent,
  type MockRootSignerEntry,
} from "@/components/wallet-sidebar/portfolio-content";
import { ReceiveContent } from "@/components/wallet-sidebar/receive-content";
import {
  type RecipientSuggestion,
  SendContent,
  type SendContentVaultContext,
} from "@/components/wallet-sidebar/send-content";
import {
  ShieldContent,
  SwapShieldTabs,
} from "@/components/wallet-sidebar/shield-content";
import type { DraftProposalView } from "@/components/wallet-sidebar/draft-preview-content";
import {
  AutodepositSetupView,
  EarnDepositView,
  EarnDetailView,
  EarnWithdrawView,
  type EarnDepositDraft,
  type EarnAutodepositDraft,
  type EarnDepositSourceOption,
  type EarnWithdrawDraft,
  type EarnWithdrawSourceOption,
} from "@/components/wallet-sidebar/earn-detail-view";
import type { PermissionChangeDraft } from "@/components/wallet-sidebar/permission-preview-content";
import type { SpendingLimitDraft } from "@/components/wallet-sidebar/spending-limit-preview-content";
import { StashDetailView } from "@/components/wallet-sidebar/stash-detail-view";
import { SwapContent } from "@/components/wallet-sidebar/swap-content";
import { TokenSelectView } from "@/components/wallet-sidebar/token-select-view";
import { TokenDetailView } from "@/components/wallet-sidebar/token-detail-view";
import { TransactionDetailView } from "@/components/wallet-sidebar/transaction-detail-view";
import { getVaultIcon } from "@/components/wallet-sidebar/vault-icon";
import type { TokenRowActions } from "@/components/wallet-sidebar/token-row-item";
import type {
  FormButtonProps,
  SubView,
  SwapMode,
  SwapToken,
  TokenRow,
  TransactionDetail,
} from "@/components/wallet-sidebar/types";
import {
  LOYL_TOKEN,
  swapTokens as fallbackSwapTokens,
} from "@/components/wallet-sidebar/types";
import { WalletDetailView } from "@/components/wallet-sidebar/wallet-detail-view";
import type {
  SmartAccountApprovalItem,
  SmartAccountSidebarData,
  SmartAccountSignerEntry,
  VaultTransferCapability,
  VaultTransferRequest,
} from "@/hooks/use-smart-account-sidebar-data";
import { invalidateEarnEarningsCache } from "@/hooks/use-earn-earnings";
import { invalidateEarnTransactionsCache } from "@/lib/yield-optimization/earn-transactions.client";
import {
  isActiveEarnPosition,
  useActiveEarnPosition,
  type ActiveEarnPosition,
  type ActiveEarnPositionHolding,
} from "@/hooks/use-active-earn-position";
import {
  prepareEarnAutodepositSetupOnServer,
  prepareEarnCleanupOnServer,
  type PreparedEarnUsdcCleanup,
  useSmartAccountSidebarData,
} from "@/hooks/use-smart-account-sidebar-data";
import { usePopularTokens } from "@/hooks/use-popular-tokens";
import {
  splitUsdBalance,
  useWalletDesktopData,
} from "@/hooks/use-wallet-desktop-data";
import { useAuthSession } from "@/contexts/auth-session-context";
import { usePublicEnv } from "@/contexts/public-env-context";
import { useSignInModal } from "@/contexts/sign-in-modal-context";
import { useAuthCapability } from "@/lib/auth/capability";
import {
  readClientCache,
  removeClientCache,
  writeClientCache,
} from "@/lib/client-cache/client-cache";
import { trackWalletShieldPressed } from "@/lib/core/analytics";
import { resolveTrackedKaminoUsdcMint } from "@/lib/kamino/kamino-usdc-position";
import { getTokenIconUrl } from "@/lib/token-icon";
import {
  getStablecoinMintSetForSolanaEnv,
  sumPublicStablecoinUsd,
} from "@/lib/wallet/stablecoin-classification";
import {
  getFrontendPrivateClient,
  hasReusableFrontendPrivateClientAuth,
  type FrontendPrivateClientSigner,
} from "@/lib/solana/private-client-cache";
import {
  earnAutodepositConfigFromLoadedState,
  isLoadedEarnAutodepositConfig,
  type LoadedEarnAutodepositConfig,
  type LoadedEarnAutodepositScheduledSweep,
} from "@/lib/yield-optimization/earn-autodeposit-loaded-state.shared";
import { resolveEarnPositionDisplay } from "@/lib/yield-optimization/earn-position-display";
import { AddSignerPane } from "./add-signer-pane";
import { ApprovalsPane } from "./approvals-pane";
import { BuilderBlocksPane } from "./builder-blocks-pane";
import {
  advanceEarnDepositReviewStage,
  applyEarnDepositFormDraftChange,
  buildEarnCleanupReviewItem,
  buildEarnDepositReviewItem,
  buildEarnAutodepositCloseReviewItem,
  buildEarnAutodepositSetupReviewItem,
  buildEarnWithdrawReviewItem,
  createSubmittedEarnDepositReviewState,
  getNextEarnWithdrawReviewStage,
  type EarnAutodepositSetupReviewStage,
  type EarnDepositReviewStage,
  type EarnWithdrawReviewStage,
} from "./earn-deposit-review";
import {
  EarnTransactionsPane,
  type PendingScheduledSweepPreview,
} from "./earn-transactions-pane";
import {
  mockPolicies,
  type NewPolicyMode,
  PoliciesPane,
  PolicyGlyph,
} from "./policies-pane";
import { PolicyDetailsPane } from "./policy-details-pane";
import { SettingsPane } from "./settings-pane";
import { WorkflowBuilderPane } from "./workflow-builder-pane";
import {
  WalletCommandMenu,
  type WalletCommandGroup,
} from "./wallet-command-menu";

type WorkspaceAction = "receive" | "send" | "swap" | "shield";
type WorkspaceSection = "policies" | "settings" | "wallet";
type MobilePane = "accounts" | "activity" | "detail";
type DetailTab = "activity" | "tokens";
type DetailPaneTransition = "back" | "close" | "forward" | "open" | "switch";
type DetailSelection =
  | "action"
  | "addSigner"
  | "agent"
  | "approval"
  | "connect"
  | "earn"
  | "earnAutodeposit"
  | "earnDeposit"
  | "earnWithdraw"
  | "overview"
  | "vault"
  | "wallet";
type ResizeTarget = "account" | "review";
type EarnAutodepositConfig = Omit<LoadedEarnAutodepositConfig, "state"> & {
  state:
    | LoadedEarnAutodepositConfig["state"]
    | "closing"
    | "pausing"
    | "resuming";
};
type EarnWithdrawVaultsSource = NonNullable<
  SmartAccountEarnUsdcWithdrawInput["source"]
>;
type EarnWithdrawFullWithdrawalTarget = NonNullable<
  SmartAccountEarnUsdcWithdrawInput["fullWithdrawalTargets"]
>[number];
type EarnDepositYieldRoutingPolicy = NonNullable<
  SmartAccountEarnUsdcDepositInput["yieldRoutingPolicy"]
>;
type PendingRootSignerDraft = {
  signerAddress: string;
};
type PendingRootSignerRemovalDraft = {
  signerAddress: string;
};
type PersistedWorkspaceSelection =
  | {
      type: "agent";
      accountIndex: number;
      signerAddress?: string;
      signerId: string;
    }
  | {
      type: "user";
      accountIndex: number;
      signerAddress: string;
      signerId: string;
    }
  | { type: "earn" }
  | { type: "vault"; accountIndex: number }
  | { type: "wallet" };
const PANE_WIDTH_STORAGE_KEY = "loyal-wallet-workspace-pane-widths";
const SELECTED_WORKSPACE_ITEM_STORAGE_KEY =
  "loyal-wallet-workspace-selected-item";
const ACCOUNT_PANE_MIN_WIDTH = 360;
const ACCOUNT_PANE_MAX_WIDTH = 520;
const ACCOUNT_PANE_DEFAULT_WIDTH = 400;
const REVIEW_PANE_MIN_WIDTH = 320;
const REVIEW_PANE_MAX_WIDTH = 520;
const REVIEW_PANE_DEFAULT_WIDTH = 400;
const ENABLE_MOCK_BACKUP_SIGNER_FLOW = true;
const EXPERIMENTAL_MODE_SESSION_KEY = "loyal.wallet.experimentalMode";
const MOBILE_WORKSPACE_MEDIA_QUERY = "(max-width: 760px)";
const MOBILE_PANE_HISTORY_KEY = "__loyalMobilePaneBack";

type MobilePaneHistoryState = Record<string, unknown> & {
  [MOBILE_PANE_HISTORY_KEY]?: true;
};

// Named variants so the exit propagates to descendants (the floating mascot
// fades itself out on "exit"); "afterChildren" holds the slide-out until that
// fade completes.
const EARN_REVIEW_OVERLAY_VARIANTS: Variants = {
  enter: {
    x: 0,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
  },
  exit: {
    x: "100%",
    transition: {
      duration: 0.32,
      ease: [0.22, 1, 0.36, 1],
      when: "afterChildren",
    },
  },
  hidden: { x: "100%" },
};

function clampWidth(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getWalletIcon(): string {
  return "/agents/Agent-01.svg";
}

function getMockRootSignerIcon(index: number): string {
  return `/agents/Agent-${String(index + 2).padStart(2, "0")}.svg`;
}

function createMobilePaneHistoryState(): MobilePaneHistoryState {
  const currentState = window.history.state;

  if (currentState && typeof currentState === "object") {
    return {
      ...(currentState as Record<string, unknown>),
      [MOBILE_PANE_HISTORY_KEY]: true,
    };
  }

  return { [MOBILE_PANE_HISTORY_KEY]: true };
}

function formatAddressForEarnSource(
  address: string | null | undefined
): string {
  if (!address) return "Unknown";
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function splitUsdcSourceBalance(value: number): {
  fraction: string;
  whole: string;
} {
  const formatted = Number.isFinite(value)
    ? value.toLocaleString("en-US", {
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      })
    : "0.00";
  const [whole = "0", fraction = "00"] = formatted.split(".");
  return { fraction, whole };
}

function findEarnUsdcPosition(
  positions: PortfolioPosition[],
  trackedUsdcMint: string | null
): PortfolioPosition | undefined {
  if (trackedUsdcMint) {
    const trackedPosition = positions.find(
      (position) => position.asset.mint === trackedUsdcMint
    );

    if (trackedPosition) {
      return trackedPosition;
    }
  }

  return positions.find(
    (position) => position.asset.symbol.toUpperCase() === "USDC"
  );
}

function getPublicPositionUsd(position: PortfolioPosition | undefined): number {
  if (!position) {
    return 0;
  }

  if (
    typeof position.publicValueUsd === "number" &&
    Number.isFinite(position.publicValueUsd)
  ) {
    return position.publicValueUsd;
  }

  if (
    typeof position.priceUsd === "number" &&
    Number.isFinite(position.priceUsd)
  ) {
    return position.publicBalance * position.priceUsd;
  }

  return 0;
}

function findTrackedUsdcToken(
  tokens: SwapToken[],
  trackedUsdcMint: string | null
): SwapToken | undefined {
  if (trackedUsdcMint) {
    const trackedToken = tokens.find((token) => token.mint === trackedUsdcMint);

    if (trackedToken) {
      return trackedToken;
    }
  }

  return tokens.find((token) => token.symbol.toUpperCase() === "USDC");
}

function readPersistedWorkspaceSelection(): PersistedWorkspaceSelection | null {
  const stored = window.localStorage.getItem(
    SELECTED_WORKSPACE_ITEM_STORAGE_KEY
  );

  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored) as Record<string, unknown>;

    if (parsed.type === "wallet") {
      return { type: "wallet" };
    }

    if (parsed.type === "earn") {
      return { type: "earn" };
    }

    if (parsed.type === "vault" && typeof parsed.accountIndex === "number") {
      return { type: "vault", accountIndex: parsed.accountIndex };
    }

    if (
      parsed.type === "agent" &&
      typeof parsed.accountIndex === "number" &&
      typeof parsed.signerId === "string"
    ) {
      return {
        type: "agent",
        accountIndex: parsed.accountIndex,
        signerAddress:
          typeof parsed.signerAddress === "string"
            ? parsed.signerAddress
            : undefined,
        signerId: parsed.signerId,
      };
    }

    if (
      parsed.type === "user" &&
      typeof parsed.accountIndex === "number" &&
      typeof parsed.signerAddress === "string" &&
      typeof parsed.signerId === "string"
    ) {
      return {
        type: "user",
        accountIndex: parsed.accountIndex,
        signerAddress: parsed.signerAddress,
        signerId: parsed.signerId,
      };
    }
  } catch {
    window.localStorage.removeItem(SELECTED_WORKSPACE_ITEM_STORAGE_KEY);
  }

  return null;
}

const actionLabels: Record<WorkspaceAction, string> = {
  receive: "Receive",
  send: "Send",
  shield: "Shield",
  swap: "Swap",
};

function viewType(view: SubView) {
  return typeof view === "object" && view !== null ? view.type : view;
}

function shouldLoadPopularTokensForView(view: SubView) {
  const type = viewType(view);
  return type === "swapPanel" || type === "tokenSelect";
}

function initialActionTransition(
  view: Exclude<SubView, null>
): DetailPaneTransition {
  const type = viewType(view);

  return type === "tokenDetail" ||
    type === "transaction" ||
    type === "tokenSelect" ||
    type === "sendTokenSelect" ||
    type === "shieldTokenSelect"
    ? "forward"
    : "open";
}

function tokenRowToSwapToken(token: TokenRow): SwapToken {
  const mint = token.id?.replace(/-secured$/, "");

  return {
    balance: Number.parseFloat(token.amount.replace(/,/g, "")) || 0,
    icon: token.icon,
    isSecured: token.isSecured,
    mint,
    price: Number.parseFloat(token.price.replace(/[$,]/g, "")) || 0,
    symbol: token.symbol,
  };
}

function shortCommandAddress(address: string | null | undefined): string {
  if (!address) return "No wallet connected";
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function portfolioPositionToSwapToken(position: PortfolioPosition): SwapToken {
  return {
    balance: position.publicBalance,
    icon: position.asset.imageUrl ?? getTokenIconUrl(position.asset.symbol),
    mint: position.asset.mint,
    price: position.priceUsd ?? 0,
    symbol: position.asset.symbol,
  };
}

function lookupVaultMintDecimals(
  overview: SmartAccountOverview | null,
  accountIndex: number,
  mint: string | undefined
): number | undefined {
  if (!(overview && mint)) return undefined;
  const vault = overview.vaults.find(
    (entry) => entry.accountIndex === accountIndex
  );
  const position = vault?.portfolio.positions.find(
    (entry) => entry.asset.mint === mint
  );
  return position?.asset.decimals;
}

function shortAddressForLabel(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function formatAmountForDraft(amount: number): string {
  return amount.toLocaleString("en-US", {
    maximumFractionDigits: 9,
    minimumFractionDigits: 0,
  });
}

function parseTokenAmountLabelToRaw(
  amountLabel: string,
  decimals: number
): bigint {
  const normalized = amountLabel.replace(/,/g, "").trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error("Enter a valid deposit amount.");
  }

  const [wholePart, fractionPart = ""] = normalized.split(".");
  const fraction = fractionPart.slice(0, decimals).padEnd(decimals, "0");
  return (
    BigInt(wholePart || "0") * BigInt(10) ** BigInt(decimals) +
    BigInt(fraction || "0")
  );
}

function tokenAmountNumberToRaw(
  amount: number | null | undefined,
  decimals: number
): bigint | null {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return null;
  }

  if (amount < 0) {
    return null;
  }

  return parseTokenAmountLabelToRaw(amount.toFixed(decimals), decimals);
}

const DEFAULT_EARN_AUTODEPOSIT_AMOUNT_LABEL = "10,000";
const EARN_AUTODEPOSIT_CONFIG_CACHE_VERSION = 1;
const EARN_AUTODEPOSIT_CONFIG_CACHE_PREFIX = "loyal.earnAutodepositConfig.v1";
const EARN_AUTODEPOSIT_MIN_VISIBLE_SCHEDULED_SWEEP_RAW = BigInt(10_000);

function getEarnAutodepositConfigCacheKey(args: {
  settingsPda: string;
  solanaEnv: string;
  walletAddress: string;
}) {
  return `${EARN_AUTODEPOSIT_CONFIG_CACHE_PREFIX}:${args.solanaEnv}:${args.settingsPda}:${args.walletAddress}`;
}

function getEarnPolicyStableKey(
  policy: SmartAccountSidebarData["earnPolicy"]
): string {
  if (!policy) {
    return "no-earn-policy";
  }

  const listKey = (values: string[] | undefined) =>
    [...(values ?? [])].sort().join(",");

  return [
    policy.account,
    policy.seed,
    String(policy.vaultIndex),
    policy.vaultPubkey,
    policy.riskProfile ?? "",
    policy.universePreset ?? "",
    listKey(policy.delegatedSigners),
    listKey(policy.stableMints),
    listKey(policy.kaminoLiquidityMints),
    listKey(policy.kaminoMarkets),
    listKey(policy.routeModes),
    policy.setupPolicy?.account ?? "",
    policy.setupPolicy?.seed ?? "",
    listKey(policy.setupPolicy?.delegatedSigners),
  ].join("|");
}

function toCachedEarnAutodepositConfig(
  config: EarnAutodepositConfig | null
): LoadedEarnAutodepositConfig | null {
  if (!config) {
    return null;
  }

  if (
    config.state === "created" ||
    config.state === "creating" ||
    config.state === "paused"
  ) {
    return { ...config, state: config.state };
  }

  return null;
}

function formatAutodepositUsdLabel(value: string | null | undefined): string {
  const numeric = Number((value ?? "0").replace(/,/g, ""));
  const amount = Number.isFinite(numeric) ? numeric : 0;

  return `$${amount.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

function parseOptionalUnsignedBigInt(
  value: string | null | undefined
): bigint | undefined {
  return value && /^\d+$/.test(value) ? BigInt(value) : undefined;
}

function readCachedEarnAutodepositConfig(args: {
  settingsPda: string;
  solanaEnv: string;
  walletAddress: string;
}): LoadedEarnAutodepositConfig | null {
  return readClientCache<LoadedEarnAutodepositConfig>({
    key: getEarnAutodepositConfigCacheKey(args),
    version: EARN_AUTODEPOSIT_CONFIG_CACHE_VERSION,
    solanaEnv: args.solanaEnv,
    walletAddress: args.walletAddress,
    settingsPda: args.settingsPda,
    validate: isLoadedEarnAutodepositConfig,
  });
}

function writeCachedEarnAutodepositConfig(args: {
  config: LoadedEarnAutodepositConfig;
  settingsPda: string;
  solanaEnv: string;
  walletAddress: string;
}) {
  writeClientCache<LoadedEarnAutodepositConfig>({
    key: getEarnAutodepositConfigCacheKey(args),
    version: EARN_AUTODEPOSIT_CONFIG_CACHE_VERSION,
    solanaEnv: args.solanaEnv,
    walletAddress: args.walletAddress,
    settingsPda: args.settingsPda,
    data: args.config,
  });
}

function removeCachedEarnAutodepositConfig(args: {
  settingsPda: string;
  solanaEnv: string;
  walletAddress: string;
}) {
  removeClientCache({ key: getEarnAutodepositConfigCacheKey(args) });
}

function rawTokenAmountToNumber(amountRaw: string, decimals: number): number {
  if (!/^\d+$/.test(amountRaw)) {
    return 0;
  }

  const raw = BigInt(amountRaw);
  const scale = BigInt(10) ** BigInt(decimals);
  return Number(raw / scale) + Number(raw % scale) / 10 ** decimals;
}

function parseUnsignedRawTokenAmount(
  amountRaw: string | null | undefined
): bigint | null {
  if (!amountRaw || !/^\d+$/.test(amountRaw)) {
    return null;
  }

  return BigInt(amountRaw);
}

function getVisibleEarnAutodepositScheduledSweeps({
  scheduledSweeps,
  walletBalanceFloorRaw,
  walletBalanceRaw,
}: {
  scheduledSweeps: readonly LoadedEarnAutodepositScheduledSweep[];
  walletBalanceFloorRaw: bigint | null;
  walletBalanceRaw: bigint | null;
}): LoadedEarnAutodepositScheduledSweep[] {
  const sweepsAboveDisplayThreshold = scheduledSweeps.filter((sweep) => {
    const remainingAmountRaw = parseUnsignedRawTokenAmount(
      sweep.remainingAmountRaw
    );
    return (
      remainingAmountRaw !== null &&
      remainingAmountRaw >= EARN_AUTODEPOSIT_MIN_VISIBLE_SCHEDULED_SWEEP_RAW
    );
  });

  if (walletBalanceRaw === null || walletBalanceFloorRaw === null) {
    return sweepsAboveDisplayThreshold;
  }

  let remainingSurplusRaw = walletBalanceRaw - walletBalanceFloorRaw;
  if (remainingSurplusRaw < EARN_AUTODEPOSIT_MIN_VISIBLE_SCHEDULED_SWEEP_RAW) {
    return [];
  }

  const visibleSweeps: LoadedEarnAutodepositScheduledSweep[] = [];
  for (const sweep of sweepsAboveDisplayThreshold) {
    const remainingAmountRaw = parseUnsignedRawTokenAmount(
      sweep.remainingAmountRaw
    );
    if (remainingAmountRaw === null) {
      continue;
    }

    const displayAmountRaw =
      remainingAmountRaw < remainingSurplusRaw
        ? remainingAmountRaw
        : remainingSurplusRaw;
    remainingSurplusRaw -= displayAmountRaw;

    if (displayAmountRaw < EARN_AUTODEPOSIT_MIN_VISIBLE_SCHEDULED_SWEEP_RAW) {
      break;
    }

    visibleSweeps.push(
      displayAmountRaw === remainingAmountRaw
        ? sweep
        : { ...sweep, remainingAmountRaw: displayAmountRaw.toString() }
    );

    if (
      remainingSurplusRaw < EARN_AUTODEPOSIT_MIN_VISIBLE_SCHEDULED_SWEEP_RAW
    ) {
      break;
    }
  }

  return visibleSweeps;
}

function useMainAccountUsdcBalance(args: {
  connection: Connection;
  mint: string | null | undefined;
  walletAddress: string | null | undefined;
}): {
  amount: number | null;
  amountRaw: bigint | null;
  refresh: () => Promise<void>;
  setAmountRaw: Dispatch<SetStateAction<bigint | null>>;
} {
  const { connection, mint, walletAddress } = args;
  const [amountRaw, setAmountRaw] = useState<bigint | null>(null);

  const readAmountRaw = useCallback(async (): Promise<bigint | null> => {
    if (!walletAddress || !mint) {
      return null;
    }

    try {
      const owner = new PublicKey(walletAddress);
      const usdcMint = new PublicKey(mint);
      const usdcAta = getAssociatedTokenAddressSync(
        usdcMint,
        owner,
        false,
        TOKEN_PROGRAM_ID
      );

      const account = await connection.getAccountInfo(usdcAta, "confirmed");
      if (!account || !account.owner.equals(TOKEN_PROGRAM_ID)) {
        return BigInt(0);
      }

      const decoded = AccountLayout.decode(account.data);
      if (!decoded.mint.equals(usdcMint) || !decoded.owner.equals(owner)) {
        return BigInt(0);
      }

      return BigInt(decoded.amount.toString());
    } catch (error) {
      console.warn("[earn-deposit] failed to load wallet USDC ATA", error);
      return null;
    }
  }, [connection, mint, walletAddress]);

  const refresh = useCallback(async () => {
    setAmountRaw(await readAmountRaw());
  }, [readAmountRaw]);

  useEffect(() => {
    let cancelled = false;

    void readAmountRaw().then((nextAmountRaw) => {
      if (!cancelled) {
        setAmountRaw(nextAmountRaw);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [readAmountRaw]);

  return {
    amount: amountRaw === null ? null : Number(amountRaw) / 1_000_000,
    amountRaw,
    refresh,
    setAmountRaw,
  };
}

function hasEarnPositionObservedConfirmedSlot(
  position: ActiveEarnPosition,
  confirmedSlot: string | undefined
): boolean {
  if (!confirmedSlot) {
    return false;
  }

  try {
    return (
      BigInt(position.currentHolding.observedSlot) >= BigInt(confirmedSlot)
    );
  } catch {
    return false;
  }
}

function buildPostDepositEarnPosition(args: {
  amountRaw: bigint;
  confirmedSlot?: string;
  current: ActiveEarnPosition | null;
  preparedDeposit: SmartAccountPreparedEarnUsdcDeposit;
}): ActiveEarnPosition {
  const current = args.current;
  if (
    current &&
    hasEarnPositionObservedConfirmedSlot(current, args.confirmedSlot)
  ) {
    return current;
  }

  const amountRawString = args.amountRaw.toString();
  const currentTotalAmountRaw = (
    BigInt(current?.currentTotalAmountRaw ?? "0") + args.amountRaw
  ).toString();
  const principalAmountRaw = (
    BigInt(current?.principalAmountRaw ?? "0") + args.amountRaw
  ).toString();
  const liquidityMint =
    args.preparedDeposit.targetReserve.liquidityMint.toBase58();
  const market = args.preparedDeposit.targetReserve.market.toBase58();
  const reserve = args.preparedDeposit.targetReserve.reserve.toBase58();
  const display = resolveEarnPositionDisplay({ liquidityMint, market });
  const nowIso = new Date().toISOString();
  const observedSlot = args.confirmedSlot ?? "0";
  const supplyApyBps =
    args.preparedDeposit.targetReserve.supplyApyBps?.toString() ?? null;
  const depositedHolding: ActiveEarnPositionHolding = {
    amountRaw: amountRawString,
    kind: "kamino",
    label: display.label,
    liquidityMint,
    market,
    marketName: display.marketName,
    observedAt: nowIso,
    observedSlot,
    provenance: {
      source: "earn_deposit_confirmation",
      vaultUsdcAta: args.preparedDeposit.vault.usdcAta.toBase58(),
    },
    reserve,
    supplyApyBps,
  };
  const holdings = upsertPostDepositEarnHolding({
    amountRaw: args.amountRaw,
    currentHoldings: current?.holdings,
    depositedHolding,
  });
  const currentHoldingAmountRaw =
    holdings.find(
      (holding) => holding.kind === "kamino" && holding.reserve === reserve
    )?.amountRaw ?? amountRawString;

  return {
    currentHolding: {
      amountRaw: currentHoldingAmountRaw,
      liquidityMint,
      market,
      observedAt: nowIso,
      observedSlot,
      provenance: {
        lastHoldingEventId: null,
        lastRebalanceDecisionId: null,
      },
      reserve,
    },
    currentSupplyApyBps: current?.currentSupplyApyBps ?? supplyApyBps,
    display,
    initialHolding: current?.initialHolding ?? {
      liquidityMint,
      market,
      reserve,
      supplyApyBps,
    },
    holdings,
    currentTotalAmountRaw,
    principalAmountRaw,
    status: "active",
  };
}

function upsertPostDepositEarnHolding(args: {
  amountRaw: bigint;
  currentHoldings: ActiveEarnPositionHolding[] | undefined;
  depositedHolding: ActiveEarnPositionHolding;
}): ActiveEarnPositionHolding[] {
  const holdings = args.currentHoldings ?? [];
  const existingIndex = holdings.findIndex(
    (holding) =>
      holding.kind === "kamino" &&
      holding.reserve === args.depositedHolding.reserve
  );

  if (existingIndex === -1) {
    return [...holdings, args.depositedHolding];
  }

  return holdings.map((holding, index) => {
    if (index !== existingIndex) {
      return holding;
    }

    return {
      ...holding,
      amountRaw: (BigInt(holding.amountRaw) + args.amountRaw).toString(),
      observedAt: args.depositedHolding.observedAt,
      observedSlot: args.depositedHolding.observedSlot,
      supplyApyBps: holding.supplyApyBps ?? args.depositedHolding.supplyApyBps,
    };
  });
}

function buildVaultSendContext(args: {
  accountIndex: number;
  evaluateCapability: SmartAccountSidebarData["evaluateVaultTransferCapability"];
  executeTransfer: SmartAccountSidebarData["executeVaultTransfer"];
  tokenMint: string | undefined;
  tokenDecimals: number | undefined;
  onCreateDraft: (input: {
    request: VaultTransferRequest;
    capability: Extract<VaultTransferCapability, { kind: "settings" }>;
  }) => void;
}): SendContentVaultContext {
  if (!args.tokenMint) {
    return {
      mode: "blocked",
      reason: "Select a token held by the vault",
    };
  }
  if (typeof args.tokenDecimals !== "number") {
    return {
      mode: "blocked",
      reason: "Token metadata still loading — try again in a moment",
    };
  }
  // Smallest non-zero raw amount for capability check (1 unit). Real amount
  // is checked again inside executeVaultTransfer; this is enough to detect
  // role / authorization issues up-front.
  const probeAmount = BigInt(1);
  const capability = args.evaluateCapability({
    accountIndex: args.accountIndex,
    mint: args.tokenMint,
    amountRaw: probeAmount,
  });
  if (capability.kind === "blocked") {
    return { mode: "blocked", reason: capability.reason };
  }
  const notice =
    capability.kind === "settings"
      ? "Submitting will create a draft proposal you can review in Approvals before signing."
      : "Sending via spending limit — single wallet sign.";
  const mint = args.tokenMint;
  const decimals = args.tokenDecimals;
  return {
    mode: "ready",
    notice,
    execute: async (request) => {
      // Re-evaluate capability with the user's actual recipient + amount so
      // we route multisig (settings) sends to the draft preview path.
      const amountRaw = BigInt(
        Math.max(0, Math.floor(request.amount * Math.pow(10, decimals)))
      );
      const liveCapability = args.evaluateCapability({
        accountIndex: args.accountIndex,
        mint,
        amountRaw: amountRaw > BigInt(0) ? amountRaw : BigInt(1),
        recipientAddress: request.recipientAddress,
      });
      if (liveCapability.kind === "settings") {
        args.onCreateDraft({
          request: {
            accountIndex: args.accountIndex,
            mint,
            symbol: request.symbol,
            amount: request.amount,
            recipientAddress: request.recipientAddress,
          },
          capability: liveCapability,
        });
        return { success: true, status: "draft" };
      }
      return args.executeTransfer({
        accountIndex: args.accountIndex,
        mint,
        symbol: request.symbol,
        amount: request.amount,
        recipientAddress: request.recipientAddress,
      });
    },
  };
}

function WalletWorkspaceLogout({
  isSignedIn,
  mobilePane,
  onDisconnect,
}: {
  isSignedIn: boolean;
  mobilePane: MobilePane;
  onDisconnect: () => void;
}) {
  return (
    <button
      aria-disabled={!isSignedIn}
      aria-label="Disconnect wallet"
      className="wallet-workspace-logout"
      data-disabled={!isSignedIn}
      data-mobile-pane={mobilePane}
      disabled={!isSignedIn}
      onClick={onDisconnect}
      title={isSignedIn ? "Disconnect wallet" : "Connect a wallet first"}
      type="button"
    >
      <LogOut size={20} strokeWidth={1.8} />
    </button>
  );
}

function MobileWorkspaceHeader({
  canOpenActivity,
  onBack,
  onOpenActivity,
  pane,
  title,
}: {
  canOpenActivity: boolean;
  onBack: () => void;
  onOpenActivity: () => void;
  pane: Exclude<MobilePane, "accounts">;
  title: string;
}) {
  return (
    <div className="wallet-workspace-mobile-header">
      <button
        aria-label={pane === "activity" ? "Back to detail" : "Back to accounts"}
        className="wallet-workspace-mobile-icon-button"
        onClick={onBack}
        type="button"
      >
        <ChevronLeft size={24} strokeWidth={1.9} />
      </button>
      <div className="wallet-workspace-mobile-title">{title}</div>
      {canOpenActivity ? (
        <button
          aria-label="Open transactions"
          className="wallet-workspace-mobile-action-button"
          onClick={onOpenActivity}
          type="button"
        >
          <ReceiptText size={17} strokeWidth={1.9} />
          <span>Transactions</span>
        </button>
      ) : (
        <span aria-hidden="true" className="wallet-workspace-mobile-spacer" />
      )}
    </div>
  );
}

function WorkspaceDetailSkeleton() {
  return (
    <div
      className="wallet-workspace-loading-detail"
      aria-label="Loading wallet"
    >
      <div className="wallet-workspace-loading-hero">
        <div className="wallet-workspace-skeleton-avatar" />
        <div className="wallet-workspace-loading-hero-copy">
          <div className="wallet-workspace-skeleton-line wallet-workspace-skeleton-line-title" />
          <div className="wallet-workspace-skeleton-line wallet-workspace-skeleton-line-short" />
        </div>
      </div>

      <div className="wallet-workspace-skeleton-balance" />

      <div className="wallet-workspace-loading-actions">
        <div className="wallet-workspace-skeleton-pill" />
        <div className="wallet-workspace-skeleton-pill wallet-workspace-skeleton-pill-active" />
        <div className="wallet-workspace-skeleton-pill" />
        <div className="wallet-workspace-skeleton-pill" />
      </div>

      <div className="wallet-workspace-loading-tabs">
        <div className="wallet-workspace-skeleton-line wallet-workspace-skeleton-line-tab" />
        <div className="wallet-workspace-skeleton-line wallet-workspace-skeleton-line-tab-muted" />
      </div>

      <div className="wallet-workspace-loading-token-list">
        {Array.from({ length: 4 }).map((_, index) => (
          <div className="wallet-workspace-loading-token-row" key={index}>
            <div className="wallet-workspace-skeleton-token" />
            <div className="wallet-workspace-loading-token-copy">
              <div className="wallet-workspace-skeleton-line wallet-workspace-skeleton-line-token" />
              <div className="wallet-workspace-skeleton-line wallet-workspace-skeleton-line-price" />
            </div>
            <div className="wallet-workspace-loading-token-values">
              <div className="wallet-workspace-skeleton-line wallet-workspace-skeleton-line-amount" />
              <div className="wallet-workspace-skeleton-line wallet-workspace-skeleton-line-value" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkspaceApprovalsSkeleton() {
  return (
    <div
      className="wallet-workspace-loading-approvals"
      aria-label="Loading approvals"
    >
      <div className="wallet-workspace-skeleton-line wallet-workspace-skeleton-line-approvals-title" />
      <div className="wallet-workspace-loading-approval-card">
        <div className="wallet-workspace-skeleton-approval-icon" />
        <div className="wallet-workspace-skeleton-line wallet-workspace-skeleton-line-approval-main" />
        <div className="wallet-workspace-skeleton-line wallet-workspace-skeleton-line-approval-sub" />
      </div>
    </div>
  );
}

function getWorkspaceErrorCopy(error: string | null) {
  const isRateLimited = isRateLimitedSmartAccountError(error);

  return {
    body: isRateLimited
      ? "The RPC provider is temporarily rate limiting smart-account reads. Your wallet connection is still active; wait a moment and retry."
      : "We could not load smart-account data. Try again in a moment.",
    title: isRateLimited ? "Network limit reached" : "Could not load accounts",
  };
}

function isRateLimitedSmartAccountError(error: string | null | undefined) {
  return error?.toLowerCase().includes("rate limited") ?? false;
}

function WorkspaceErrorPane({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  const copy = getWorkspaceErrorCopy(error);

  return (
    <div className="wallet-workspace-error-pane">
      <div className="wallet-workspace-error-card">
        <span className="wallet-workspace-error-icon">
          <RefreshCw size={28} strokeWidth={1.8} />
        </span>
        <div>
          <p className="wallet-workspace-error-title">{copy.title}</p>
          <p className="wallet-workspace-error-copy">{copy.body}</p>
        </div>
        <button onClick={onRetry} type="button">
          Retry
        </button>
      </div>
    </div>
  );
}

function getShieldedBalancesUnlockErrorMessage(error: unknown): string {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
      ? error
      : "";
  const lowerMessage = rawMessage.toLowerCase();

  if (
    lowerMessage.includes("reject") ||
    lowerMessage.includes("denied") ||
    lowerMessage.includes("declined") ||
    lowerMessage.includes("cancel")
  ) {
    return "Signature rejected. Shielded balances stay hidden until you approve the wallet message.";
  }

  if (lowerMessage.includes("signmessage")) {
    return "This wallet cannot sign the message required to show shielded balances.";
  }

  return "Could not unlock shielded balances. Try signing again.";
}

async function parseEarnAutodepositExecuteError(response: Response) {
  const payload = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;

  return (
    payload?.error?.message ??
    "Failed to request immediate Autodeposit execution."
  );
}

type EarnDepositPolicyStageSignatures = {
  policyConfirmedSlot?: string;
  policySignature?: string;
  setupPolicyConfirmedSlot?: string;
  setupPolicySignature?: string;
};

function resolveEarnAutodepositSetupReviewStage(
  preparedSetup: SmartAccountPreparedEarnUsdcAutodepositSetup | null
): EarnAutodepositSetupReviewStage {
  if (preparedSetup?.stage === "create_recurring_delegation") {
    return "delegation";
  }
  if (preparedSetup?.stage === "initialize_subscription_authority") {
    return "authority";
  }
  return "policy";
}

function parseEarnWithdrawPublicKey(
  value: string | null | undefined,
  label: string
): PublicKey {
  if (!value) {
    throw new Error(`Selected Earn source is missing ${label}.`);
  }

  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`Selected Earn source has an invalid ${label}.`);
  }
}

function parseEarnWithdrawAmountRaw(value: string, label: string): bigint {
  try {
    const amountRaw = BigInt(value);
    if (amountRaw < BigInt(0)) {
      throw new Error("negative amount");
    }
    return amountRaw;
  } catch {
    throw new Error(`Selected Earn source has an invalid ${label}.`);
  }
}

function toEarnWithdrawVaultsSource(
  source: EarnWithdrawSourceOption
): EarnWithdrawVaultsSource {
  const amountRaw = parseEarnWithdrawAmountRaw(source.amountRaw, "amount");
  const sourceId =
    source.sourceId ||
    source.reserve ||
    source.tokenAccount ||
    source.liquidityMint;

  if (!sourceId) {
    throw new Error("Selected Earn source is missing an identifier.");
  }

  if (source.type === "idle") {
    return {
      amountRaw,
      id: sourceId,
      mint: parseEarnWithdrawPublicKey(source.liquidityMint, "mint"),
      tokenAccount: parseEarnWithdrawPublicKey(
        source.tokenAccount,
        "token account"
      ),
      type: "idle",
    };
  }

  return {
    amountRaw,
    id: sourceId,
    liquidityMint: parseEarnWithdrawPublicKey(
      source.liquidityMint,
      "liquidity mint"
    ),
    market: parseEarnWithdrawPublicKey(source.market, "Kamino market"),
    reserve: parseEarnWithdrawPublicKey(source.reserve, "Kamino reserve"),
    type: "reserve",
  };
}

function toEarnWithdrawReserveTarget(
  source: EarnWithdrawSourceOption
): EarnWithdrawFullWithdrawalTarget {
  if (source.type !== "reserve") {
    throw new Error("Selected Earn source is not a Kamino reserve.");
  }

  const vaultCollateralAta = source.tokenAccount
    ? parseEarnWithdrawPublicKey(source.tokenAccount, "collateral account")
    : null;

  return {
    amountRaw: parseEarnWithdrawAmountRaw(source.amountRaw, "amount"),
    liquidityMint: parseEarnWithdrawPublicKey(
      source.liquidityMint,
      "liquidity mint"
    ),
    market: parseEarnWithdrawPublicKey(source.market, "Kamino market"),
    reserve: parseEarnWithdrawPublicKey(source.reserve, "Kamino reserve"),
    ...(source.supplyApyBps
      ? { supplyApyBps: parseEarnWithdrawAmountRaw(source.supplyApyBps, "APY") }
      : {}),
    ...(vaultCollateralAta ? { vaultCollateralAta } : {}),
  };
}

type EarnDepositTargetCandidate = {
  amountRaw: string;
  liquidityMint: string;
  market: string | null;
  reserve: string | null;
  supplyApyBps?: string | null;
};

function parseEarnDepositTargetPublicKey(
  value: string | null | undefined,
  label: string
): PublicKey | null {
  if (!value) {
    return null;
  }

  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`Active Earn position has an invalid ${label}.`);
  }
}

function parseOptionalEarnDepositTargetAmountRaw(
  value: string | null | undefined
): bigint | null {
  if (!value) {
    return null;
  }

  try {
    const amountRaw = BigInt(value);
    return amountRaw > BigInt(0) ? amountRaw : null;
  } catch {
    return null;
  }
}

function toEarnDepositReserveTarget(
  candidate: EarnDepositTargetCandidate
): SmartAccountEarnUsdcReserveTargetInput | null {
  if (!parseOptionalEarnDepositTargetAmountRaw(candidate.amountRaw)) {
    return null;
  }

  const market = parseEarnDepositTargetPublicKey(
    candidate.market,
    "Kamino market"
  );
  const reserve = parseEarnDepositTargetPublicKey(
    candidate.reserve,
    "Kamino reserve"
  );

  if (!market || !reserve) {
    return null;
  }

  const liquidityMint = parseEarnDepositTargetPublicKey(
    candidate.liquidityMint,
    "liquidity mint"
  );

  if (!liquidityMint) {
    throw new Error("Active Earn position is missing its liquidity mint.");
  }

  return {
    liquidityMint,
    market,
    reserve,
    supplyApyBps: parseOptionalEarnDepositTargetAmountRaw(
      candidate.supplyApyBps
    ),
  };
}

function resolveActiveEarnDepositTarget(
  position: ActiveEarnPosition | null
): SmartAccountEarnUsdcReserveTargetInput | null {
  if (!position) {
    return null;
  }

  const currentTarget = toEarnDepositReserveTarget({
    amountRaw: position.currentHolding.amountRaw,
    liquidityMint: position.currentHolding.liquidityMint,
    market: position.currentHolding.market,
    reserve: position.currentHolding.reserve,
    supplyApyBps: position.currentSupplyApyBps,
  });
  if (currentTarget) {
    return currentTarget;
  }

  const positiveKaminoHolding = position.holdings?.find(
    (holding) =>
      holding.kind === "kamino" &&
      Boolean(
        parseOptionalEarnDepositTargetAmountRaw(holding.amountRaw) &&
          holding.market &&
          holding.reserve
      )
  );

  return positiveKaminoHolding
    ? toEarnDepositReserveTarget(positiveKaminoHolding)
    : null;
}

function getEarnPositionTotalAmountRaw(
  position: ActiveEarnPosition | null
): bigint {
  const holdings = position?.holdings ?? [];
  if (holdings.length > 0) {
    return holdings.reduce((total, holding) => {
      try {
        return total + BigInt(holding.amountRaw);
      } catch {
        return total;
      }
    }, BigInt(0));
  }

  try {
    return BigInt(position?.currentTotalAmountRaw ?? "0");
  } catch {
    return BigInt(0);
  }
}

function earnHoldingMatchesWithdrawSource(
  holding: ActiveEarnPositionHolding,
  source: EarnWithdrawSourceOption
): boolean {
  if (source.type === "idle") {
    const tokenAccount =
      typeof holding.provenance.tokenAccount === "string"
        ? holding.provenance.tokenAccount
        : null;
    return (
      holding.kind === "idle" &&
      (tokenAccount === source.tokenAccount ||
        holding.liquidityMint === source.liquidityMint)
    );
  }

  return (
    holding.kind === "kamino" &&
    holding.reserve === source.reserve &&
    holding.market === source.market &&
    holding.liquidityMint === source.liquidityMint
  );
}

function applySubmittedEarnWithdrawToPosition(args: {
  amountRaw: bigint;
  current: ActiveEarnPosition | null;
  draft: EarnWithdrawDraft;
}): ActiveEarnPosition | null {
  const { amountRaw, current, draft } = args;
  if (!current) {
    return current;
  }

  const currentHoldings = current.holdings ?? [];
  if (currentHoldings.length === 0) {
    const currentTotalAmountRaw = BigInt(current.currentTotalAmountRaw);
    const nextCurrentTotal =
      currentTotalAmountRaw > amountRaw
        ? currentTotalAmountRaw - amountRaw
        : BigInt(0);
    const currentPrincipal = BigInt(current.principalAmountRaw);
    const nextPrincipal =
      draft.source.type === "idle"
        ? nextCurrentTotal > BigInt(0)
          ? currentPrincipal
          : BigInt(0)
        : currentPrincipal > amountRaw
        ? currentPrincipal - amountRaw
        : BigInt(0);

    return nextCurrentTotal > BigInt(0)
      ? {
          ...current,
          currentHolding: {
            ...current.currentHolding,
            amountRaw: nextCurrentTotal.toString(),
          },
          currentTotalAmountRaw: nextCurrentTotal.toString(),
          principalAmountRaw: nextPrincipal.toString(),
          status: "active",
        }
      : null;
  }

  let remainingWithdrawalRaw =
    draft.mode === "full"
      ? parseEarnWithdrawAmountRaw(draft.source.amountRaw, "amount")
      : amountRaw;
  const nextHoldings = currentHoldings.flatMap((holding) => {
    if (!earnHoldingMatchesWithdrawSource(holding, draft.source)) {
      return [holding];
    }

    const holdingAmountRaw = BigInt(holding.amountRaw);
    const sourceWithdrawalRaw =
      remainingWithdrawalRaw > holdingAmountRaw
        ? holdingAmountRaw
        : remainingWithdrawalRaw;
    remainingWithdrawalRaw -= sourceWithdrawalRaw;
    const nextHoldingAmountRaw = holdingAmountRaw - sourceWithdrawalRaw;

    return nextHoldingAmountRaw > BigInt(0)
      ? [{ ...holding, amountRaw: nextHoldingAmountRaw.toString() }]
      : [];
  });
  const nextCurrentTotal = nextHoldings.reduce(
    (total, holding) => total + BigInt(holding.amountRaw),
    BigInt(0)
  );
  if (nextCurrentTotal <= BigInt(0)) {
    return null;
  }

  const nextPrimaryHolding =
    nextHoldings.find((holding) => holding.kind === "kamino") ??
    nextHoldings[0];
  const currentPrincipal = BigInt(current.principalAmountRaw);
  const nextPrincipal =
    draft.source.type === "idle"
      ? currentPrincipal
      : currentPrincipal > amountRaw
      ? currentPrincipal - amountRaw
      : BigInt(0);

  return {
    ...current,
    currentHolding: nextPrimaryHolding
      ? {
          amountRaw: nextPrimaryHolding.amountRaw,
          liquidityMint: nextPrimaryHolding.liquidityMint,
          market: nextPrimaryHolding.market,
          observedAt: nextPrimaryHolding.observedAt,
          observedSlot: nextPrimaryHolding.observedSlot,
          provenance: current.currentHolding.provenance,
          reserve: nextPrimaryHolding.reserve ?? "",
        }
      : current.currentHolding,
    currentTotalAmountRaw: nextCurrentTotal.toString(),
    display: nextPrimaryHolding
      ? {
          label: nextPrimaryHolding.label,
          marketName: nextPrimaryHolding.marketName,
          mintSymbol: "USDC",
        }
      : current.display,
    holdings: nextHoldings,
    principalAmountRaw: nextPrincipal.toString(),
    status: "active",
  };
}

export function AppWalletWorkspace({
  initialSection = "wallet",
}: {
  initialSection?: WorkspaceSection;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const publicEnv = usePublicEnv();
  const { connection } = useConnection();
  const wallet = useWallet();
  const { disconnect } = wallet;
  const { logout, user } = useAuthSession();
  const { isHydrated: isAuthHydrated, isSignedIn } = useAuthCapability();
  const { open: openSignIn, close: closeSignIn } = useSignInModal();
  const hasSmartAccountSession =
    isSignedIn && Boolean(user?.smartAccountAddress && user?.settingsPda);
  const appAccessMode = hasSmartAccountSession ? "loggedIn" : "anonymous";
  const canLoadPersonalAccount = appAccessMode === "loggedIn";
  const canMutateAccount = appAccessMode === "loggedIn";
  const connectedWalletAddress = wallet.publicKey?.toBase58() ?? null;
  const [shouldLoadMainAccountPortfolio, setShouldLoadMainAccountPortfolio] =
    useState(false);
  const [shieldedBalancesUnlockedForKey, setShieldedBalancesUnlockedForKey] =
    useState<string | null>(null);
  const shieldedBalancesUnlockKey = connectedWalletAddress
    ? `${connectedWalletAddress}:${publicEnv.solanaEnv}`
    : null;
  const hasUnlockedShieldedBalances =
    shieldedBalancesUnlockKey !== null &&
    shieldedBalancesUnlockedForKey === shieldedBalancesUnlockKey;
  const walletDesktopData = useWalletDesktopData({
    enabled:
      canLoadPersonalAccount &&
      (shouldLoadMainAccountPortfolio || hasUnlockedShieldedBalances),
    includeSecureBalances: hasUnlockedShieldedBalances,
  });
  const personalWalletPositions = useMemo<PortfolioPosition[]>(
    () => (canLoadPersonalAccount ? walletDesktopData.positions : []),
    [canLoadPersonalAccount, walletDesktopData.positions]
  );
  const personalWalletAllTokenRows = useMemo<
    typeof walletDesktopData.allTokenRows
  >(
    () => (canLoadPersonalAccount ? walletDesktopData.allTokenRows : []),
    [canLoadPersonalAccount, walletDesktopData.allTokenRows]
  );
  const personalWalletAddress = canLoadPersonalAccount
    ? walletDesktopData.walletAddress
    : null;
  const trackedKaminoUsdcMint = useMemo(
    () => resolveTrackedKaminoUsdcMint(publicEnv.solanaEnv),
    [publicEnv.solanaEnv]
  );
  const mainAccountUsdcBalance = useMainAccountUsdcBalance({
    connection,
    mint: trackedKaminoUsdcMint,
    walletAddress: personalWalletAddress,
  });
  const setMainAccountUsdcAmountRaw = mainAccountUsdcBalance.setAmountRaw;
  const debitMainAccountUsdcBalance = useCallback(
    (amountRaw: bigint) => {
      setMainAccountUsdcAmountRaw((current) => {
        if (current === null) {
          return current;
        }

        return current > amountRaw ? current - amountRaw : BigInt(0);
      });
    },
    [setMainAccountUsdcAmountRaw]
  );
  const creditMainAccountUsdcBalance = useCallback(
    (amountRaw: bigint) => {
      setMainAccountUsdcAmountRaw((current) =>
        current === null ? current : current + amountRaw
      );
    },
    [setMainAccountUsdcAmountRaw]
  );
  const refreshWalletPortfolio = walletDesktopData.refresh;
  const refreshMainAccountUsdc = mainAccountUsdcBalance.refresh;
  const refreshMainAccountBalances = useCallback(async () => {
    await Promise.all([refreshWalletPortfolio(), refreshMainAccountUsdc()]);
  }, [refreshMainAccountUsdc, refreshWalletPortfolio]);
  const stablecoinMints = useMemo(
    () => getStablecoinMintSetForSolanaEnv(publicEnv.solanaEnv),
    [publicEnv.solanaEnv]
  );
  const mainAccountStablecoinUsd = useMemo(() => {
    const portfolioStablecoinUsd = sumPublicStablecoinUsd(
      personalWalletPositions,
      stablecoinMints
    );

    if (mainAccountUsdcBalance.amount === null) {
      return portfolioStablecoinUsd;
    }

    const trackedUsdcPosition = findEarnUsdcPosition(
      personalWalletPositions,
      trackedKaminoUsdcMint
    );
    const trackedUsdcPriceUsd =
      typeof trackedUsdcPosition?.priceUsd === "number" &&
      Number.isFinite(trackedUsdcPosition.priceUsd)
        ? trackedUsdcPosition.priceUsd
        : 1;
    const trackedUsdcPortfolioUsd =
      trackedUsdcPosition && stablecoinMints.has(trackedUsdcPosition.asset.mint)
        ? getPublicPositionUsd(trackedUsdcPosition)
        : 0;

    return (
      portfolioStablecoinUsd -
      trackedUsdcPortfolioUsd +
      mainAccountUsdcBalance.amount * trackedUsdcPriceUsd
    );
  }, [
    mainAccountUsdcBalance.amount,
    personalWalletPositions,
    stablecoinMints,
    trackedKaminoUsdcMint,
  ]);
  const mainAccountDisplayUsd = canLoadPersonalAccount
    ? mainAccountStablecoinUsd
    : 0;
  const mainAccountDisplayBalance = useMemo(
    () => splitUsdBalance(mainAccountDisplayUsd),
    [mainAccountDisplayUsd]
  );
  const smartAccountData = useSmartAccountSidebarData({
    authenticatedUserCashUsd: mainAccountDisplayUsd,
    authenticatedUserTotalUsd: mainAccountDisplayUsd,
    onAfterTx: refreshMainAccountBalances,
  });
  const activeEarnPolicyRef = useRef<{
    key: string;
    policy: SmartAccountSidebarData["earnPolicy"];
  }>({ key: "uninitialized", policy: null });
  const activeEarnPolicyKey = getEarnPolicyStableKey(
    smartAccountData.earnPolicy
  );
  if (activeEarnPolicyRef.current.key !== activeEarnPolicyKey) {
    activeEarnPolicyRef.current = {
      key: activeEarnPolicyKey,
      policy: smartAccountData.earnPolicy,
    };
  }
  const activeEarnPolicy = activeEarnPolicyRef.current.policy;
  const {
    hasResolved: hasActiveEarnPositionResolved,
    isLoading: isActiveEarnPositionLoading,
    position: activeEarnPosition,
    refresh: refreshActiveEarnPosition,
    setPosition: setActiveEarnPosition,
    suppressSubscriptionRefreshThroughSlot:
      suppressEarnSubscriptionRefreshThroughSlot,
  } = useActiveEarnPosition({
    connection,
    earnPolicy: activeEarnPolicy,
    enabled: isAuthHydrated && canLoadPersonalAccount,
    programId: smartAccountData.overview?.programId,
    settingsPda: smartAccountData.overview?.settingsPda,
    solanaEnv: publicEnv.solanaEnv,
    walletAddress: personalWalletAddress,
  });
  const [earnTransactionsRefreshKey, setEarnTransactionsRefreshKey] =
    useState(0);
  const invalidateEarnClientCaches = useCallback(() => {
    invalidateEarnEarningsCache();
    invalidateEarnTransactionsCache({
      settingsPda: smartAccountData.overview?.settingsPda,
      solanaEnv: publicEnv.solanaEnv,
      walletAddress: personalWalletAddress ?? undefined,
    });
    setEarnTransactionsRefreshKey((value) => value + 1);
  }, [
    publicEnv.solanaEnv,
    smartAccountData.overview?.settingsPda,
    personalWalletAddress,
  ]);
  const signInOpenedForConnectRef = useRef(false);
  const [isExperimentalMode, setIsExperimentalMode] = useState(false);
  const [shouldLoadPopularTokens, setShouldLoadPopularTokens] = useState(false);
  const { tokens: popularTokens, search: searchTokens } = usePopularTokens({
    enabled: shouldLoadPopularTokens,
  });
  const routeSection: WorkspaceSection =
    pathname === "/app/policies"
      ? "policies"
      : pathname === "/app/settings"
      ? "settings"
      : initialSection;
  const [activeSection, setActiveSection] =
    useState<WorkspaceSection>(routeSection);
  const isMockBackupSignerFlowEnabled =
    ENABLE_MOCK_BACKUP_SIGNER_FLOW && isExperimentalMode;

  useEffect(() => {
    setIsExperimentalMode(
      window.sessionStorage.getItem(EXPERIMENTAL_MODE_SESSION_KEY) === "1"
    );
  }, []);

  const toggleExperimentalMode = useCallback(() => {
    setIsExperimentalMode((current) => {
      const next = !current;
      try {
        if (next) {
          window.sessionStorage.setItem(EXPERIMENTAL_MODE_SESSION_KEY, "1");
        } else {
          window.sessionStorage.removeItem(EXPERIMENTAL_MODE_SESSION_KEY);
        }
      } catch (error) {
        console.warn(
          "[wallet-workspace] failed to persist experimental mode",
          error
        );
      }
      return next;
    });
  }, []);

  const [isBalanceHidden, setIsBalanceHidden] = useState(false);
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const [selectedPolicyId, setSelectedPolicyIdState] =
    useState("autoswap-primary");
  const [policyView, setPolicyView] = useState<"details" | "builder">(
    "details"
  );
  const setSelectedPolicyId = (id: string) => {
    setSelectedPolicyIdState(id);
    setPolicyView("details");
  };
  const [selectedDetail, setSelectedDetail] =
    useState<string>("Wallet overview");
  const [mobilePane, setMobilePane] = useState<MobilePane>("accounts");
  const [isMobileWorkspaceViewport, setIsMobileWorkspaceViewport] =
    useState(false);
  const mobilePaneHistoryArmedRef = useRef(false);
  const hasRestoredSelectionRef = useRef(false);
  const hasLocalDetailSelectionRef = useRef(false);
  const skipNextWorkspaceSelectionPersistRef = useRef(false);
  // Gates the detail pane: stays false until the persisted workspace selection
  // has been restored, so the pane never paints the default selection before
  // the user's actual pane on load (avoids an Earn/Stash flash on refresh).
  const [isSelectionRestored, setIsSelectionRestored] = useState(false);
  const [detailSelection, setDetailSelectionState] =
    useState<DetailSelection>("earn");
  const setDetailSelection = useCallback(
    (selection: SetStateAction<DetailSelection>) => {
      if (!hasRestoredSelectionRef.current) {
        hasLocalDetailSelectionRef.current = true;
      }

      setDetailSelectionState(selection);
    },
    []
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      setIsMobileWorkspaceViewport(false);
      return;
    }

    const mediaQuery = window.matchMedia(MOBILE_WORKSPACE_MEDIA_QUERY);
    const syncMobileWorkspaceViewport = () => {
      setIsMobileWorkspaceViewport(mediaQuery.matches);
    };

    syncMobileWorkspaceViewport();
    mediaQuery.addEventListener("change", syncMobileWorkspaceViewport);

    return () => {
      mediaQuery.removeEventListener("change", syncMobileWorkspaceViewport);
    };
  }, []);

  const [detailInitialTab, setDetailInitialTab] = useState<DetailTab>("tokens");
  const [detailPaneTransition, setDetailPaneTransition] =
    useState<DetailPaneTransition>("switch");
  const [detailPaneTransitionKey, setDetailPaneTransitionKey] = useState(0);
  const [actionReturnSelection, setActionReturnSelection] =
    useState<Exclude<DetailSelection, "action">>("vault");
  const [viewStack, setViewStack] = useState<Exclude<SubView, null>[]>([]);
  const [swapMode, setSwapMode] = useState<SwapMode>("swap");
  const [swapFormActive, setSwapFormActive] = useState(true);
  const [shieldFormActive, setShieldFormActive] = useState(true);
  const [swapButtonProps, setSwapButtonProps] =
    useState<FormButtonProps | null>(null);
  const [shieldButtonProps, setShieldButtonProps] =
    useState<FormButtonProps | null>(null);
  const [isShieldedBalancesUnlocking, setIsShieldedBalancesUnlocking] =
    useState(false);
  const [shieldedBalancesUnlockError, setShieldedBalancesUnlockError] =
    useState<string | null>(null);
  const [
    isShieldedBalancesUnlockReviewOpen,
    setIsShieldedBalancesUnlockReviewOpen,
  ] = useState(false);
  const [sendToken, setSendToken] = useState<SwapToken>(fallbackSwapTokens[0]);
  const [swapFromToken, setSwapFromToken] = useState<SwapToken>(
    fallbackSwapTokens[0]
  );
  const [swapToToken, setSwapToToken] = useState<SwapToken>(LOYL_TOKEN);
  const [shieldToken, setShieldToken] = useState<SwapToken>(
    fallbackSwapTokens[0]
  );
  const [shieldDirection, setShieldDirection] = useState<"shield" | "unshield">(
    "shield"
  );
  const [sendInitialRecipient, setSendInitialRecipient] = useState("");
  const [selectedSignerId, setSelectedSignerId] = useState<string | null>(null);
  const [selectedApprovalId, setSelectedApprovalId] = useState<string | null>(
    null
  );

  useEffect(() => {
    setShouldLoadMainAccountPortfolio(
      detailSelection === "wallet" ||
        (detailSelection === "action" && actionReturnSelection === "wallet")
    );
  }, [actionReturnSelection, detailSelection]);

  useEffect(() => {
    setShieldedBalancesUnlockedForKey((current) =>
      current === shieldedBalancesUnlockKey ? current : null
    );
    setShieldedBalancesUnlockError(null);
    setIsShieldedBalancesUnlocking(false);
    setIsShieldedBalancesUnlockReviewOpen(false);
  }, [shieldedBalancesUnlockKey]);

  const [accountPaneWidth, setAccountPaneWidth] = useState(
    ACCOUNT_PANE_DEFAULT_WIDTH
  );
  const [reviewPaneWidth, setReviewPaneWidth] = useState(
    REVIEW_PANE_DEFAULT_WIDTH
  );
  const [connectAgentAddress, setConnectAgentAddress] = useState<string | null>(
    null
  );
  const [pendingOpenSignerAddress, setPendingOpenSignerAddress] = useState<
    string | null
  >(null);
  const [pendingRootSignerDraft, setPendingRootSignerDraft] =
    useState<PendingRootSignerDraft | null>(null);
  const [pendingRootSignerRemovalDraft, setPendingRootSignerRemovalDraft] =
    useState<PendingRootSignerRemovalDraft | null>(null);
  const [mockRootSigners, setMockRootSigners] = useState<MockRootSignerEntry[]>(
    []
  );
  useEffect(() => {
    if (isMockBackupSignerFlowEnabled) {
      return;
    }

    setPendingRootSignerDraft(null);
    setPendingRootSignerRemovalDraft(null);
    if (selectedSignerId?.startsWith("mock-root-signer:")) {
      setSelectedSignerId(null);
      setDetailSelectionState("wallet");
      setSelectedDetail("My Wallet");
    }
  }, [isMockBackupSignerFlowEnabled, selectedSignerId]);
  const [draftProposal, setDraftProposal] = useState<DraftProposalView | null>(
    null
  );
  const [isDraftSubmitting, setIsDraftSubmitting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [permissionDraft, setPermissionDraft] =
    useState<PermissionChangeDraft | null>(null);
  const [isPermissionDraftSubmitting, setIsPermissionDraftSubmitting] =
    useState(false);
  const [permissionDraftError, setPermissionDraftError] = useState<
    string | null
  >(null);
  const [spendingLimitDraft, setSpendingLimitDraft] =
    useState<SpendingLimitDraft | null>(null);
  const [pendingEarnDepositDraft, setPendingEarnDepositDraft] =
    useState<EarnDepositDraft | null>(null);
  const [pendingEarnDepositPrepared, setPendingEarnDepositPrepared] =
    useState<SmartAccountPreparedEarnUsdcDeposit | null>(null);
  const [isEarnDepositPreparePending, setIsEarnDepositPreparePending] =
    useState(false);
  const [earnDepositPrepareError, setEarnDepositPrepareError] = useState<
    string | null
  >(null);
  const [earnDepositReviewStage, setEarnDepositReviewStage] =
    useState<EarnDepositReviewStage>("deposit");
  const [isEarnDepositPolicySetupFlow, setIsEarnDepositPolicySetupFlow] =
    useState(false);
  const [
    earnDepositPolicyStageSignatures,
    setEarnDepositPolicyStageSignatures,
  ] = useState<EarnDepositPolicyStageSignatures>({});
  const [pendingEarnWithdrawDraft, setPendingEarnWithdrawDraft] =
    useState<EarnWithdrawDraft | null>(null);
  const [pendingEarnWithdrawPrepared, setPendingEarnWithdrawPrepared] =
    useState<SmartAccountPreparedEarnUsdcWithdraw | null>(null);
  const [pendingEarnCleanupPrepared, setPendingEarnCleanupPrepared] =
    useState<PreparedEarnUsdcCleanup | null>(null);
  const [isEarnWithdrawPreparePending, setIsEarnWithdrawPreparePending] =
    useState(false);
  const [earnWithdrawReviewStage, setEarnWithdrawReviewStage] =
    useState<EarnWithdrawReviewStage>("withdraw-0");
  const [pendingEarnAutodepositDraft, setPendingEarnAutodepositDraft] =
    useState<EarnAutodepositDraft | null>(null);
  const [
    pendingEarnAutodepositSetupPrepared,
    setPendingEarnAutodepositSetupPrepared,
  ] = useState<SmartAccountPreparedEarnUsdcAutodepositSetup | null>(null);
  const [earnAutodepositSetupReviewStage, setEarnAutodepositSetupReviewStage] =
    useState<EarnAutodepositSetupReviewStage>("policy");
  const [
    pendingEarnAutodepositClosePrepared,
    setPendingEarnAutodepositClosePrepared,
  ] = useState<SmartAccountPreparedEarnUsdcAutodepositClose | null>(null);
  const [isEarnAutodepositCloseReview, setIsEarnAutodepositCloseReview] =
    useState(false);
  const [autodepositConfig, setAutodepositConfig] =
    useState<EarnAutodepositConfig | null>(null);
  const [
    isEarnAutodepositSetupConfirming,
    setIsEarnAutodepositSetupConfirming,
  ] = useState(false);
  const [isEarnAutoSigning, setIsEarnAutoSigning] = useState(false);
  const [isExecutingScheduledSweep, setIsExecutingScheduledSweep] =
    useState(false);
  const [scheduledSweepExecuteError, setScheduledSweepExecuteError] = useState<
    string | null
  >(null);
  const autodepositCacheScope = useMemo(() => {
    const settingsPda = smartAccountData.overview?.settingsPda;
    const walletAddress = personalWalletAddress;
    if (!settingsPda || !walletAddress) {
      return null;
    }

    return {
      settingsPda,
      solanaEnv: publicEnv.solanaEnv,
      walletAddress,
    };
  }, [
    personalWalletAddress,
    publicEnv.solanaEnv,
    smartAccountData.overview?.settingsPda,
  ]);
  useEffect(() => {
    if (!autodepositCacheScope || !smartAccountData.isEarnStateLoading) {
      return;
    }

    const cachedConfig = readCachedEarnAutodepositConfig(autodepositCacheScope);
    if (!cachedConfig) {
      return;
    }

    setAutodepositConfig((current) => current ?? cachedConfig);
  }, [autodepositCacheScope, smartAccountData.isEarnStateLoading]);
  useEffect(() => {
    const loadedConfig = earnAutodepositConfigFromLoadedState(
      smartAccountData.earnAutodeposit
    );
    setAutodepositConfig((current) => {
      if (current?.state === "creating" && loadedConfig?.state !== "created") {
        if (loadedConfig?.policyAccount && !current.policyAccount) {
          return loadedConfig;
        }
        return current;
      }
      if (
        current?.state === "closing" ||
        current?.state === "pausing" ||
        current?.state === "resuming"
      ) {
        return current;
      }
      if (
        !loadedConfig &&
        smartAccountData.isEarnStateLoading &&
        !smartAccountData.earnStateLoadErrors.autodeposit
      ) {
        return current;
      }

      return loadedConfig;
    });
  }, [
    smartAccountData.earnAutodeposit,
    smartAccountData.earnStateLoadErrors.autodeposit,
    smartAccountData.isEarnStateLoading,
  ]);
  useEffect(() => {
    if (!autodepositCacheScope) {
      return;
    }

    const cachedConfig = toCachedEarnAutodepositConfig(autodepositConfig);
    if (cachedConfig) {
      writeCachedEarnAutodepositConfig({
        ...autodepositCacheScope,
        config: cachedConfig,
      });
      return;
    }

    if (
      !autodepositConfig &&
      !smartAccountData.isEarnStateLoading &&
      !smartAccountData.earnStateLoadErrors.autodeposit
    ) {
      removeCachedEarnAutodepositConfig(autodepositCacheScope);
    }
  }, [
    autodepositCacheScope,
    autodepositConfig,
    smartAccountData.earnStateLoadErrors.autodeposit,
    smartAccountData.isEarnStateLoading,
  ]);
  const isAutodepositReady =
    autodepositConfig?.state === "created" ||
    autodepositConfig?.state === "paused" ||
    autodepositConfig?.state === "pausing" ||
    autodepositConfig?.state === "resuming" ||
    autodepositConfig?.state === "closing";
  const isAutodepositPendingSetup = autodepositConfig?.state === "creating";
  const autodepositAmountLabel = autodepositConfig
    ? formatAutodepositUsdLabel(autodepositConfig.amount)
    : undefined;
  const autodepositFloorLabel = autodepositConfig
    ? formatAutodepositUsdLabel(autodepositConfig.keepAmount)
    : undefined;
  const autodepositDepositedLabel = autodepositConfig
    ? formatAutodepositUsdLabel(autodepositConfig.depositedAmount)
    : undefined;
  const [isSpendingLimitDraftSubmitting, setIsSpendingLimitDraftSubmitting] =
    useState(false);
  const [spendingLimitDraftError, setSpendingLimitDraftError] = useState<
    string | null
  >(null);
  const resizeStateRef = useRef<{
    startWidth: number;
    startX: number;
    target: ResizeTarget;
  } | null>(null);

  useEffect(() => {
    setActiveSection(routeSection);
  }, [routeSection]);
  const prevHadTokensRef = useRef(false);
  const selectedVault = smartAccountData.selectedVault;
  const activeDetailSelection =
    detailSelection === "action" ? actionReturnSelection : detailSelection;
  const isEarnReviewContext =
    activeDetailSelection === "earn" ||
    activeDetailSelection === "earnAutodeposit" ||
    activeDetailSelection === "earnDeposit" ||
    activeDetailSelection === "earnWithdraw";
  const isAuthResolving = !isAuthHydrated;
  const hasSmartAccountShell = Boolean(smartAccountData.overview);
  const hasWalletShell = Boolean(personalWalletAddress);
  const isWorkspaceLoading =
    canLoadPersonalAccount &&
    walletDesktopData.isLoading &&
    !hasWalletShell &&
    !hasSmartAccountShell;
  // Keep the portfolio pane in its loading skeleton until the smart-account
  // overview is established. The wallet shell loads faster than the overview
  // (base + vaults), and the settings PDA can arrive a beat after auth, so
  // without this the pane briefly flashes "No vaults found" before the Main
  // Account appears.
  const isSmartAccountShellLoading =
    canLoadPersonalAccount &&
    !hasSmartAccountShell &&
    (smartAccountData.isLoading || !user?.settingsPda);
  const isSmartAccountRateLimited =
    canLoadPersonalAccount &&
    isRateLimitedSmartAccountError(smartAccountData.error);
  const showAccountShell = isAuthHydrated;
  const isAnonymousMobilePreview =
    isMobileWorkspaceViewport &&
    appAccessMode === "anonymous" &&
    activeSection === "wallet" &&
    !connectAgentAddress;
  const shouldDefaultLoggedInMobileToEarn =
    isMobileWorkspaceViewport &&
    canLoadPersonalAccount &&
    activeSection === "wallet" &&
    !connectAgentAddress;
  const selectedAgent =
    selectedVault?.entry.signers.find(
      (signer) => signer.id === selectedSignerId
    ) ?? null;
  const selectedMockRootSigner = isMockBackupSignerFlowEnabled
    ? mockRootSigners.find((signer) => signer.id === selectedSignerId) ?? null
    : null;
  const activeMockRootSigners = useMemo(
    () => (isMockBackupSignerFlowEnabled ? mockRootSigners : []),
    [isMockBackupSignerFlowEnabled, mockRootSigners]
  );
  const hasBackupAccount = activeMockRootSigners.length >= 1;
  const availablePolicySigners = useMemo(() => {
    const PALETTE = [
      "#ffd41b",
      "#32b67c",
      "#8f3fe0",
      "#3f8ae0",
      "#e66b2e",
      "#e52e40",
      "#2bb4d6",
    ];
    const fromVault = (selectedVault?.entry.signers ?? []).map(
      (signer, index) => ({
        addressMasked: signer.shortAddress,
        agentAvatar: signer.icon,
        bg: PALETTE[index % PALETTE.length],
        id: signer.id,
        name: signer.label,
      })
    );
    if (fromVault.length > 0) return fromVault;
    const addr = personalWalletAddress;
    if (!addr) return [];
    return [
      {
        addressMasked: `${addr.slice(0, 4)}…${addr.slice(-4)}`,
        agentAvatar: undefined,
        bg: "#3f8ae0",
        id: addr,
        name: walletDesktopData.walletLabel ?? "You",
      },
    ];
  }, [selectedVault, personalWalletAddress, walletDesktopData.walletLabel]);
  const selectedApproval = useMemo(
    () =>
      smartAccountData.approvals.find(
        (approval) => approval.id === selectedApprovalId
      ) ?? null,
    [selectedApprovalId, smartAccountData.approvals]
  );
  const allKnownSignerEntries = useMemo(() => {
    const byAddress = new Map<
      string,
      Pick<SmartAccountSignerEntry, "address" | "label">
    >();
    for (const vault of smartAccountData.vaultEntries) {
      for (const signer of vault.signers) {
        byAddress.set(signer.address, signer);
      }
    }
    for (const signer of activeMockRootSigners) {
      byAddress.set(signer.address, signer);
    }
    return [...byAddress.values()];
  }, [activeMockRootSigners, smartAccountData.vaultEntries]);
  const pendingRootSignerReviewItem = useMemo<ApprovalReviewDisplayItem | null>(
    () =>
      isMockBackupSignerFlowEnabled && pendingRootSignerDraft
        ? {
            actionMode: "vote",
            amount: "",
            destinationLabel: "Backup Account",
            pages: [
              {
                heading: "Add backup",
                rows: [
                  {
                    label: "Signer wallet",
                    value: pendingRootSignerDraft.signerAddress,
                  },
                  {
                    label: "Signer role",
                    value: "Backup Account",
                  },
                  {
                    label: "Backend action",
                    value: "add_root_signer via prepareAddRootSigner",
                  },
                  {
                    label: "Future permissions",
                    value:
                      "Full root Settings signer permissions: initiate, approve, and execute account actions.",
                  },
                ],
                subheading:
                  "This preview adds the Backup Account as the second root signer. The future backend flow will grant this wallet full root Settings signer permissions.",
                title: "Add backup",
              },
            ],
            primaryActionLabel: "Accept",
            secondaryActionLabel: "Cancel",
            sourceLabel: "Root settings",
            status: "active",
            statusLabel: "Preview",
            symbol: "",
            title: "Add backup",
          }
        : null,
    [isMockBackupSignerFlowEnabled, pendingRootSignerDraft]
  );
  const pendingRootSignerRemovalReviewItem =
    useMemo<ApprovalReviewDisplayItem | null>(() => {
      const signer = pendingRootSignerRemovalDraft
        ? activeMockRootSigners.find(
            (entry) =>
              entry.address === pendingRootSignerRemovalDraft.signerAddress
          )
        : null;

      return signer
        ? {
            actionMode: "vote",
            amount: "",
            destinationLabel: "Backup Account",
            pages: [
              {
                heading: "Remove backup",
                rows: [
                  {
                    label: "Signer wallet",
                    value: signer.address,
                  },
                  {
                    label: "Signer role",
                    value: "Backup Account",
                  },
                  {
                    label: "Backend action",
                    value: "remove_root_signer via prepareRemoveRootSigner",
                  },
                ],
                subheading:
                  "This preview removes the Backup Account from the root account signer set. The real flow will submit this as a root Settings signer change.",
                title: "Remove backup",
              },
            ],
            primaryActionLabel: "Agree",
            secondaryActionLabel: "Cancel",
            sourceLabel: "Root settings",
            status: "active",
            statusLabel: "Preview",
            symbol: "",
            title: "Remove backup",
          }
        : null;
    }, [activeMockRootSigners, pendingRootSignerRemovalDraft]);
  const latestPendingApproval = useMemo(
    () =>
      smartAccountData.approvals.find(
        (approval) => approval.status === "active"
      ) ?? null,
    [smartAccountData.approvals]
  );
  const selectedVaultAccountIndex = selectedVault?.entry.accountIndex ?? 0;
  const shouldShowApprovalsSkeleton =
    smartAccountData.isProposalsLoading &&
    smartAccountData.approvals.length === 0 &&
    !draftProposal;
  const selectedVaultSpendingLimit = useMemo(() => {
    const spendingLimits = selectedVault?.spendingLimits ?? [];

    return (
      spendingLimits.find(
        (spendingLimit) =>
          !spendingLimit.isExpired &&
          spendingLimit.mint === SOL_SPENDING_LIMIT_MINT
      ) ??
      spendingLimits.find((spendingLimit) => !spendingLimit.isExpired) ??
      spendingLimits[0] ??
      null
    );
  }, [selectedVault?.spendingLimits]);
  const walletSpendingLimitActionKeys = new Set([
    `set:${selectedVaultAccountIndex}:${personalWalletAddress ?? ""}`,
    `delete:${selectedVaultAccountIndex}:${personalWalletAddress ?? ""}`,
  ]);
  const pendingSpendingLimitKeys = selectedAgent
    ? new Set([
        `set:${selectedVaultAccountIndex}:${selectedAgent.address}`,
        `delete:${selectedVaultAccountIndex}:${selectedAgent.address}`,
        `topup:${selectedVaultAccountIndex}:${selectedAgent.address}`,
      ])
    : new Set<string>();
  const pendingSignerDeleteKey = selectedAgent
    ? `delete-signer:${selectedVaultAccountIndex}:${selectedAgent.address}`
    : null;
  const derivedTokens = useMemo<SwapToken[]>(() => {
    const positions = personalWalletPositions;

    if (!positions || positions.length === 0) {
      return fallbackSwapTokens;
    }

    const tokens: SwapToken[] = positions
      .filter(
        (position) =>
          position.publicBalance > 0 ||
          ["SOL", "USDC"].includes(position.asset.symbol)
      )
      .map(portfolioPositionToSwapToken);

    if (!tokens.some((token) => token.mint === LOYL_TOKEN.mint)) {
      const loylPosition = positions.find(
        (position) => position.asset.mint === LOYL_TOKEN.mint
      );
      const loyl = loylPosition
        ? {
            ...LOYL_TOKEN,
            balance: loylPosition.publicBalance,
            price: loylPosition.priceUsd ?? 0,
          }
        : LOYL_TOKEN;

      tokens.splice(2, 0, loyl);
    }

    return tokens;
  }, [personalWalletPositions]);
  const vaultDerivedTokens = useMemo<SwapToken[]>(() => {
    const vault = smartAccountData.overview?.vaults.find(
      (entry) => entry.accountIndex === selectedVaultAccountIndex
    );
    const positions = vault?.portfolio.positions ?? [];
    return positions
      .filter((position) => position.publicBalance > 0)
      .map(portfolioPositionToSwapToken);
  }, [smartAccountData.overview?.vaults, selectedVaultAccountIndex]);
  const securedTokens = useMemo<SwapToken[]>(
    () =>
      personalWalletPositions
        .filter((position) => position.securedBalance > 0)
        .map((position) => ({
          balance: position.securedBalance,
          icon:
            position.asset.imageUrl ?? getTokenIconUrl(position.asset.symbol),
          isSecured: true,
          mint: position.asset.mint,
          price: position.priceUsd ?? 0,
          symbol: position.asset.symbol,
        })),
    [personalWalletPositions]
  );
  const shieldSourceTokens = useMemo(
    () => [...derivedTokens, ...securedTokens],
    [derivedTokens, securedTokens]
  );
  const mainAccountUsdcPosition = useMemo(
    () => findEarnUsdcPosition(personalWalletPositions, trackedKaminoUsdcMint),
    [personalWalletPositions, trackedKaminoUsdcMint]
  );
  const mainAccountVisibleUsdcBalanceRaw = useMemo(
    () =>
      mainAccountUsdcBalance.amountRaw ??
      tokenAmountNumberToRaw(mainAccountUsdcPosition?.publicBalance, 6),
    [mainAccountUsdcBalance.amountRaw, mainAccountUsdcPosition?.publicBalance]
  );
  const earnDepositSources = useMemo<EarnDepositSourceOption[]>(() => {
    const sources: EarnDepositSourceOption[] = [];
    const mainUsdcPosition = mainAccountUsdcPosition;
    const mainUsdcBalance = canLoadPersonalAccount
      ? mainAccountUsdcBalance.amount ?? mainUsdcPosition?.publicBalance ?? 0
      : 0;
    const mainBalance = splitUsdcSourceBalance(mainUsdcBalance);

    sources.push({
      addressLabel: canLoadPersonalAccount
        ? formatAddressForEarnSource(personalWalletAddress)
        : "Not connected",
      balance: mainUsdcBalance,
      balanceFraction: mainBalance.fraction,
      balanceWhole: mainBalance.whole,
      decimals: 6,
      icon: getWalletIcon(),
      id: "main",
      label: canLoadPersonalAccount ? "Main" : "Wallet",
      mint: trackedKaminoUsdcMint ?? mainUsdcPosition?.asset.mint ?? null,
    });

    return sources;
  }, [
    canLoadPersonalAccount,
    mainAccountUsdcBalance.amount,
    mainAccountUsdcPosition,
    personalWalletAddress,
    trackedKaminoUsdcMint,
  ]);
  const autodepositWalletBalanceFloorRaw = useMemo(() => {
    const loadedFloorRaw =
      smartAccountData.earnAutodeposit?.walletBalanceFloorRaw;
    const parsedLoadedFloorRaw = parseUnsignedRawTokenAmount(loadedFloorRaw);
    if (parsedLoadedFloorRaw !== null) {
      return parsedLoadedFloorRaw;
    }

    if (!autodepositConfig) {
      return null;
    }

    try {
      return parseTokenAmountLabelToRaw(autodepositConfig.keepAmount, 6);
    } catch {
      return null;
    }
  }, [
    autodepositConfig,
    smartAccountData.earnAutodeposit?.walletBalanceFloorRaw,
  ]);
  const pendingScheduledSweepPreview =
    useMemo<PendingScheduledSweepPreview | null>(() => {
      if (
        !autodepositConfig ||
        !isAutodepositReady ||
        !isEarnAutodepositSetupConfirming ||
        (autodepositConfig.scheduledSweeps?.length ?? 0) > 0
      ) {
        return null;
      }

      const source = earnDepositSources.find((entry) => entry.id === "main");
      if (!source) {
        return null;
      }

      try {
        const balanceRaw = parseTokenAmountLabelToRaw(
          source.balance.toString(),
          source.decimals
        );
        const floorRaw = parseTokenAmountLabelToRaw(
          autodepositConfig.keepAmount,
          source.decimals
        );
        const allowanceRaw = parseTokenAmountLabelToRaw(
          autodepositConfig.amount,
          source.decimals
        );
        const depositedRaw = parseTokenAmountLabelToRaw(
          autodepositConfig.depositedAmount,
          source.decimals
        );
        const surplusRaw = balanceRaw - floorRaw;
        const remainingAllowanceRaw = allowanceRaw - depositedRaw;
        const amountRaw =
          surplusRaw < remainingAllowanceRaw
            ? surplusRaw
            : remainingAllowanceRaw;

        return amountRaw >= EARN_AUTODEPOSIT_MIN_VISIBLE_SCHEDULED_SWEEP_RAW
          ? { amountRaw: amountRaw.toString() }
          : null;
      } catch {
        return null;
      }
    }, [
      autodepositConfig,
      earnDepositSources,
      isAutodepositReady,
      isEarnAutodepositSetupConfirming,
    ]);
  const rawEarnTransactionScheduledSweeps = useMemo(() => {
    const liveScheduledSweeps =
      smartAccountData.earnAutodeposit?.status === "active"
        ? smartAccountData.earnAutodeposit.scheduledSweeps ?? []
        : [];
    const localScheduledSweeps = isAutodepositReady
      ? autodepositConfig?.scheduledSweeps ?? []
      : [];

    return liveScheduledSweeps.length > 0
      ? liveScheduledSweeps
      : smartAccountData.isEarnStateLoading
      ? localScheduledSweeps
      : [];
  }, [
    autodepositConfig?.scheduledSweeps,
    isAutodepositReady,
    smartAccountData.earnAutodeposit?.scheduledSweeps,
    smartAccountData.earnAutodeposit?.status,
    smartAccountData.isEarnStateLoading,
  ]);
  const visibleAutodepositScheduledSweeps = useMemo(
    () =>
      getVisibleEarnAutodepositScheduledSweeps({
        scheduledSweeps: isAutodepositReady
          ? autodepositConfig?.scheduledSweeps ?? []
          : [],
        walletBalanceFloorRaw: autodepositWalletBalanceFloorRaw,
        walletBalanceRaw: mainAccountVisibleUsdcBalanceRaw,
      }),
    [
      autodepositConfig?.scheduledSweeps,
      autodepositWalletBalanceFloorRaw,
      isAutodepositReady,
      mainAccountVisibleUsdcBalanceRaw,
    ]
  );
  const earnTransactionScheduledSweeps = useMemo(
    () =>
      getVisibleEarnAutodepositScheduledSweeps({
        scheduledSweeps: rawEarnTransactionScheduledSweeps,
        walletBalanceFloorRaw: autodepositWalletBalanceFloorRaw,
        walletBalanceRaw: mainAccountVisibleUsdcBalanceRaw,
      }),
    [
      autodepositWalletBalanceFloorRaw,
      mainAccountVisibleUsdcBalanceRaw,
      rawEarnTransactionScheduledSweeps,
    ]
  );
  const earnWithdrawDestinations = useMemo<EarnDepositSourceOption[]>(() => {
    const mainDestination = earnDepositSources.find(
      (source) => source.id === "main"
    );
    return mainDestination ? [mainDestination] : earnDepositSources.slice(0, 1);
  }, [earnDepositSources]);
  const earnVaultAddressLabel = useMemo(() => {
    const earnVault = smartAccountData.overview?.vaults.find(
      (vault) => vault.accountIndex === 1
    );
    return earnVault?.address
      ? formatAddressForEarnSource(earnVault.address)
      : null;
  }, [smartAccountData.overview?.vaults]);
  const hasEarnPolicy = Boolean(smartAccountData.earnPolicy);
  const hasEarnPosition = isActiveEarnPosition(activeEarnPosition);
  const isEarnPositionInitialLoading =
    canLoadPersonalAccount &&
    isActiveEarnPositionLoading &&
    !hasActiveEarnPositionResolved &&
    !hasEarnPosition;
  const isEarnAccessResolving =
    canLoadPersonalAccount &&
    detailSelection === "earn" &&
    (isEarnPositionInitialLoading ||
      (!hasEarnPosition &&
        (!smartAccountData.hasEarnStateResolved ||
          !hasActiveEarnPositionResolved)));
  const isEarnDepositDetailActive =
    detailSelection === "earnDeposit" ||
    (detailSelection === "earn" && !hasEarnPosition && !isEarnAccessResolving);
  const isEarnDepositSubViewActive =
    detailSelection === "earnDeposit" && hasEarnPosition;
  const earnDepositReviewItem = useMemo(
    () =>
      pendingEarnDepositDraft && isEarnDepositDetailActive
        ? buildEarnDepositReviewItem({
            draft: pendingEarnDepositDraft,
            isPolicySetupFlow: isEarnDepositPolicySetupFlow,
            preparedDeposit: pendingEarnDepositPrepared,
            showBatchTransactions: Boolean(
              wallet.signAllTransactions && pendingEarnDepositPrepared
            ),
            stage: earnDepositReviewStage,
          })
        : null,
    [
      earnDepositReviewStage,
      isEarnDepositDetailActive,
      isEarnDepositPolicySetupFlow,
      pendingEarnDepositDraft,
      pendingEarnDepositPrepared,
      wallet.signAllTransactions,
    ]
  );
  const earnWithdrawReviewItem = useMemo(
    () =>
      pendingEarnWithdrawDraft && detailSelection === "earnWithdraw"
        ? buildEarnWithdrawReviewItem({
            draft: pendingEarnWithdrawDraft,
            hasAutodepositTeardown: Boolean(
              pendingEarnCleanupPrepared?.autodepositClosePrepared ??
                pendingEarnWithdrawPrepared?.autodepositClosePrepared
            ),
            preparedWithdraw: pendingEarnWithdrawPrepared,
            stage: earnWithdrawReviewStage,
          })
        : null,
    [
      detailSelection,
      earnWithdrawReviewStage,
      pendingEarnWithdrawDraft,
      pendingEarnCleanupPrepared,
      pendingEarnWithdrawPrepared,
    ]
  );
  const earnCleanupReviewItem = useMemo(
    () =>
      pendingEarnCleanupPrepared && detailSelection === "earnWithdraw"
        ? buildEarnCleanupReviewItem({
            preparedCleanup: pendingEarnCleanupPrepared,
          })
        : null,
    [detailSelection, pendingEarnCleanupPrepared]
  );
  const earnAutodepositSetupReviewItem = useMemo(
    () =>
      pendingEarnAutodepositDraft &&
      detailSelection === "earnAutodeposit" &&
      !isEarnAutodepositCloseReview
        ? buildEarnAutodepositSetupReviewItem({
            draft: pendingEarnAutodepositDraft,
            preparedSetup: pendingEarnAutodepositSetupPrepared,
            stage: earnAutodepositSetupReviewStage,
          })
        : null,
    [
      detailSelection,
      earnAutodepositSetupReviewStage,
      isEarnAutodepositCloseReview,
      pendingEarnAutodepositDraft,
      pendingEarnAutodepositSetupPrepared,
    ]
  );
  const earnAutodepositCloseReviewItem = useMemo(
    () =>
      autodepositConfig &&
      detailSelection === "earnAutodeposit" &&
      isEarnAutodepositCloseReview
        ? buildEarnAutodepositCloseReviewItem({
            amountLabel:
              autodepositAmountLabel ?? `$${autodepositConfig.amount}.00`,
            preparedClose: pendingEarnAutodepositClosePrepared,
          })
        : null,
    [
      autodepositConfig,
      autodepositAmountLabel,
      detailSelection,
      isEarnAutodepositCloseReview,
      pendingEarnAutodepositClosePrepared,
    ]
  );
  const shieldedBalancesUnlockReviewItem =
    useMemo<ApprovalReviewDisplayItem | null>(
      () =>
        isShieldedBalancesUnlockReviewOpen
          ? {
              actionMode: "execute",
              amount: "Reveal",
              destinationLabel: "Main Account",
              primaryActionLabel: "Sign to show balances",
              reviewSections: [
                {
                  rows: [
                    {
                      label: "Wallet",
                      value: shortCommandAddress(personalWalletAddress),
                    },
                    {
                      label: "Why sign",
                      value:
                        "Signing proves wallet ownership so Loyal can show shielded balances.",
                    },
                    {
                      label: "Funds",
                      value: "No funds move and no gas is spent.",
                    },
                  ],
                  title: "MagicBlock authentication",
                },
              ],
              sourceLabel: "Connected wallet",
              status: "approved",
              statusLabel: "Signature required",
              summaryLabel: "Show shielded balances",
              symbol: "",
              title: "Shielded balances",
            }
          : null,
      [isShieldedBalancesUnlockReviewOpen, personalWalletAddress]
    );
  // A staged wallet action is being reviewed in the right pane.
  const isReviewApprovalFocused = Boolean(
    earnDepositReviewItem ||
      earnWithdrawReviewItem ||
      earnCleanupReviewItem ||
      earnAutodepositSetupReviewItem ||
      earnAutodepositCloseReviewItem ||
      shieldedBalancesUnlockReviewItem ||
      pendingRootSignerReviewItem ||
      pendingRootSignerRemovalReviewItem
  );
  // While a dismissed review slides out, AnimatePresence keeps its overlay
  // mounted. This flag keeps the pane lifted above the fading scrim until the
  // exit animation completes; the render-phase update avoids a one-frame
  // z-order flash between dismissal and the effect pass.
  const [isEarnReviewExiting, setIsEarnReviewExiting] = useState(false);
  const [wasEarnReviewOpen, setWasEarnReviewOpen] = useState(false);
  if (wasEarnReviewOpen !== isReviewApprovalFocused) {
    setWasEarnReviewOpen(isReviewApprovalFocused);
    if (!isReviewApprovalFocused) {
      setIsEarnReviewExiting(true);
    }
  }
  const earnCurrentBalanceAmount =
    hasEarnPosition && activeEarnPosition
      ? rawTokenAmountToNumber(activeEarnPosition.currentTotalAmountRaw, 6)
      : 0;
  const earnPrincipalAmount =
    hasEarnPosition && activeEarnPosition
      ? rawTokenAmountToNumber(activeEarnPosition.principalAmountRaw, 6)
      : 0;
  const getEarnWithdrawDraftAmountRaw = useCallback(
    (draft: EarnWithdrawDraft): bigint =>
      draft.mode === "full"
        ? BigInt(draft.source.amountRaw)
        : parseTokenAmountLabelToRaw(draft.amountLabel, draft.tokenDecimals),
    []
  );
  const totalBalance = useMemo(
    () =>
      splitUsdBalance(
        mainAccountDisplayUsd +
          smartAccountData.totalUsd +
          earnCurrentBalanceAmount
      ),
    [earnCurrentBalanceAmount, mainAccountDisplayUsd, smartAccountData.totalUsd]
  );
  const earnEarningsPrincipalAmountRaw =
    hasEarnPosition && activeEarnPosition
      ? activeEarnPosition.principalAmountRaw
      : "0";
  const earnEarningsHistoryCursor =
    hasEarnPosition && activeEarnPosition
      ? [
          activeEarnPosition.currentHolding.provenance.lastHoldingEventId ??
            "no-holding-event",
          activeEarnPosition.currentHolding.provenance
            .lastRebalanceDecisionId ?? "no-rebalance-decision",
        ].join(".")
      : "no-position";
  const earnEarningsCacheKey = [
    publicEnv.solanaEnv,
    personalWalletAddress ?? "anonymous",
    smartAccountData.overview?.settingsPda ?? "no-settings",
    earnEarningsPrincipalAmountRaw,
    earnEarningsHistoryCursor,
  ].join(":");
  const swapTargetTokens = useMemo<SwapToken[]>(() => {
    const heldMints = new Set(
      derivedTokens.map((token) => token.mint).filter(Boolean)
    );
    const extras = popularTokens.filter(
      (token) => token.mint && !heldMints.has(token.mint)
    );

    return [...derivedTokens, ...extras];
  }, [derivedTokens, popularTokens]);
  const shieldSecuredBalance = useMemo(() => {
    if (!shieldToken.mint) return 0;

    const position = personalWalletPositions.find(
      (entry) => entry.asset.mint === shieldToken.mint
    );

    return position?.securedBalance ?? 0;
  }, [personalWalletPositions, shieldToken.mint]);

  useEffect(() => {
    if (!isAuthHydrated) {
      return;
    }

    if (appAccessMode === "anonymous") {
      invalidateEarnClientCaches();
    }
  }, [appAccessMode, invalidateEarnClientCaches, isAuthHydrated]);

  useEffect(() => {
    setConnectAgentAddress(
      new URLSearchParams(window.location.search).get("connect")
    );
  }, []);

  useEffect(() => {
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, []);

  useEffect(() => {
    const firstToken = derivedTokens[0];
    const hasTokens = derivedTokens.length > 0 && !!firstToken?.mint;

    if (hasTokens && !prevHadTokensRef.current && firstToken) {
      setSendToken(firstToken);
      setSwapFromToken(firstToken);
      setShieldToken(firstToken);
      setSwapToToken(
        derivedTokens.find((token) => token.mint === LOYL_TOKEN.mint) ??
          LOYL_TOKEN
      );
    }

    prevHadTokensRef.current = hasTokens;
  }, [derivedTokens]);

  useEffect(() => {
    const stored = window.localStorage.getItem(PANE_WIDTH_STORAGE_KEY);

    if (!stored) return;

    try {
      const parsed = JSON.parse(stored) as {
        account?: number;
        review?: number;
      };

      if (typeof parsed.account === "number") {
        setAccountPaneWidth(
          clampWidth(
            parsed.account,
            ACCOUNT_PANE_MIN_WIDTH,
            ACCOUNT_PANE_MAX_WIDTH
          )
        );
      }

      if (typeof parsed.review === "number") {
        setReviewPaneWidth(
          clampWidth(
            parsed.review,
            REVIEW_PANE_MIN_WIDTH,
            REVIEW_PANE_MAX_WIDTH
          )
        );
      }
    } catch {
      window.localStorage.removeItem(PANE_WIDTH_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      PANE_WIDTH_STORAGE_KEY,
      JSON.stringify({ account: accountPaneWidth, review: reviewPaneWidth })
    );
  }, [accountPaneWidth, reviewPaneWidth]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current;

      if (!resizeState) return;

      const deltaX = event.clientX - resizeState.startX;

      if (resizeState.target === "account") {
        setAccountPaneWidth(
          clampWidth(
            resizeState.startWidth + deltaX,
            ACCOUNT_PANE_MIN_WIDTH,
            ACCOUNT_PANE_MAX_WIDTH
          )
        );
        return;
      }

      setReviewPaneWidth(
        clampWidth(
          resizeState.startWidth - deltaX,
          REVIEW_PANE_MIN_WIDTH,
          REVIEW_PANE_MAX_WIDTH
        )
      );
    };

    const handlePointerUp = () => {
      if (!resizeStateRef.current) return;

      resizeStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  useEffect(() => {
    if (!connectAgentAddress) return;

    setSelectedSignerId(null);
    setDetailSelection("connect");
    setSelectedDetail("Connection request");

    if (canLoadPersonalAccount) {
      if (signInOpenedForConnectRef.current) {
        signInOpenedForConnectRef.current = false;
        closeSignIn();
      }
      return;
    }

    signInOpenedForConnectRef.current = true;
    openSignIn();
  }, [
    closeSignIn,
    connectAgentAddress,
    canLoadPersonalAccount,
    openSignIn,
    setDetailSelection,
  ]);

  useEffect(() => {
    if (!selectedApprovalId) return;

    const approvalStillExists = smartAccountData.approvals.some(
      (approval) => approval.id === selectedApprovalId
    );
    const matchesDraft = draftProposal?.id === selectedApprovalId;

    if (!approvalStillExists && !matchesDraft) {
      setSelectedApprovalId(null);
    }
  }, [selectedApprovalId, smartAccountData.approvals, draftProposal]);

  useEffect(() => {
    if (!isAuthHydrated) {
      return;
    }

    if (appAccessMode === "anonymous") {
      hasRestoredSelectionRef.current = false;
      hasLocalDetailSelectionRef.current = false;
      skipNextWorkspaceSelectionPersistRef.current = false;
      setIsSelectionRestored(false);
      if (!connectAgentAddress) {
        setSelectedSignerId(null);
        setDetailSelectionState("earn");
        setSelectedDetail("Earn");
      }
    }
  }, [appAccessMode, connectAgentAddress, isAuthHydrated]);

  useEffect(() => {
    if (!isAnonymousMobilePreview) {
      return;
    }

    setMobilePane((current) => (current === "accounts" ? "detail" : current));
  }, [isAnonymousMobilePreview]);

  useEffect(() => {
    if (!shouldDefaultLoggedInMobileToEarn) {
      return;
    }

    if (!hasLocalDetailSelectionRef.current) {
      setSelectedDetail("Earn");
    }
    setMobilePane((current) => (current === "accounts" ? "detail" : current));
  }, [shouldDefaultLoggedInMobileToEarn]);

  // Lazy-load the agent's own wallet portfolio when an agent (non-Main Account
  // signer) is selected. Skips the Main Account row — that wallet is already
  // covered by walletDesktopData.
  const loadSignerPortfolio = smartAccountData.loadSignerPortfolio;
  useEffect(() => {
    if (
      !selectedAgent ||
      selectedAgent.label === "Main Account" ||
      activeDetailSelection !== "agent"
    ) {
      return;
    }

    void loadSignerPortfolio(selectedAgent.address).catch(() => undefined);
  }, [selectedAgent, activeDetailSelection, loadSignerPortfolio]);

  useEffect(() => {
    if (
      hasRestoredSelectionRef.current ||
      !canLoadPersonalAccount ||
      !smartAccountData.overview ||
      walletDesktopData.isLoading ||
      smartAccountData.isBaseLoading
    ) {
      return;
    }

    // Past the loading guard, the persisted selection is resolvable this tick
    // (batched with the setDetailSelection calls below), so unblock the detail
    // pane to render the restored pane directly instead of the default first.
    setIsSelectionRestored(true);

    if (hasLocalDetailSelectionRef.current) {
      hasRestoredSelectionRef.current = true;
      return;
    }

    if (shouldDefaultLoggedInMobileToEarn) {
      setDetailSelectionState("earn");
      setSelectedSignerId(null);
      setSelectedDetail("Earn");
      setMobilePane("detail");
      skipNextWorkspaceSelectionPersistRef.current = true;
      hasRestoredSelectionRef.current = true;
      return;
    }

    const storedSelection = readPersistedWorkspaceSelection();

    if (!storedSelection) {
      setDetailSelection("earn");
      setSelectedSignerId(null);
      setSelectedDetail("Earn");
      hasRestoredSelectionRef.current = true;
      return;
    }

    if (storedSelection.type === "wallet") {
      setDetailSelection("wallet");
      setSelectedSignerId(null);
      setSelectedDetail("My Wallet");
      hasRestoredSelectionRef.current = true;
      return;
    }

    if (storedSelection.type === "earn") {
      setDetailSelection("earn");
      setSelectedSignerId(null);
      setSelectedDetail("Earn");
      hasRestoredSelectionRef.current = true;
      return;
    }

    const storedVault = smartAccountData.vaultEntries.find(
      (vault) => vault.accountIndex === storedSelection.accountIndex
    );

    if (!storedVault) {
      hasRestoredSelectionRef.current = true;
      return;
    }

    smartAccountData.setSelectedVaultIndex(storedVault.accountIndex);

    if (storedSelection.type === "vault") {
      // Stash/vault detail was removed from this workspace UI, so a stale
      // persisted vault selection must fall back to the default Earn pane
      // instead of briefly resurrecting the removed Stash pane on load.
      setDetailSelection("earn");
      setSelectedSignerId(null);
      setSelectedDetail("Earn");
      hasRestoredSelectionRef.current = true;
      return;
    }

    const storedSigner = storedVault.signers.find(
      (signer) =>
        signer.id === storedSelection.signerId ||
        signer.address === storedSelection.signerAddress
    );

    if (!storedSigner) {
      // The signer is gone; the old fallback opened the parent vault detail,
      // but that Stash pane was removed from this workspace UI, so fall back
      // to the default Earn pane instead of resurrecting it on load.
      setDetailSelection("earn");
      setSelectedSignerId(null);
      setSelectedDetail("Earn");
      hasRestoredSelectionRef.current = true;
      return;
    }

    setSelectedSignerId(storedSigner.id);
    setDetailSelection(storedSelection.type === "user" ? "wallet" : "agent");
    setSelectedDetail(`${storedSigner.label} · ${storedSigner.shortAddress}`);
    hasRestoredSelectionRef.current = true;
  }, [
    canLoadPersonalAccount,
    smartAccountData,
    smartAccountData.overview,
    setDetailSelection,
    smartAccountData.isBaseLoading,
    smartAccountData.vaultEntries,
    shouldDefaultLoggedInMobileToEarn,
    walletDesktopData.isLoading,
  ]);

  useEffect(() => {
    if (!hasRestoredSelectionRef.current || !canLoadPersonalAccount) return;

    if (skipNextWorkspaceSelectionPersistRef.current) {
      skipNextWorkspaceSelectionPersistRef.current = false;
      return;
    }

    const stableSelection =
      detailSelection === "action" ? actionReturnSelection : detailSelection;

    let selectionToPersist: PersistedWorkspaceSelection | null = null;

    if (stableSelection === "wallet") {
      selectionToPersist =
        selectedSignerId && selectedAgent
          ? {
              type: "user",
              accountIndex: selectedVaultAccountIndex,
              signerAddress: selectedAgent.address,
              signerId: selectedAgent.id,
            }
          : { type: "wallet" };
    } else if (
      stableSelection === "earn" ||
      stableSelection === "earnAutodeposit" ||
      stableSelection === "earnDeposit" ||
      stableSelection === "earnWithdraw"
    ) {
      selectionToPersist = { type: "earn" };
    } else if (stableSelection === "vault" && selectedVault) {
      selectionToPersist = {
        type: "vault",
        accountIndex: selectedVault.entry.accountIndex,
      };
    } else if (stableSelection === "agent" && selectedAgent) {
      selectionToPersist = {
        type: "agent",
        accountIndex: selectedVaultAccountIndex,
        signerAddress: selectedAgent.address,
        signerId: selectedAgent.id,
      };
    }

    if (!selectionToPersist) return;

    window.localStorage.setItem(
      SELECTED_WORKSPACE_ITEM_STORAGE_KEY,
      JSON.stringify(selectionToPersist)
    );
  }, [
    actionReturnSelection,
    detailSelection,
    canLoadPersonalAccount,
    selectedAgent,
    selectedSignerId,
    selectedVault,
    selectedVaultAccountIndex,
  ]);

  const markDetailPaneTransition = useCallback(
    (transition: DetailPaneTransition) => {
      setDetailPaneTransition(transition);
      setDetailPaneTransitionKey((current) => current + 1);
    },
    []
  );

  const closeActionView = useCallback(() => {
    markDetailPaneTransition("close");
    setViewStack([]);
    setSendInitialRecipient("");
    setDetailSelection(actionReturnSelection);
  }, [actionReturnSelection, markDetailPaneTransition, setDetailSelection]);

  const pushView = useCallback(
    (view: Exclude<SubView, null>) => {
      if (shouldLoadPopularTokensForView(view)) {
        setShouldLoadPopularTokens(true);
      }

      markDetailPaneTransition("forward");
      setViewStack((current) => [...current, view]);
    },
    [markDetailPaneTransition]
  );

  const popView = useCallback(() => {
    markDetailPaneTransition("back");
    setViewStack((current) => current.slice(0, -1));
  }, [markDetailPaneTransition]);

  const openActionView = useCallback(
    (
      view: Exclude<SubView, null>,
      title: string,
      initialRecipient = "",
      returnSelection = detailSelection
    ) => {
      if (shouldLoadPopularTokensForView(view)) {
        setShouldLoadPopularTokens(true);
      }

      setActionReturnSelection(
        returnSelection === "action" ? actionReturnSelection : returnSelection
      );

      if (viewType(view) === "swapPanel") {
        setSwapMode(
          typeof view === "object" && view.type === "swapPanel" && view.mode
            ? view.mode
            : "swap"
        );
      }

      markDetailPaneTransition(initialActionTransition(view));
      setSendInitialRecipient(initialRecipient);
      setViewStack([view]);
      setDetailSelection("action");
      setSelectedDetail(title);
      setMobilePane("detail");
    },
    [
      actionReturnSelection,
      detailSelection,
      markDetailPaneTransition,
      setDetailSelection,
    ]
  );

  const openWorkspaceActionView = useCallback(
    (
      view: Exclude<SubView, null>,
      title: string,
      initialRecipient = "",
      returnSelection = detailSelection
    ) => {
      if (viewType(view) === "transaction") {
        setDetailInitialTab("activity");
      }

      openActionView(view, title, initialRecipient, returnSelection);
    },
    [detailSelection, openActionView]
  );

  const dismissShieldedBalancesUnlockReview = useCallback(() => {
    setShieldedBalancesUnlockError(null);
    setIsShieldedBalancesUnlockReviewOpen(false);
  }, []);

  const openShieldedBalancesUnlockReview = useCallback(() => {
    setShieldedBalancesUnlockError(null);
    setIsShieldedBalancesUnlockReviewOpen(true);
  }, []);

  const unlockShieldedBalancesFromReusableAuth = useCallback(() => {
    if (!connectedWalletAddress || !shieldedBalancesUnlockKey) {
      return false;
    }

    if (
      !hasReusableFrontendPrivateClientAuth({
        publicKey: connectedWalletAddress,
        solanaEnv: publicEnv.solanaEnv,
      })
    ) {
      return false;
    }

    setShieldedBalancesUnlockedForKey(shieldedBalancesUnlockKey);
    dismissShieldedBalancesUnlockReview();
    return true;
  }, [
    connectedWalletAddress,
    dismissShieldedBalancesUnlockReview,
    publicEnv.solanaEnv,
    shieldedBalancesUnlockKey,
  ]);

  const unlockShieldedBalances = useCallback(async () => {
    const publicKey = wallet.publicKey;
    const signTransaction = wallet.signTransaction;
    const signAllTransactions = wallet.signAllTransactions;
    const signMessage = wallet.signMessage;

    if (
      !wallet.connected ||
      !publicKey ||
      !signTransaction ||
      !signAllTransactions ||
      !signMessage ||
      !shieldedBalancesUnlockKey
    ) {
      setShieldedBalancesUnlockError(
        "Connect a wallet that supports message and transaction signing."
      );
      return;
    }

    const unlockKey = shieldedBalancesUnlockKey;
    let signMessageError: unknown = null;
    const signer = {
      publicKey,
      signTransaction,
      signAllTransactions,
      signMessage: async (message: Uint8Array) => {
        try {
          return await signMessage(message);
        } catch (error) {
          signMessageError = error;
          throw error;
        }
      },
    } as FrontendPrivateClientSigner;

    setIsShieldedBalancesUnlocking(true);
    setShieldedBalancesUnlockError(null);

    try {
      await getFrontendPrivateClient({
        signer,
        solanaEnv: publicEnv.solanaEnv,
      });
      setShieldedBalancesUnlockedForKey(unlockKey);
      dismissShieldedBalancesUnlockReview();
    } catch (error) {
      setShieldedBalancesUnlockError(
        getShieldedBalancesUnlockErrorMessage(signMessageError ?? error)
      );
    } finally {
      setIsShieldedBalancesUnlocking(false);
    }
  }, [
    dismissShieldedBalancesUnlockReview,
    publicEnv.solanaEnv,
    shieldedBalancesUnlockKey,
    wallet.connected,
    wallet.publicKey,
    wallet.signAllTransactions,
    wallet.signMessage,
    wallet.signTransaction,
  ]);

  const handleOpenMainAccountShield = useCallback(() => {
    if (
      !hasUnlockedShieldedBalances &&
      !unlockShieldedBalancesFromReusableAuth()
    ) {
      openShieldedBalancesUnlockReview();
      return;
    }

    setShieldDirection("shield");
    openActionView(
      { type: "swapPanel", mode: "shield" },
      "Shield",
      "",
      "wallet"
    );
  }, [
    hasUnlockedShieldedBalances,
    openActionView,
    openShieldedBalancesUnlockReview,
    unlockShieldedBalancesFromReusableAuth,
  ]);

  const handleSwapModeChange = useCallback(
    (mode: SwapMode) => {
      if (swapMode !== mode && mode === "shield") {
        trackWalletShieldPressed(publicEnv, {
          interaction: "open",
          source: "wallet_workspace",
        });
      }

      setSwapMode(mode);
    },
    [publicEnv, swapMode]
  );

  const handleActionBack = useCallback(() => {
    if (viewStack.length <= 1) {
      closeActionView();
      return;
    }

    popView();
  }, [closeActionView, popView, viewStack.length]);

  const handleTokenSelect = useCallback(
    (token: SwapToken) => {
      const topView = viewStack[viewStack.length - 1];

      if (typeof topView === "object" && topView?.type === "tokenSelect") {
        if (topView.field === "from") {
          if (token.symbol === swapToToken.symbol) {
            setSwapToToken(swapFromToken);
          }

          setSwapFromToken(token);
        } else {
          if (token.symbol === swapFromToken.symbol) {
            setSwapFromToken(swapToToken);
          }

          setSwapToToken(token);
        }
      }
    },
    [swapFromToken, swapToToken, viewStack]
  );

  const getTokenActions = useCallback(
    (token: TokenRow): TokenRowActions | undefined => {
      const isLoyal = token.id === LOYL_TOKEN.mint || token.symbol === "LOYAL";
      const isSecured = token.isSecured === true;
      const swapToken = tokenRowToSwapToken(token);

      if (isSecured) {
        return {
          onSend: () => {
            setSendToken(swapToken);
            openActionView({ type: "sendPanel" }, "Send");
          },
          onUnshield: () => {
            setShieldToken(swapToken);
            setShieldDirection("unshield");
            openActionView({ type: "swapPanel", mode: "shield" }, "Unshield");
          },
        };
      }

      const actions: TokenRowActions = {
        onSend: () => {
          setSendToken(swapToken);
          openActionView({ type: "sendPanel" }, "Send");
        },
        onShield: () => {
          setShieldToken(swapToken);
          if (
            !hasUnlockedShieldedBalances &&
            !unlockShieldedBalancesFromReusableAuth()
          ) {
            openShieldedBalancesUnlockReview();
            return;
          }

          setShieldDirection("shield");
          openActionView({ type: "swapPanel", mode: "shield" }, "Shield");
        },
        onSwap: () => {
          setSwapFromToken(swapToken);
          openActionView({ type: "swapPanel", mode: "swap" }, "Swap");
        },
      };

      if (isLoyal) {
        actions.onBuy = () => {
          window.open(
            `https://jup.ag/tokens/${LOYL_TOKEN.mint}`,
            "_blank",
            "noopener,noreferrer"
          );
        };
      }

      return actions;
    },
    [
      hasUnlockedShieldedBalances,
      openActionView,
      openShieldedBalancesUnlockReview,
      unlockShieldedBalancesFromReusableAuth,
    ]
  );

  const handleTokenDetail = useCallback(
    (token: TokenRow) => {
      openActionView(
        { type: "tokenDetail", token, from: "portfolio" },
        token.symbol
      );
    },
    [openActionView]
  );

  const handleDisconnect = useCallback(async () => {
    await Promise.allSettled([logout(), disconnect()]);
  }, [disconnect, logout]);

  // After a regular send (not a vault multisig — that path triggers its own
  // refresh inside executeVaultTransfer), classify the recipient against the
  // smart-account overview so the right balance caches get invalidated:
  //   - If recipient is a known vault → pass accountIndex so the vault's
  //     portfolio cache is busted on the server side.
  //   - If recipient is a known signer → pass signerAddresses so its cache
  //     is invalidated.
  //   - Otherwise → just refresh the connected wallet + overview totals.
  const handleSendSuccess = useCallback(
    async ({ recipientAddress }: { recipientAddress: string }) => {
      const trimmed = recipientAddress.trim();
      if (!trimmed) {
        await smartAccountData.refreshAfterTx({});
        return;
      }

      const matchedVault = smartAccountData.overview?.vaults.find(
        (vault) => vault.address === trimmed
      );
      if (matchedVault) {
        await smartAccountData.refreshAfterTx({
          accountIndex: matchedVault.accountIndex,
        });
        return;
      }

      const overview = smartAccountData.overview;
      const matchedSigner =
        overview?.signers.find((signer) => signer.address === trimmed) ??
        overview?.vaults
          .flatMap((vault) => vault.signers ?? [])
          .find((signer) => signer.address === trimmed);
      if (matchedSigner) {
        await smartAccountData.refreshAfterTx({
          signerAddresses: [trimmed],
        });
        return;
      }

      await smartAccountData.refreshAfterTx({});
    },
    [smartAccountData]
  );

  const handleRailAction = useCallback(
    (action: WorkspaceAction) => {
      if (action === "shield") {
        handleOpenMainAccountShield();
        return;
      }

      const actionView =
        action === "receive"
          ? ({ type: "receivePanel" } as const)
          : action === "send"
          ? ({ type: "sendPanel" } as const)
          : ({ type: "swapPanel", mode: "swap" } as const);

      openActionView(actionView, actionLabels[action]);
    },
    [handleOpenMainAccountShield, openActionView]
  );

  const handleCommandCopyWalletAddress = useCallback(() => {
    if (!personalWalletAddress) return;

    void navigator.clipboard?.writeText(personalWalletAddress);
  }, [personalWalletAddress]);

  const handleCommandReceiveOrTopUp = useCallback(() => {
    if (activeDetailSelection === "wallet") {
      if (selectedSignerId && selectedAgent) {
        openActionView(
          { type: "sendPanel" },
          "Top Up",
          selectedAgent.address,
          "wallet"
        );
        return;
      }

      openActionView({ type: "receivePanel" }, "Receive", "", "wallet");
      return;
    }

    if (activeDetailSelection === "vault") {
      openActionView({ type: "receivePanel" }, "Receive", "", "vault");
    }
  }, [activeDetailSelection, openActionView, selectedAgent, selectedSignerId]);

  const handleCommandSend = useCallback(() => {
    if (activeDetailSelection === "vault") {
      openActionView({ type: "sendPanel" }, "Send", "", "vault");
      return;
    }

    openActionView({ type: "sendPanel" }, "Send", "", "wallet");
  }, [activeDetailSelection, openActionView]);

  const handleCommandSwap = useCallback(() => {
    openActionView({ type: "swapPanel", mode: "swap" }, "Swap", "", "wallet");
  }, [openActionView]);

  const handleCommandShield = useCallback(() => {
    handleOpenMainAccountShield();
  }, [handleOpenMainAccountShield]);

  const handleCommandShieldUsdc = useCallback(() => {
    const usdcToken = findTrackedUsdcToken(
      derivedTokens,
      trackedKaminoUsdcMint
    );

    if (!usdcToken) return;

    setShieldToken(usdcToken);

    if (
      !hasUnlockedShieldedBalances &&
      !unlockShieldedBalancesFromReusableAuth()
    ) {
      openShieldedBalancesUnlockReview();
      return;
    }

    setShieldDirection("shield");
    openActionView(
      { type: "swapPanel", mode: "shield" },
      "Shield",
      "",
      "wallet"
    );
  }, [
    derivedTokens,
    hasUnlockedShieldedBalances,
    openActionView,
    openShieldedBalancesUnlockReview,
    trackedKaminoUsdcMint,
    unlockShieldedBalancesFromReusableAuth,
  ]);

  const handleOpenEarn = useCallback(() => {
    markDetailPaneTransition("switch");
    setPendingEarnDepositDraft(null);
    setPendingEarnDepositPrepared(null);
    setEarnDepositReviewStage("deposit");
    setIsEarnDepositPolicySetupFlow(false);
    setEarnDepositPolicyStageSignatures({});
    setEarnDepositPrepareError(null);
    setProposalActionError(null);
    setPendingEarnWithdrawDraft(null);
    setPendingEarnWithdrawPrepared(null);
    setPendingEarnCleanupPrepared(null);
    setEarnWithdrawReviewStage("withdraw-0");
    setSelectedSignerId(null);
    setDetailSelection("earn");
    setSelectedDetail("Earn");
    setMobilePane("detail");
  }, [markDetailPaneTransition, setDetailSelection]);

  const handleOpenEarnDeposit = useCallback(() => {
    markDetailPaneTransition("forward");
    setPendingEarnDepositDraft(null);
    setPendingEarnDepositPrepared(null);
    setEarnDepositReviewStage("deposit");
    setIsEarnDepositPolicySetupFlow(false);
    setEarnDepositPolicyStageSignatures({});
    setEarnDepositPrepareError(null);
    setProposalActionError(null);
    setPendingEarnWithdrawDraft(null);
    setPendingEarnWithdrawPrepared(null);
    setPendingEarnCleanupPrepared(null);
    setEarnWithdrawReviewStage("withdraw-0");
    setSelectedSignerId(null);
    setDetailSelection("earnDeposit");
    setSelectedDetail("Deposit");
    setMobilePane("detail");
  }, [markDetailPaneTransition, setDetailSelection]);

  const handleOpenEarnWithdraw = useCallback(() => {
    markDetailPaneTransition("forward");
    setPendingEarnDepositDraft(null);
    setPendingEarnDepositPrepared(null);
    setEarnDepositReviewStage("deposit");
    setIsEarnDepositPolicySetupFlow(false);
    setEarnDepositPolicyStageSignatures({});
    setEarnDepositPrepareError(null);
    setProposalActionError(null);
    setPendingEarnWithdrawDraft(null);
    setPendingEarnWithdrawPrepared(null);
    setPendingEarnCleanupPrepared(null);
    setEarnWithdrawReviewStage("withdraw-0");
    setSelectedSignerId(null);
    setDetailSelection("earnWithdraw");
    setSelectedDetail("Withdraw");
    setMobilePane("detail");
  }, [markDetailPaneTransition, setDetailSelection]);

  const handleBackFromEarnWithdraw = useCallback(() => {
    markDetailPaneTransition("back");
    setPendingEarnWithdrawDraft(null);
    setPendingEarnWithdrawPrepared(null);
    setPendingEarnCleanupPrepared(null);
    setEarnWithdrawReviewStage("withdraw-0");
    setEarnDepositPrepareError(null);
    setProposalActionError(null);
    setSelectedSignerId(null);
    setDetailSelection("earn");
    setSelectedDetail("Earn");
    setMobilePane("detail");
  }, [markDetailPaneTransition, setDetailSelection]);

  const handleOpenAutodeposit = useCallback(() => {
    markDetailPaneTransition("forward");
    setEarnAutodepositSetupReviewStage("policy");
    setProposalActionError(null);
    setSelectedSignerId(null);
    setDetailSelection("earnAutodeposit");
    setSelectedDetail("Autodeposit");
    setMobilePane("detail");
  }, [markDetailPaneTransition, setDetailSelection]);

  const handleBackFromAutodeposit = useCallback(() => {
    markDetailPaneTransition("back");
    setPendingEarnAutodepositDraft(null);
    setPendingEarnAutodepositSetupPrepared(null);
    setPendingEarnAutodepositClosePrepared(null);
    setEarnAutodepositSetupReviewStage("policy");
    setIsEarnAutodepositCloseReview(false);
    setEarnDepositPrepareError(null);
    setProposalActionError(null);
    setSelectedSignerId(null);
    setDetailSelection("earn");
    setSelectedDetail("Earn");
    setMobilePane("detail");
  }, [markDetailPaneTransition, setDetailSelection]);

  const handleCloseConnectRequest = useCallback(() => {
    markDetailPaneTransition("close");
    setDetailSelection("vault");
  }, [markDetailPaneTransition, setDetailSelection]);

  const [proposalActionError, setProposalActionError] = useState<string | null>(
    null
  );
  const [isReconnectToSignOpen, setIsReconnectToSignOpen] = useState(false);
  const authenticatedWalletAddress = user?.walletAddress ?? null;
  const canSignAccountActions =
    Boolean(authenticatedWalletAddress) &&
    connectedWalletAddress === authenticatedWalletAddress;

  const requestReconnectToSign = useCallback(() => {
    if (!authenticatedWalletAddress) {
      openSignIn();
      return;
    }

    setProposalActionError(null);
    setIsReconnectToSignOpen(true);
  }, [authenticatedWalletAddress, openSignIn]);

  const ensureCanSignAccountAction = useCallback(() => {
    if (!authenticatedWalletAddress) {
      openSignIn();
      return false;
    }

    if (!canSignAccountActions) {
      requestReconnectToSign();
      return false;
    }

    return true;
  }, [
    authenticatedWalletAddress,
    canSignAccountActions,
    openSignIn,
    requestReconnectToSign,
  ]);

  const handleSaveAutodeposit = useCallback(
    async (keepAmount: string) => {
      if (!canMutateAccount) {
        openSignIn();
        return;
      }

      const source = earnDepositSources.find((entry) => entry.id === "main");
      if (!source) {
        setProposalActionError("Main Account USDC source is not loaded yet.");
        return;
      }

      const amount =
        autodepositConfig?.amount ?? DEFAULT_EARN_AUTODEPOSIT_AMOUNT_LABEL;
      const normalizedAmount = Number(amount.replace(/,/g, ""));
      const normalizedKeepAmount = Number(
        (keepAmount || "0").replace(/,/g, "")
      );
      if (!Number.isFinite(normalizedKeepAmount) || normalizedKeepAmount < 0) {
        setProposalActionError("Enter an Autodeposit minimum balance.");
        return;
      }

      let amountRaw: bigint;
      let keepAmountRaw: bigint;
      try {
        amountRaw = parseTokenAmountLabelToRaw(amount, source.decimals);
        keepAmountRaw = parseTokenAmountLabelToRaw(keepAmount, source.decimals);
      } catch (error) {
        setProposalActionError(
          error instanceof Error
            ? error.message.replaceAll("autodeposit", "Autodeposit")
            : "Enter valid Autodeposit amounts."
        );
        return;
      }

      const currentAmountRaw = autodepositConfig
        ? parseTokenAmountLabelToRaw(autodepositConfig.amount, source.decimals)
        : null;
      const currentKeepAmountRaw = autodepositConfig
        ? parseTokenAmountLabelToRaw(
            autodepositConfig.keepAmount,
            source.decimals
          )
        : null;
      const amountChanged =
        currentAmountRaw === null || amountRaw !== currentAmountRaw;
      const keepAmountChanged =
        currentKeepAmountRaw === null || keepAmountRaw !== currentKeepAmountRaw;

      const autodepositCanUseFloorUpdate =
        autodepositConfig?.state === "created" ||
        autodepositConfig?.state === "paused";
      const autodepositIsPendingSetup =
        autodepositConfig?.state === "creating" &&
        Boolean(autodepositConfig.policyAccount);

      if (
        autodepositConfig &&
        !autodepositIsPendingSetup &&
        !amountChanged &&
        !keepAmountChanged
      ) {
        setProposalActionError("No Autodeposit changes to save.");
        return;
      }

      setProposalActionError(null);
      setPendingEarnAutodepositSetupPrepared(null);
      setPendingEarnAutodepositClosePrepared(null);
      setEarnAutodepositSetupReviewStage("policy");
      setIsEarnAutodepositCloseReview(false);

      if (
        autodepositCanUseFloorUpdate &&
        autodepositConfig &&
        !amountChanged &&
        keepAmountChanged
      ) {
        if (
          !autodepositConfig.policyAccount ||
          !autodepositConfig.recurringDelegation
        ) {
          setProposalActionError("Autodeposit account metadata is missing.");
          return;
        }

        setAutodepositConfig({ ...autodepositConfig, state: "creating" });
        const result = await smartAccountData.executeEarnAutodepositFloorUpdate(
          {
            policyAccount: autodepositConfig.policyAccount,
            recurringDelegation: autodepositConfig.recurringDelegation,
            walletBalanceFloorRaw: keepAmountRaw,
          }
        );

        if (!result.success) {
          setAutodepositConfig({ ...autodepositConfig, state: "created" });
          setProposalActionError(
            result.error ?? "Autodeposit wallet balance floor update failed."
          );
          return;
        }

        setAutodepositConfig({
          ...autodepositConfig,
          keepAmount,
          scheduledSweeps: result.scheduledSweeps ?? [],
          state: "created",
        });
        invalidateEarnClientCaches();
        markDetailPaneTransition("back");
        setSelectedSignerId(null);
        setDetailSelection("earn");
        setSelectedDetail("Earn");
        return;
      }

      setPendingEarnAutodepositDraft({
        amount: normalizedAmount,
        amountChanged,
        amountLabel: amount,
        existingPolicySeed:
          autodepositConfig?.policySeed ?? autodepositConfig?.nonce,
        existingRecurringDelegation: autodepositConfig?.recurringDelegation,
        expiryTimestamp: parseOptionalUnsignedBigInt(
          autodepositConfig?.expiryTimestamp
        ),
        keepAmount: normalizedKeepAmount,
        keepAmountChanged,
        keepAmountLabel: keepAmount,
        nonce:
          parseOptionalUnsignedBigInt(autodepositConfig?.setupNonce) ??
          BigInt(Date.now()),
        periodLengthSeconds: parseOptionalUnsignedBigInt(
          autodepositConfig?.periodLengthSeconds
        ),
        requiresSignature:
          !autodepositCanUseFloorUpdate ||
          autodepositIsPendingSetup ||
          amountChanged,
        source,
        startTimestamp: parseOptionalUnsignedBigInt(
          autodepositConfig?.startTimestamp
        ),
        symbol: "USDC",
        tokenDecimals: source.decimals,
      });
    },
    [
      autodepositConfig,
      canMutateAccount,
      earnDepositSources,
      invalidateEarnClientCaches,
      markDetailPaneTransition,
      openSignIn,
      setDetailSelection,
      smartAccountData,
    ]
  );

  const handleDismissEarnAutodepositPreview = useCallback(() => {
    setPendingEarnAutodepositDraft(null);
    setPendingEarnAutodepositSetupPrepared(null);
    setPendingEarnAutodepositClosePrepared(null);
    setEarnAutodepositSetupReviewStage("policy");
    setAutodepositConfig((current) =>
      current?.state === "closing"
        ? { ...current, state: "created" }
        : current?.state === "creating" && !current.policyAccount
        ? null
        : current
    );
    setIsEarnAutodepositCloseReview(false);
    setProposalActionError(null);
  }, []);

  const handleOpenAutodepositCloseReview = useCallback(() => {
    if (
      !autodepositConfig ||
      (autodepositConfig.state !== "created" &&
        autodepositConfig.state !== "paused")
    ) {
      return;
    }
    setAutodepositConfig({ ...autodepositConfig, state: "closing" });
    setPendingEarnAutodepositDraft(null);
    setPendingEarnAutodepositSetupPrepared(null);
    setPendingEarnAutodepositClosePrepared(null);
    setIsEarnAutodepositCloseReview(true);
    markDetailPaneTransition("forward");
    setSelectedSignerId(null);
    setDetailSelection("earnAutodeposit");
    setSelectedDetail("Autodeposit");
  }, [autodepositConfig, markDetailPaneTransition, setDetailSelection]);

  const handleDisableAutodeposit = useCallback(async () => {
    if (!autodepositConfig) {
      return;
    }
    if (
      autodepositConfig.state !== "created" &&
      autodepositConfig.state !== "paused"
    ) {
      return;
    }
    if (
      autodepositConfig.policyAccount.length === 0 ||
      autodepositConfig.recurringDelegation.length === 0
    ) {
      setProposalActionError("Autodeposit account metadata is missing.");
      return;
    }

    const previousState = autodepositConfig.state;
    const nextActive = previousState === "paused";
    setProposalActionError(null);
    // Optimistic transient state: the switch flips and spins right away
    // while the on-chain toggle confirms; revert on failure.
    setAutodepositConfig({
      ...autodepositConfig,
      state: nextActive ? "resuming" : "pausing",
    });

    const result = await smartAccountData.executeEarnAutodepositToggle({
      active: nextActive,
      policyAccount: autodepositConfig.policyAccount,
      recurringDelegation: autodepositConfig.recurringDelegation,
    });

    if (!result.success) {
      setAutodepositConfig({ ...autodepositConfig, state: previousState });
      setProposalActionError(
        result.error ?? "Autodeposit active state update failed."
      );
      return;
    }

    setAutodepositConfig({
      ...autodepositConfig,
      state: nextActive ? "created" : "paused",
    });
  }, [autodepositConfig, smartAccountData]);

  const handleExecuteScheduledAutodepositSweep = useCallback(
    async (sweep?: LoadedEarnAutodepositScheduledSweep) => {
      if (isExecutingScheduledSweep) {
        return;
      }

      setIsExecutingScheduledSweep(true);
      setScheduledSweepExecuteError(null);

      try {
        const response = await fetch(
          "/api/smart-accounts/yield-optimization/autodeposit/sweeps/execute",
          {
            body: JSON.stringify({
              slotId: sweep?.slotId ?? sweep?.id ?? null,
            }),
            credentials: "include",
            headers: {
              "content-type": "application/json",
            },
            method: "POST",
          }
        );

        if (!response.ok) {
          throw new Error(await parseEarnAutodepositExecuteError(response));
        }

        invalidateEarnClientCaches();
        await smartAccountData.refresh();
      } catch (error) {
        setScheduledSweepExecuteError(
          error instanceof Error
            ? error.message.replaceAll("autodeposit", "Autodeposit")
            : "Failed to request immediate Autodeposit execution."
        );
      } finally {
        setIsExecutingScheduledSweep(false);
      }
    },
    [invalidateEarnClientCaches, isExecutingScheduledSweep, smartAccountData]
  );

  const handleDeleteAutodeposit = useCallback(() => {
    handleOpenAutodepositCloseReview();
  }, [handleOpenAutodepositCloseReview]);

  const handleDismissEarnDepositPreview = useCallback(() => {
    setPendingEarnDepositDraft(null);
    setPendingEarnDepositPrepared(null);
    setEarnDepositReviewStage("deposit");
    setIsEarnDepositPolicySetupFlow(false);
    setEarnDepositPolicyStageSignatures({});
    setEarnDepositPrepareError(null);
    setProposalActionError(null);
  }, []);

  const handleDismissEarnWithdrawPreview = useCallback(() => {
    setPendingEarnWithdrawDraft(null);
    setPendingEarnWithdrawPrepared(null);
    setPendingEarnCleanupPrepared(null);
    setEarnWithdrawReviewStage("withdraw-0");
    setEarnDepositPrepareError(null);
    setProposalActionError(null);
  }, []);

  const handleEarnWithdrawDraftChange = useCallback(
    (draft: EarnWithdrawDraft | null) => {
      setPendingEarnWithdrawDraft(draft);
      setPendingEarnWithdrawPrepared(null);
      setPendingEarnCleanupPrepared(null);
      setEarnWithdrawReviewStage("withdraw-0");
      setEarnDepositPrepareError(null);
      setProposalActionError(null);
    },
    []
  );

  const prepareEarnDepositInBrowser = useCallback(
    async (
      draft: EarnDepositDraft
    ): Promise<SmartAccountPreparedEarnUsdcDeposit> => {
      const overview = smartAccountData.overview;
      const walletAddress = personalWalletAddress;
      const policySignerPublicKey = smartAccountData.earnPolicySignerPublicKey;

      if (!overview || !walletAddress) {
        throw new Error("Smart-account overview is not loaded yet.");
      }
      if (!smartAccountData.hasEarnStateResolved) {
        throw new Error("Earn state is still loading. Try again in a moment.");
      }
      if (!policySignerPublicKey) {
        throw new Error("Earn policy signer metadata is not loaded yet.");
      }

      const amountRaw = parseTokenAmountLabelToRaw(
        draft.amountLabel,
        draft.tokenDecimals
      );
      const cluster = resolveLoyalClusterForSolanaEnv(
        resolveSolanaEnv(publicEnv.solanaEnv)
      );
      const settingsPda = new PublicKey(overview.settingsPda);
      const userWallet = new PublicKey(walletAddress);
      const policy = smartAccountData.earnPolicy;
      const onboarding = smartAccountData.earnOnboarding;
      const canResumeOnboardingPreparation =
        !policy &&
        (onboarding?.nextStep === "setup_policy" ||
          onboarding?.nextStep === "deposit");
      const onboardingPolicy =
        canResumeOnboardingPreparation &&
        onboarding?.policy?.lastSeenSignature &&
        onboarding.policy.lastSeenSlot
          ? onboarding.policy
          : null;
      const routePolicy = policy ?? onboardingPolicy;
      const routeSetupPolicy =
        policy?.setupPolicy ??
        (onboardingPolicy &&
        onboarding?.setupPolicy?.lastSeenSignature &&
        onboarding.setupPolicy.lastSeenSlot
          ? onboarding.setupPolicy
          : null);
      const shouldPrepareSetupPolicy =
        Boolean(routePolicy) && !routeSetupPolicy;
      const yieldRoutingPolicy: EarnDepositYieldRoutingPolicy | undefined =
        routePolicy
          ? {
              account: new PublicKey(routePolicy.account),
              seed: BigInt(routePolicy.seed),
              ...(routeSetupPolicy
                ? {
                    setupPolicy: {
                      account: new PublicKey(routeSetupPolicy.account),
                      seed: BigInt(routeSetupPolicy.seed),
                    },
                  }
                : {}),
              ...(shouldPrepareSetupPolicy ? { prepareSetupPolicy: true } : {}),
            }
          : undefined;
      const target = yieldRoutingPolicy
        ? resolveActiveEarnDepositTarget(activeEarnPosition)
        : null;
      const client = createSmartAccountVaultsClient({
        connection,
        programId: new PublicKey(overview.programId),
      });

      return client.prepareEarnUsdcDeposit({
        amountRaw,
        cluster,
        feePayer: userWallet,
        initializeYieldRoutingPolicy: !yieldRoutingPolicy,
        policySigner: new PublicKey(policySignerPublicKey),
        settingsPda,
        walletAddress: userWallet,
        ...(target ? { target } : {}),
        ...(yieldRoutingPolicy ? { yieldRoutingPolicy } : {}),
      });
    },
    [
      activeEarnPosition,
      connection,
      publicEnv.solanaEnv,
      smartAccountData.earnOnboarding,
      smartAccountData.earnPolicy,
      smartAccountData.earnPolicySignerPublicKey,
      smartAccountData.hasEarnStateResolved,
      smartAccountData.overview,
      personalWalletAddress,
    ]
  );

  const prepareEarnWithdrawInBrowser = useCallback(
    async (
      draft: EarnWithdrawDraft,
      options: { autodepositCloseAlreadyCompleted?: boolean } = {}
    ): Promise<SmartAccountPreparedEarnUsdcWithdraw> => {
      const overview = smartAccountData.overview;
      const policy = smartAccountData.earnPolicy;
      const walletAddress = personalWalletAddress;

      if (!overview || !walletAddress) {
        throw new Error("Smart-account overview is not loaded yet.");
      }
      if (!policy) {
        throw new Error("Active Earn policy metadata is required to withdraw.");
      }

      const policySigner = policy.delegatedSigners[0];
      if (!policySigner) {
        throw new Error("Active Earn policy is missing its delegated signer.");
      }

      const source = toEarnWithdrawVaultsSource(draft.source);
      const requestedAmountRaw = getEarnWithdrawDraftAmountRaw(draft);
      const effectiveAmountRaw =
        draft.mode === "full" ? source.amountRaw : requestedAmountRaw;
      const cluster = resolveLoyalClusterForSolanaEnv(
        resolveSolanaEnv(publicEnv.solanaEnv)
      );
      const settingsPda = new PublicKey(overview.settingsPda);
      const userWallet = new PublicKey(walletAddress);
      const target =
        draft.source.type === "reserve"
          ? toEarnWithdrawReserveTarget(draft.source)
          : null;
      const totalLiveAmountRaw =
        getEarnPositionTotalAmountRaw(activeEarnPosition);
      const isFinalExit =
        draft.source.type === "idle" &&
        draft.mode === "full" &&
        totalLiveAmountRaw > BigInt(0) &&
        effectiveAmountRaw >= totalLiveAmountRaw;
      const autodepositClose =
        draft.mode === "full" &&
        isFinalExit &&
        !options.autodepositCloseAlreadyCompleted &&
        smartAccountData.earnAutodeposit?.policyAccount &&
        smartAccountData.earnAutodeposit.recurringDelegation
          ? {
              policy: new PublicKey(
                smartAccountData.earnAutodeposit.policyAccount
              ),
              recurringDelegation: new PublicKey(
                smartAccountData.earnAutodeposit.recurringDelegation
              ),
            }
          : undefined;
      const client = createSmartAccountVaultsClient({
        connection,
        programId: new PublicKey(overview.programId),
      });
      const yieldRoutingPolicy = {
        account: new PublicKey(policy.account),
        seed: BigInt(policy.seed),
        setupPolicy: policy.setupPolicy
          ? {
              account: new PublicKey(policy.setupPolicy.account),
              seed: BigInt(policy.setupPolicy.seed),
            }
          : null,
      };
      const withdrawInput = {
        amountRaw: effectiveAmountRaw,
        closePoliciesOnFullWithdrawal: isFinalExit,
        cluster,
        feePayer: userWallet,
        policySigner: new PublicKey(policySigner),
        settingsPda,
        source,
        ...(target ? { target } : {}),
        ...(draft.mode === "full" && target
          ? { fullWithdrawalTargets: [target] }
          : {}),
        walletAddress: userWallet,
        yieldRoutingPolicy,
      };

      return draft.mode === "full"
        ? client.prepareEarnUsdcWithdraw({
            ...withdrawInput,
            ...(autodepositClose ? { autodepositClose } : {}),
            mode: "full",
          })
        : client.prepareEarnUsdcWithdraw({
            ...withdrawInput,
            mode: "partial",
          });
    },
    [
      activeEarnPosition,
      connection,
      getEarnWithdrawDraftAmountRaw,
      publicEnv.solanaEnv,
      smartAccountData.earnAutodeposit,
      smartAccountData.earnPolicy,
      smartAccountData.overview,
      personalWalletAddress,
    ]
  );

  const handleDismissFocusedEarnPreview = useCallback(() => {
    if (isShieldedBalancesUnlockReviewOpen) {
      dismissShieldedBalancesUnlockReview();
      return;
    }

    if (pendingRootSignerDraft) {
      setPendingRootSignerDraft(null);
      setProposalActionError(null);
      return;
    }

    if (pendingRootSignerRemovalDraft) {
      setPendingRootSignerRemovalDraft(null);
      setProposalActionError(null);
      return;
    }

    if (pendingEarnDepositDraft && isEarnDepositDetailActive) {
      handleDismissEarnDepositPreview();
      return;
    }

    if (
      (pendingEarnWithdrawDraft || pendingEarnCleanupPrepared) &&
      detailSelection === "earnWithdraw"
    ) {
      handleDismissEarnWithdrawPreview();
      return;
    }

    if (
      (pendingEarnAutodepositDraft || isEarnAutodepositCloseReview) &&
      detailSelection === "earnAutodeposit"
    ) {
      handleDismissEarnAutodepositPreview();
    }
  }, [
    detailSelection,
    dismissShieldedBalancesUnlockReview,
    handleDismissEarnAutodepositPreview,
    handleDismissEarnDepositPreview,
    handleDismissEarnWithdrawPreview,
    isEarnDepositDetailActive,
    isEarnAutodepositCloseReview,
    isShieldedBalancesUnlockReviewOpen,
    pendingEarnAutodepositDraft,
    pendingEarnCleanupPrepared,
    pendingEarnDepositDraft,
    pendingEarnWithdrawDraft,
    pendingRootSignerRemovalDraft,
    pendingRootSignerDraft,
  ]);

  const handleEarnPreviewBackdropPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.target !== event.currentTarget) {
        return;
      }

      handleDismissFocusedEarnPreview();
    },
    [handleDismissFocusedEarnPreview]
  );

  const handleEarnDepositFormDraftChange = useCallback(
    (draft: EarnDepositDraft | null) => {
      const nextReview = applyEarnDepositFormDraftChange(
        {
          draft: pendingEarnDepositDraft,
          isPolicySetupFlow: isEarnDepositPolicySetupFlow,
          preparedDeposit: pendingEarnDepositPrepared,
          stage: earnDepositReviewStage,
        },
        draft
      );

      if (
        nextReview.draft === pendingEarnDepositDraft &&
        nextReview.isPolicySetupFlow === isEarnDepositPolicySetupFlow &&
        nextReview.preparedDeposit === pendingEarnDepositPrepared &&
        nextReview.stage === earnDepositReviewStage
      ) {
        return;
      }

      setPendingEarnDepositDraft(nextReview.draft);
      setPendingEarnDepositPrepared(nextReview.preparedDeposit);
      setIsEarnDepositPolicySetupFlow(nextReview.isPolicySetupFlow);
      setEarnDepositReviewStage(nextReview.stage);
      setEarnDepositPolicyStageSignatures({});
      setProposalActionError(null);
      setEarnDepositPrepareError(null);
    },
    [
      earnDepositReviewStage,
      isEarnDepositPolicySetupFlow,
      pendingEarnDepositDraft,
      pendingEarnDepositPrepared,
    ]
  );

  const handleSubmitEarnDepositDraft = useCallback(
    async (draft: EarnDepositDraft) => {
      if (!canMutateAccount) {
        openSignIn();
        return;
      }

      const requiresPolicySetup =
        smartAccountData.requiresEarnPolicySetupForDeposit;
      setProposalActionError(null);
      setEarnDepositPrepareError(null);
      setPendingEarnDepositPrepared(null);
      setEarnDepositPolicyStageSignatures({});

      try {
        setIsEarnDepositPreparePending(true);
        const amountRaw = parseTokenAmountLabelToRaw(
          draft.amountLabel,
          draft.tokenDecimals
        );
        const preparedDeposit = await prepareEarnDepositInBrowser(draft);
        const shouldBypassTopUpPreview =
          hasEarnPosition &&
          !requiresPolicySetup &&
          !preparedDeposit.policySetupPrepared &&
          !preparedDeposit.policyFinalizePrepared;

        if (shouldBypassTopUpPreview) {
          if (!ensureCanSignAccountAction()) {
            return;
          }

          setIsEarnAutoSigning(true);
          const result = await smartAccountData.executeEarnDeposit({
            amountRaw,
            preparedDeposit,
            recordConfirmationAsync: true,
          });

          if (!result.success) {
            throw new Error(result.error ?? "Earn deposit failed.");
          }

          markDetailPaneTransition("back");
          setPendingEarnDepositDraft(null);
          setPendingEarnDepositPrepared(null);
          setEarnDepositReviewStage("deposit");
          setIsEarnDepositPolicySetupFlow(false);
          setEarnDepositPolicyStageSignatures({});
          invalidateEarnClientCaches();
          setActiveEarnPosition((current) =>
            buildPostDepositEarnPosition({
              amountRaw,
              confirmedSlot: result.confirmedSlot,
              current,
              preparedDeposit,
            })
          );
          debitMainAccountUsdcBalance(amountRaw);
          suppressEarnSubscriptionRefreshThroughSlot(result.confirmedSlot);
          setSelectedSignerId(null);
          setDetailSelection("earn");
          setSelectedDetail("Earn");
          return;
        }

        const nextReview = createSubmittedEarnDepositReviewState({
          draft,
          preparedDeposit,
          requiresPolicySetup:
            requiresPolicySetup || Boolean(preparedDeposit.policySetupPrepared),
        });
        setPendingEarnDepositDraft(nextReview.draft);
        setPendingEarnDepositPrepared(nextReview.preparedDeposit);
        setIsEarnDepositPolicySetupFlow(nextReview.isPolicySetupFlow);
        setEarnDepositReviewStage(nextReview.stage);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to prepare Earn deposit.";
        setEarnDepositPrepareError(message);
      } finally {
        setIsEarnAutoSigning(false);
        setIsEarnDepositPreparePending(false);
      }
    },
    [
      debitMainAccountUsdcBalance,
      canMutateAccount,
      ensureCanSignAccountAction,
      hasEarnPosition,
      invalidateEarnClientCaches,
      markDetailPaneTransition,
      openSignIn,
      prepareEarnDepositInBrowser,
      setActiveEarnPosition,
      setDetailSelection,
      suppressEarnSubscriptionRefreshThroughSlot,
      smartAccountData,
    ]
  );

  const handleSubmitEarnWithdrawDraft = useCallback(
    async (draft: EarnWithdrawDraft) => {
      setProposalActionError(null);
      setEarnDepositPrepareError(null);
      setPendingEarnWithdrawPrepared(null);
      setPendingEarnCleanupPrepared(null);
      setEarnWithdrawReviewStage("withdraw-0");

      try {
        setIsEarnWithdrawPreparePending(true);
        const amountRaw = getEarnWithdrawDraftAmountRaw(draft);
        const preparedWithdraw = await prepareEarnWithdrawInBrowser(draft);
        const shouldBypassWithdrawPreview =
          draft.mode === "partial" &&
          !preparedWithdraw.autodepositClosePrepared;

        if (shouldBypassWithdrawPreview) {
          if (!ensureCanSignAccountAction()) {
            return;
          }

          setIsEarnAutoSigning(true);
          const stepCount = Math.max(1, preparedWithdraw.withdrawSteps.length);
          let latestConfirmedSlot: string | undefined;
          for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
            const result = await smartAccountData.executeEarnWithdraw({
              amountRaw,
              mode: draft.mode,
              onConfirmationRecorded: invalidateEarnClientCaches,
              preparedWithdraw,
              recordConfirmationAsync: stepIndex === stepCount - 1,
              stepIndex,
            });

            if (!result.success) {
              throw new Error(result.error ?? "Earn withdrawal failed.");
            }
            latestConfirmedSlot = result.confirmedSlot ?? latestConfirmedSlot;
          }

          markDetailPaneTransition("back");
          invalidateEarnClientCaches();
          setPendingEarnWithdrawDraft(null);
          setPendingEarnWithdrawPrepared(null);
          setPendingEarnCleanupPrepared(null);
          setEarnWithdrawReviewStage("withdraw-0");
          setActiveEarnPosition((current) =>
            applySubmittedEarnWithdrawToPosition({
              amountRaw,
              current,
              draft,
            })
          );
          creditMainAccountUsdcBalance(amountRaw);
          suppressEarnSubscriptionRefreshThroughSlot(latestConfirmedSlot);
          setSelectedSignerId(null);
          setDetailSelection("earn");
          setSelectedDetail("Earn");
          return;
        }

        setPendingEarnWithdrawDraft(draft);
        setPendingEarnWithdrawPrepared(preparedWithdraw);
        setPendingEarnCleanupPrepared(null);
        setEarnWithdrawReviewStage(
          preparedWithdraw.autodepositClosePrepared
            ? "autodeposit"
            : "withdraw-0"
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to prepare Earn withdrawal.";
        setProposalActionError(message);
        setEarnDepositPrepareError(message);
      } finally {
        setIsEarnAutoSigning(false);
        setIsEarnWithdrawPreparePending(false);
      }
    },
    [
      creditMainAccountUsdcBalance,
      ensureCanSignAccountAction,
      getEarnWithdrawDraftAmountRaw,
      invalidateEarnClientCaches,
      markDetailPaneTransition,
      prepareEarnWithdrawInBrowser,
      setActiveEarnPosition,
      setDetailSelection,
      suppressEarnSubscriptionRefreshThroughSlot,
      smartAccountData,
    ]
  );

  const handleSubmitEarnCleanup = useCallback(async () => {
    setProposalActionError(null);
    setEarnDepositPrepareError(null);
    setPendingEarnWithdrawDraft(null);
    setPendingEarnWithdrawPrepared(null);
    setPendingEarnCleanupPrepared(null);
    setEarnWithdrawReviewStage("withdraw-0");

    try {
      setIsEarnWithdrawPreparePending(true);
      const preparedCleanup = await prepareEarnCleanupOnServer();
      setPendingEarnCleanupPrepared(preparedCleanup);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to prepare Earn cleanup.";
      setProposalActionError(message);
      setEarnDepositPrepareError(message);
    } finally {
      setIsEarnWithdrawPreparePending(false);
    }
  }, []);

  const handleContinueEarnDepositReview = useCallback(async () => {
    if (!pendingEarnDepositDraft) {
      setProposalActionError("Enter a deposit amount before continuing.");
      return;
    }

    if (!ensureCanSignAccountAction()) {
      return;
    }

    setProposalActionError(null);
    setEarnDepositPrepareError(null);
    setIsEarnAutoSigning(true);
    try {
      if (!pendingEarnDepositPrepared) {
        throw new Error(
          "Prepare the Earn deposit again before signing this transaction."
        );
      }

      let stage = earnDepositReviewStage;
      let stageSignatures: EarnDepositPolicyStageSignatures = {
        ...earnDepositPolicyStageSignatures,
      };
      const amountRaw = parseTokenAmountLabelToRaw(
        pendingEarnDepositDraft.amountLabel,
        pendingEarnDepositDraft.tokenDecimals
      );

      if (stage === "policy" || stage === "policy-finalize") {
        const batchResult = await smartAccountData.executeEarnDepositBatch({
          amountRaw,
          preparedDeposit: pendingEarnDepositPrepared,
          startStage: stage,
          ...stageSignatures,
        });

        if (!batchResult.batchUnavailable) {
          stageSignatures = {
            ...stageSignatures,
            ...(batchResult.policyConfirmedSlot && batchResult.policySignature
              ? {
                  policyConfirmedSlot: batchResult.policyConfirmedSlot,
                  policySignature: batchResult.policySignature,
                }
              : {}),
            ...(batchResult.setupPolicyConfirmedSlot &&
            batchResult.setupPolicySignature
              ? {
                  setupPolicyConfirmedSlot:
                    batchResult.setupPolicyConfirmedSlot,
                  setupPolicySignature: batchResult.setupPolicySignature,
                }
              : {}),
          };
          setEarnDepositPolicyStageSignatures(stageSignatures);

          if (!batchResult.success) {
            if (batchResult.resumeStage) {
              setEarnDepositReviewStage(batchResult.resumeStage);
            }
            throw new Error(batchResult.error ?? "Earn deposit failed.");
          }

          markDetailPaneTransition("back");
          setPendingEarnDepositDraft(null);
          setPendingEarnDepositPrepared(null);
          setEarnDepositReviewStage("deposit");
          setIsEarnDepositPolicySetupFlow(false);
          setEarnDepositPolicyStageSignatures({});
          setEarnDepositPrepareError(null);
          invalidateEarnClientCaches();
          setActiveEarnPosition((current) => {
            return buildPostDepositEarnPosition({
              amountRaw,
              confirmedSlot: batchResult.confirmedSlot,
              current,
              preparedDeposit: pendingEarnDepositPrepared,
            });
          });
          debitMainAccountUsdcBalance(amountRaw);
          suppressEarnSubscriptionRefreshThroughSlot(batchResult.confirmedSlot);
          setSelectedSignerId(null);
          setDetailSelection("earn");
          setSelectedDetail("Earn");
          return;
        }
      }

      for (;;) {
        setEarnDepositReviewStage(stage);
        setDetailSelection("earnDeposit");
        setSelectedDetail("Deposit");

        if (stage === "policy" || stage === "policy-finalize") {
          const result = await smartAccountData.executeEarnDepositPolicyStage({
            preparedDeposit: pendingEarnDepositPrepared,
            stage,
          });
          if (!result.success) {
            throw new Error(result.error ?? "Earn policy approval failed.");
          }

          if (result.signature && result.confirmedSlot) {
            stageSignatures =
              stage === "policy"
                ? {
                    ...stageSignatures,
                    policyConfirmedSlot: result.confirmedSlot,
                    policySignature: result.signature,
                  }
                : {
                    ...stageSignatures,
                    setupPolicyConfirmedSlot: result.confirmedSlot,
                    setupPolicySignature: result.signature,
                  };
            setEarnDepositPolicyStageSignatures(stageSignatures);
          }

          const nextReview = advanceEarnDepositReviewStage({
            draft: pendingEarnDepositDraft,
            isPolicySetupFlow: isEarnDepositPolicySetupFlow,
            preparedDeposit: pendingEarnDepositPrepared,
            stage,
          });
          if (nextReview.stage === stage) {
            throw new Error("Earn deposit approval flow did not advance.");
          }
          setPendingEarnDepositDraft(nextReview.draft);
          setPendingEarnDepositPrepared(nextReview.preparedDeposit);
          setIsEarnDepositPolicySetupFlow(nextReview.isPolicySetupFlow);
          stage = nextReview.stage;
          setEarnDepositReviewStage(stage);
          continue;
        }

        const result = await smartAccountData.executeEarnDeposit({
          amountRaw,
          ...stageSignatures,
          preparedDeposit: pendingEarnDepositPrepared,
        });

        if (!result.success) {
          throw new Error(result.error ?? "Earn deposit failed.");
        }

        markDetailPaneTransition("back");
        setPendingEarnDepositDraft(null);
        setPendingEarnDepositPrepared(null);
        setEarnDepositReviewStage("deposit");
        setIsEarnDepositPolicySetupFlow(false);
        setEarnDepositPolicyStageSignatures({});
        setEarnDepositPrepareError(null);
        invalidateEarnClientCaches();
        setActiveEarnPosition((current) => {
          return buildPostDepositEarnPosition({
            amountRaw,
            confirmedSlot: result.confirmedSlot,
            current,
            preparedDeposit: pendingEarnDepositPrepared,
          });
        });
        debitMainAccountUsdcBalance(amountRaw);
        suppressEarnSubscriptionRefreshThroughSlot(result.confirmedSlot);
        setSelectedSignerId(null);
        setDetailSelection("earn");
        setSelectedDetail("Earn");
        break;
      }
    } catch (error) {
      const raw =
        error instanceof Error ? error.message : "Earn deposit failed.";
      const haystack = raw.toLowerCase();
      const isRentError =
        haystack.includes("insufficient funds for rent") ||
        haystack.includes("insufficient lamports") ||
        haystack.includes("would result in account being unable to pay rent");
      setProposalActionError(
        isRentError && !haystack.includes("top up")
          ? "Stash must keep a minimum SOL balance for rent. Try a smaller amount."
          : raw
      );
      setEarnDepositPrepareError(raw);
    } finally {
      setIsEarnAutoSigning(false);
    }
  }, [
    earnDepositPolicyStageSignatures,
    earnDepositReviewStage,
    ensureCanSignAccountAction,
    isEarnDepositPolicySetupFlow,
    debitMainAccountUsdcBalance,
    markDetailPaneTransition,
    pendingEarnDepositDraft,
    pendingEarnDepositPrepared,
    setActiveEarnPosition,
    setDetailSelection,
    suppressEarnSubscriptionRefreshThroughSlot,
    invalidateEarnClientCaches,
    smartAccountData,
  ]);

  const handleContinueEarnWithdrawReview = useCallback(async () => {
    if (!pendingEarnWithdrawDraft) {
      setProposalActionError("Enter a withdrawal amount before continuing.");
      return;
    }

    if (!ensureCanSignAccountAction()) {
      return;
    }

    setProposalActionError(null);
    setEarnDepositPrepareError(null);
    setIsEarnAutoSigning(true);
    try {
      let stage = earnWithdrawReviewStage;
      let preparedWithdraw = pendingEarnWithdrawPrepared;
      const amountRaw = getEarnWithdrawDraftAmountRaw(pendingEarnWithdrawDraft);

      for (;;) {
        setEarnWithdrawReviewStage(stage);
        setDetailSelection("earnWithdraw");
        setSelectedDetail("Withdraw");

        if (stage === "autodeposit") {
          const preparedClose =
            preparedWithdraw?.autodepositClosePrepared ?? null;
          if (!preparedClose) {
            throw new Error("Prepare the Autodeposit close before signing.");
          }

          const result = await smartAccountData.executeEarnAutodepositClose({
            policy: preparedClose.policy.account.toBase58(),
            preparedClose,
            recurringDelegation:
              preparedClose.subscription.recurringDelegation.toBase58(),
          });

          if (!result.success) {
            throw new Error(result.error ?? "Autodeposit close failed.");
          }

          setAutodepositConfig(null);
          setIsEarnWithdrawPreparePending(true);
          const nextPreparedWithdraw = await prepareEarnWithdrawInBrowser(
            pendingEarnWithdrawDraft,
            { autodepositCloseAlreadyCompleted: true }
          );
          setIsEarnWithdrawPreparePending(false);
          if (nextPreparedWithdraw.autodepositClosePrepared) {
            throw new Error(
              "Autodeposit close was confirmed, but the refreshed Earn action still includes an Autodeposit close. Review it again before signing."
            );
          }
          preparedWithdraw = nextPreparedWithdraw;
          setPendingEarnCleanupPrepared(null);
          setPendingEarnWithdrawPrepared(nextPreparedWithdraw);
          stage = "withdraw-0";
          setEarnWithdrawReviewStage(stage);
          continue;
        }

        const stepIndex = Number(stage.replace("withdraw-", "")) || 0;
        if (!preparedWithdraw) {
          throw new Error("Prepare the Earn withdrawal before signing.");
        }

        const result = await smartAccountData.executeEarnWithdraw({
          amountRaw,
          autodepositCloseAlreadyCompleted:
            pendingEarnWithdrawDraft.mode === "full",
          mode: pendingEarnWithdrawDraft.mode,
          onConfirmationRecorded: invalidateEarnClientCaches,
          preparedWithdraw,
          recordConfirmationAsync:
            pendingEarnWithdrawDraft.mode === "partial" &&
            stepIndex === preparedWithdraw.withdrawSteps.length - 1,
          stepIndex,
        });

        if (!result.success) {
          throw new Error(result.error ?? "Earn withdrawal failed.");
        }

        const nextStage = getNextEarnWithdrawReviewStage({
          currentStage: stage,
          hasAutodepositTeardown: Boolean(
            preparedWithdraw?.autodepositClosePrepared
          ),
          preparedWithdraw,
        });
        if (nextStage) {
          stage = nextStage;
          setEarnWithdrawReviewStage(stage);
          continue;
        }

        markDetailPaneTransition("back");
        invalidateEarnClientCaches();
        setPendingEarnWithdrawDraft(null);
        setPendingEarnWithdrawPrepared(null);
        setPendingEarnCleanupPrepared(null);
        setEarnWithdrawReviewStage("withdraw-0");
        setActiveEarnPosition((current) =>
          applySubmittedEarnWithdrawToPosition({
            amountRaw,
            current,
            draft: pendingEarnWithdrawDraft,
          })
        );
        if (pendingEarnWithdrawDraft.mode === "partial") {
          creditMainAccountUsdcBalance(amountRaw);
          suppressEarnSubscriptionRefreshThroughSlot(result.confirmedSlot);
        }
        setSelectedSignerId(null);
        setDetailSelection("earn");
        setSelectedDetail("Earn");
        if (pendingEarnWithdrawDraft.mode !== "partial") {
          void refreshActiveEarnPosition().catch((error) => {
            console.warn("[earn-position] post-withdraw refresh failed", error);
          });
        }
        break;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Earn withdrawal failed.";
      setProposalActionError(message);
      setEarnDepositPrepareError(message);
    } finally {
      setIsEarnWithdrawPreparePending(false);
      setIsEarnAutoSigning(false);
    }
  }, [
    earnWithdrawReviewStage,
    ensureCanSignAccountAction,
    getEarnWithdrawDraftAmountRaw,
    invalidateEarnClientCaches,
    markDetailPaneTransition,
    pendingEarnWithdrawDraft,
    pendingEarnWithdrawPrepared,
    prepareEarnWithdrawInBrowser,
    refreshActiveEarnPosition,
    creditMainAccountUsdcBalance,
    setActiveEarnPosition,
    setDetailSelection,
    suppressEarnSubscriptionRefreshThroughSlot,
    smartAccountData,
  ]);

  const handleCompleteEarnCleanup = useCallback(async () => {
    if (!pendingEarnCleanupPrepared) {
      setProposalActionError("Prepare Earn cleanup before signing.");
      return;
    }

    if (!ensureCanSignAccountAction()) {
      return;
    }

    setProposalActionError(null);
    setEarnDepositPrepareError(null);
    setIsEarnAutoSigning(true);
    try {
      const result = await smartAccountData.executeEarnCleanup({
        preparedCleanup: pendingEarnCleanupPrepared,
      });

      if (!result.success) {
        throw new Error(result.error ?? "Earn cleanup failed.");
      }

      markDetailPaneTransition("back");
      invalidateEarnClientCaches();
      setPendingEarnWithdrawDraft(null);
      setPendingEarnWithdrawPrepared(null);
      setPendingEarnCleanupPrepared(null);
      setEarnWithdrawReviewStage("withdraw-0");
      setActiveEarnPosition(null);
      setAutodepositConfig(null);
      setSelectedSignerId(null);
      setDetailSelection("earnDeposit");
      setSelectedDetail("Deposit");
      void smartAccountData.refresh({ readCache: false }).catch((error) => {
        console.warn("[earn-cleanup] post-cleanup refresh failed", error);
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Earn cleanup failed.";
      setProposalActionError(message);
      setEarnDepositPrepareError(message);
    } finally {
      setIsEarnAutoSigning(false);
    }
  }, [
    ensureCanSignAccountAction,
    invalidateEarnClientCaches,
    markDetailPaneTransition,
    pendingEarnCleanupPrepared,
    setActiveEarnPosition,
    setDetailSelection,
    smartAccountData,
  ]);

  const handleCompleteEarnAutodepositSetup = useCallback(async () => {
    if (!pendingEarnAutodepositDraft) {
      setProposalActionError("Enter an Autodeposit amount before continuing.");
      return;
    }

    if (
      pendingEarnAutodepositDraft.requiresSignature !== false &&
      !ensureCanSignAccountAction()
    ) {
      return;
    }

    setProposalActionError(null);
    setAutodepositConfig((current) =>
      pendingEarnAutodepositDraft.requiresSignature === false
        ? current
        : current
        ? { ...current, state: "creating" }
        : {
            amount: pendingEarnAutodepositDraft.amountLabel,
            depositedAmount: "0",
            expiryTimestamp:
              pendingEarnAutodepositDraft.expiryTimestamp?.toString() ?? null,
            keepAmount: pendingEarnAutodepositDraft.keepAmountLabel,
            nextPeriodLabel: null,
            nonce: pendingEarnAutodepositDraft.nonce.toString(),
            periodLengthSeconds:
              pendingEarnAutodepositDraft.periodLengthSeconds?.toString() ??
              null,
            policyAccount: "",
            policySeed: "",
            recurringDelegation: "",
            scheduledSweeps: [],
            setupNonce: pendingEarnAutodepositDraft.nonce.toString(),
            startTimestamp:
              pendingEarnAutodepositDraft.startTimestamp?.toString() ?? null,
            state: "creating",
          }
    );

    try {
      const amountRaw = parseTokenAmountLabelToRaw(
        pendingEarnAutodepositDraft.amountLabel,
        pendingEarnAutodepositDraft.tokenDecimals
      );
      const walletBalanceFloorRaw = parseTokenAmountLabelToRaw(
        pendingEarnAutodepositDraft.keepAmountLabel,
        pendingEarnAutodepositDraft.tokenDecimals
      );

      if (!pendingEarnAutodepositDraft.requiresSignature) {
        if (
          !autodepositConfig?.policyAccount ||
          !autodepositConfig.recurringDelegation
        ) {
          throw new Error("Autodeposit account metadata is missing.");
        }

        const result = await smartAccountData.executeEarnAutodepositFloorUpdate(
          {
            policyAccount: autodepositConfig.policyAccount,
            recurringDelegation: autodepositConfig.recurringDelegation,
            walletBalanceFloorRaw,
          }
        );

        if (!result.success) {
          throw new Error(
            result.error ?? "Autodeposit wallet balance floor update failed."
          );
        }

        setAutodepositConfig({
          ...autodepositConfig,
          amount: pendingEarnAutodepositDraft.amountLabel,
          keepAmount: pendingEarnAutodepositDraft.keepAmountLabel,
          scheduledSweeps: result.scheduledSweeps ?? [],
          state: "created",
        });
        setPendingEarnAutodepositDraft(null);
        setPendingEarnAutodepositSetupPrepared(null);
        setEarnAutodepositSetupReviewStage("policy");
        setIsEarnAutodepositCloseReview(false);
        invalidateEarnClientCaches();
        markDetailPaneTransition("back");
        setSelectedSignerId(null);
        setDetailSelection("earn");
        setSelectedDetail("Earn");
        return;
      }

      setIsEarnAutodepositSetupConfirming(true);
      setIsEarnAutoSigning(true);
      let preparedSetup = pendingEarnAutodepositSetupPrepared;

      for (;;) {
        if (!preparedSetup) {
          preparedSetup = await prepareEarnAutodepositSetupOnServer({
            amountRaw,
            expiryTimestamp: pendingEarnAutodepositDraft.expiryTimestamp,
            nonce: pendingEarnAutodepositDraft.nonce,
            periodLengthSeconds:
              pendingEarnAutodepositDraft.periodLengthSeconds,
            policySeed: pendingEarnAutodepositDraft.existingPolicySeed
              ? BigInt(pendingEarnAutodepositDraft.existingPolicySeed)
              : undefined,
            startTimestamp: pendingEarnAutodepositDraft.startTimestamp,
            walletBalanceFloorRaw,
          });
          setPendingEarnAutodepositSetupPrepared(preparedSetup);
        }
        setEarnAutodepositSetupReviewStage(
          resolveEarnAutodepositSetupReviewStage(preparedSetup)
        );
        const result = await smartAccountData.executeEarnAutodepositSetup({
          amountRaw,
          expiryTimestamp: pendingEarnAutodepositDraft.expiryTimestamp,
          nonce: pendingEarnAutodepositDraft.nonce,
          periodLengthSeconds: pendingEarnAutodepositDraft.periodLengthSeconds,
          policySeed: pendingEarnAutodepositDraft.existingPolicySeed
            ? BigInt(pendingEarnAutodepositDraft.existingPolicySeed)
            : undefined,
          preparedSetup,
          startTimestamp: pendingEarnAutodepositDraft.startTimestamp,
          walletBalanceFloorRaw,
        });

        if (!result.success || !result.preparedSetup) {
          throw new Error(result.error ?? "Autodeposit setup failed.");
        }

        if (result.preparedSetup.stage !== "create_recurring_delegation") {
          if (!result.nextPreparedSetup) {
            throw new Error("Failed to prepare recurring delegation approval.");
          }

          preparedSetup = result.nextPreparedSetup;
          setPendingEarnAutodepositSetupPrepared(preparedSetup);
          setEarnAutodepositSetupReviewStage(
            resolveEarnAutodepositSetupReviewStage(preparedSetup)
          );
          setAutodepositConfig((current) =>
            current?.state === "creating" ? current : null
          );
          continue;
        }

        const policyAccount = result.preparedSetup.persistence.policyAccount;
        if (!policyAccount) {
          throw new Error("Autodeposit policy account was not returned.");
        }

        setAutodepositConfig({
          amount: pendingEarnAutodepositDraft.amountLabel,
          depositedAmount: autodepositConfig?.depositedAmount ?? "0",
          expiryTimestamp: result.preparedSetup.persistence.expiryTimestamp,
          keepAmount: pendingEarnAutodepositDraft.keepAmountLabel,
          nextPeriodLabel: null,
          nonce:
            result.preparedSetup.persistence.policySeed ??
            result.preparedSetup.persistence.nonce,
          periodLengthSeconds:
            result.preparedSetup.persistence.periodLengthSeconds,
          policyAccount,
          policySeed:
            result.preparedSetup.persistence.policySeed ??
            result.preparedSetup.persistence.nonce,
          recurringDelegation:
            result.preparedSetup.persistence.recurringDelegation,
          scheduledSweeps: result.scheduledSweeps ?? [],
          setupNonce: result.preparedSetup.persistence.nonce,
          startTimestamp: result.preparedSetup.persistence.startTimestamp,
          state: "created",
        });
        setPendingEarnAutodepositDraft(null);
        setPendingEarnAutodepositSetupPrepared(null);
        setEarnAutodepositSetupReviewStage("policy");
        setIsEarnAutodepositCloseReview(false);
        invalidateEarnClientCaches();
        markDetailPaneTransition("back");
        setSelectedSignerId(null);
        setDetailSelection("earn");
        setSelectedDetail("Earn");
        break;
      }
    } catch (error) {
      setAutodepositConfig((current) =>
        current?.state === "creating" && !current.policyAccount ? null : current
      );
      setProposalActionError(
        error instanceof Error
          ? error.message.replaceAll("autodeposit", "Autodeposit")
          : "Autodeposit setup failed."
      );
    } finally {
      setIsEarnAutodepositSetupConfirming(false);
      setIsEarnAutoSigning(false);
    }
  }, [
    autodepositConfig,
    ensureCanSignAccountAction,
    markDetailPaneTransition,
    invalidateEarnClientCaches,
    pendingEarnAutodepositDraft,
    pendingEarnAutodepositSetupPrepared,
    setDetailSelection,
    smartAccountData,
  ]);

  const handleCompleteEarnAutodepositClose = useCallback(async () => {
    if (!autodepositConfig) {
      setProposalActionError("No Autodeposit rule is configured.");
      return;
    }

    if (
      autodepositConfig.policyAccount.length === 0 ||
      autodepositConfig.recurringDelegation.length === 0
    ) {
      setProposalActionError("Autodeposit account metadata is missing.");
      return;
    }

    if (!ensureCanSignAccountAction()) {
      return;
    }

    setProposalActionError(null);
    setAutodepositConfig({ ...autodepositConfig, state: "closing" });

    try {
      const result = await smartAccountData.executeEarnAutodepositClose({
        policy: autodepositConfig.policyAccount,
        recurringDelegation: autodepositConfig.recurringDelegation,
        preparedClose: pendingEarnAutodepositClosePrepared,
      });

      if (!result.success) {
        throw new Error(result.error ?? "Autodeposit close failed.");
      }

      setAutodepositConfig(null);
      setPendingEarnAutodepositDraft(null);
      setPendingEarnAutodepositClosePrepared(null);
      setIsEarnAutodepositCloseReview(false);
      invalidateEarnClientCaches();
      markDetailPaneTransition("back");
      setSelectedSignerId(null);
      setDetailSelection("earn");
      setSelectedDetail("Earn");
    } catch (error) {
      setAutodepositConfig({ ...autodepositConfig, state: "created" });
      setProposalActionError(
        error instanceof Error
          ? error.message.replaceAll("autodeposit", "Autodeposit")
          : "Autodeposit close failed."
      );
    }
  }, [
    autodepositConfig,
    ensureCanSignAccountAction,
    invalidateEarnClientCaches,
    markDetailPaneTransition,
    pendingEarnAutodepositClosePrepared,
    setDetailSelection,
    smartAccountData,
  ]);

  const handleOpenVault = useCallback(
    (accountIndex: number) => {
      markDetailPaneTransition("switch");
      setDetailInitialTab("tokens");
      smartAccountData.setSelectedVaultIndex(accountIndex);
      setDetailSelection("vault");
      setSelectedSignerId(null);
      setSelectedDetail(`Stash ${accountIndex}`);
      setMobilePane("detail");
    },
    [markDetailPaneTransition, setDetailSelection, smartAccountData]
  );

  const handleOpenAgent = useCallback(
    (agent: SmartAccountSignerEntry) => {
      markDetailPaneTransition("switch");
      setDetailInitialTab("tokens");
      setSelectedSignerId(agent.id);

      if (personalWalletAddress && agent.address === personalWalletAddress) {
        setDetailSelection("wallet");
        setSelectedDetail(`${agent.label} · ${agent.shortAddress}`);
        setMobilePane("detail");
        return;
      }

      setDetailSelection("agent");
      setSelectedDetail(`${agent.label} · ${agent.shortAddress}`);
      setMobilePane("detail");
    },
    [markDetailPaneTransition, personalWalletAddress, setDetailSelection]
  );

  const handleOpenMockRootSigner = useCallback(
    (signer: MockRootSignerEntry) => {
      if (!isMockBackupSignerFlowEnabled) {
        return;
      }

      markDetailPaneTransition("switch");
      setDetailInitialTab("tokens");
      setSelectedSignerId(signer.id);
      setDetailSelection("wallet");
      setSelectedDetail(`${signer.label} · ${signer.shortAddress}`);
      setMobilePane("detail");
    },
    [
      isMockBackupSignerFlowEnabled,
      markDetailPaneTransition,
      setDetailSelection,
    ]
  );

  const handleOpenFirstPolicyAgent = useCallback(() => {
    const firstVaultAgent = smartAccountData.vaultEntries
      .map((vault) => ({
        accountIndex: vault.accountIndex,
        signer: vault.signers.find((signer) => signer.scope === "policy"),
      }))
      .find(
        (
          entry
        ): entry is { accountIndex: number; signer: SmartAccountSignerEntry } =>
          Boolean(entry.signer)
      );

    setActiveSection("wallet");
    router.push("/app");

    if (!firstVaultAgent) {
      return;
    }

    smartAccountData.setSelectedVaultIndex(firstVaultAgent.accountIndex);
    handleOpenAgent(firstVaultAgent.signer);
  }, [handleOpenAgent, router, smartAccountData]);

  const handleCommandSelectPolicy = useCallback(
    (policyId: string) => {
      setSelectedPolicyId(policyId);
      setActiveSection("policies");
      router.push("/app/policies");
    },
    [router]
  );

  const handleNewPolicy = useCallback(
    (mode: NewPolicyMode) => {
      void mode;
      setActiveSection("policies");
      router.push("/app/policies");
      setPolicyView("builder");
    },
    [router]
  );

  const runOnWallet = useCallback(
    (fn: () => void) => {
      if (activeSection !== "wallet") {
        setActiveSection("wallet");
        router.push("/app");
      }
      fn();
    },
    [activeSection, router]
  );

  const handleOpenAddSigner = useCallback(
    (accountIndex: number) => {
      if (!isMockBackupSignerFlowEnabled || hasBackupAccount) {
        return;
      }

      markDetailPaneTransition("forward");
      setPendingRootSignerDraft(null);
      setDetailSelection("addSigner");
      setSelectedSignerId(null);
      smartAccountData.setSelectedVaultIndex(accountIndex);
      setSelectedDetail("Add backup");
      setMobilePane("detail");
    },
    [
      hasBackupAccount,
      isMockBackupSignerFlowEnabled,
      markDetailPaneTransition,
      setDetailSelection,
      smartAccountData,
    ]
  );

  const handleBackFromAddSigner = useCallback(() => {
    markDetailPaneTransition("back");
    setPendingRootSignerDraft(null);
    setDetailSelection("wallet");
    setSelectedDetail("Main Account");
  }, [markDetailPaneTransition, setDetailSelection]);

  const handleCommandAddSigner = useCallback(() => {
    handleOpenAddSigner(selectedVault?.entry.accountIndex ?? 1);
  }, [handleOpenAddSigner, selectedVault?.entry.accountIndex]);

  // After a signer is added, switch to that signer's detail screen as soon as
  // the refreshed vault data exposes it.
  useEffect(() => {
    if (!pendingOpenSignerAddress || !selectedVault) return;
    const newSigner = selectedVault.entry.signers.find(
      (signer) => signer.address === pendingOpenSignerAddress
    );
    if (!newSigner) return;
    setPendingOpenSignerAddress(null);
    handleOpenAgent(newSigner);
  }, [handleOpenAgent, pendingOpenSignerAddress, selectedVault]);

  const handleReviewApproval = useCallback(
    (approval: SmartAccountApprovalItem) => {
      setSelectedApprovalId(approval.id);
      setProposalActionError(null);
      setMobilePane("activity");
    },
    []
  );

  const handleCreateDraftProposal = useCallback(
    ({
      request,
      capability,
    }: {
      request: VaultTransferRequest;
      capability: Extract<VaultTransferCapability, { kind: "settings" }>;
    }) => {
      const vault = smartAccountData.vaultEntries.find(
        (entry) => entry.accountIndex === request.accountIndex
      );
      const draftId = `draft:${request.accountIndex}:${Date.now()}`;
      setDraftError(null);
      setProposalActionError(null);
      setDraftProposal({
        id: draftId,
        request,
        amountDisplay: formatAmountForDraft(request.amount),
        symbol: request.symbol,
        recipientAddress: request.recipientAddress,
        destinationLabel: shortAddressForLabel(request.recipientAddress),
        sourceAccountIndex: request.accountIndex,
        sourceLabel: vault?.label ?? `Stash ${request.accountIndex}`,
        threshold: capability.threshold,
        expectedSigns: capability.expectedSigns,
      });
      setSelectedApprovalId(draftId);
    },
    [smartAccountData.vaultEntries]
  );

  const handleCancelDraftProposal = useCallback(() => {
    setDraftProposal(null);
    setSelectedApprovalId(null);
    setDraftError(null);
  }, []);

  const handleSubmitDraftProposal = useCallback(async () => {
    if (!draftProposal) return;
    if (!ensureCanSignAccountAction()) return;

    setIsDraftSubmitting(true);
    setDraftError(null);
    try {
      const result = await smartAccountData.executeVaultTransfer(
        draftProposal.request
      );
      if (!result.success) {
        setDraftError(result.error ?? "Failed to submit proposal.");
        return;
      }
      setDraftProposal(null);
      setSelectedApprovalId(null);
    } catch (error) {
      const raw =
        error instanceof Error ? error.message : "Failed to submit proposal.";
      setDraftError(raw);
    } finally {
      setIsDraftSubmitting(false);
    }
  }, [draftProposal, ensureCanSignAccountAction, smartAccountData]);

  const handleCreatePermissionDraft = useCallback(
    (input: Omit<PermissionChangeDraft, "id">) => {
      setPermissionDraftError(null);
      setPermissionDraft({
        id: `permission-draft:${input.signerAddress}:${Date.now()}`,
        ...input,
      });
    },
    []
  );

  const handleCancelPermissionDraft = useCallback(() => {
    setPermissionDraft(null);
    setPermissionDraftError(null);
  }, []);

  const handleSubmitPermissionDraft = useCallback(async () => {
    if (!permissionDraft) return;
    if (!ensureCanSignAccountAction()) return;

    setIsPermissionDraftSubmitting(true);
    setPermissionDraftError(null);
    try {
      await smartAccountData.updateSignerPermissions({
        signerAddress: permissionDraft.signerAddress,
        permissions: permissionDraft.permissions,
        policyAddress: permissionDraft.policyAddress,
        accountIndex: permissionDraft.accountIndex,
      });
      setPermissionDraft(null);
    } catch (error) {
      setPermissionDraftError(
        error instanceof Error
          ? error.message
          : "Failed to update signer permissions."
      );
    } finally {
      setIsPermissionDraftSubmitting(false);
    }
  }, [ensureCanSignAccountAction, permissionDraft, smartAccountData]);

  const handleCreateSpendingLimitDraft = useCallback(
    (
      input: SpendingLimitDraft extends infer T
        ? T extends { id: string }
          ? Omit<T, "id">
          : never
        : never
    ) => {
      setSpendingLimitDraftError(null);
      setSpendingLimitDraft({
        id: `spending-limit-draft:${input.kind}:${
          input.signerAddress
        }:${Date.now()}`,
        ...input,
      } as SpendingLimitDraft);
    },
    []
  );

  const handleCancelSpendingLimitDraft = useCallback(() => {
    setSpendingLimitDraft(null);
    setSpendingLimitDraftError(null);
  }, []);

  const handleSubmitSpendingLimitDraft = useCallback(async () => {
    if (!spendingLimitDraft) return;
    if (!ensureCanSignAccountAction()) return;

    setIsSpendingLimitDraftSubmitting(true);
    setSpendingLimitDraftError(null);
    try {
      const wasSet = spendingLimitDraft.kind === "set";
      if (spendingLimitDraft.kind === "set") {
        await smartAccountData.setSignerSpendingLimitUsd({
          accountIndex: spendingLimitDraft.accountIndex,
          amountUsd: spendingLimitDraft.amountUsd,
          existingSpendingLimitAddress:
            spendingLimitDraft.existingSpendingLimitAddress,
          signerAddress: spendingLimitDraft.signerAddress,
        });
      } else {
        await smartAccountData.deleteSignerSpendingLimit({
          accountIndex: spendingLimitDraft.accountIndex,
          spendingLimitAddress: spendingLimitDraft.spendingLimitAddress,
          signerAddress: spendingLimitDraft.signerAddress,
        });
      }
      setSpendingLimitDraft(null);
      // RPC getProgramAccounts can lag a beat behind a brand-new policy account
      // at "confirmed" commitment. Re-fetch overview shortly after to make the
      // new spending limit show up without a manual page reload.
      if (wasSet) {
        const delays = [800, 2000];
        for (const delay of delays) {
          window.setTimeout(() => {
            void smartAccountData.refresh().catch(() => undefined);
          }, delay);
        }
      }
    } catch (error) {
      setSpendingLimitDraftError(
        error instanceof Error
          ? error.message
          : "Failed to update spending limit."
      );
    } finally {
      setIsSpendingLimitDraftSubmitting(false);
    }
  }, [ensureCanSignAccountAction, spendingLimitDraft, smartAccountData]);

  const runProposalAction = useCallback(async (action: () => Promise<void>) => {
    if (!ensureCanSignAccountAction()) {
      return;
    }

    setProposalActionError(null);
    try {
      await action();
    } catch (error) {
      const raw =
        error instanceof Error
          ? error.message
          : "Failed to submit smart-account action.";
      const haystack = raw.toLowerCase();
      const isRentError =
        haystack.includes("insufficient funds for rent") ||
        haystack.includes("insufficient lamports") ||
        haystack.includes("would result in account being unable to pay rent");
      setProposalActionError(
        isRentError
          ? "Stash must keep a minimum SOL balance for rent. Try a smaller amount."
          : raw
      );
    }
  }, [ensureCanSignAccountAction]);

  const commandGroups = useMemo<WalletCommandGroup[]>(() => {
    const isWalletActive = activeDetailSelection === "wallet";
    const isVaultActive = activeDetailSelection === "vault";
    const usdcToken = findTrackedUsdcToken(
      derivedTokens,
      trackedKaminoUsdcMint
    );
    const tokenCommands = personalWalletAllTokenRows.map((token, index) => {
      const tokenKind = token.isSecured ? "Shielded balance" : "Balance";
      const tokenValue = token.value ? ` · ${token.value}` : "";

      return {
        description: `${tokenKind} ${token.amount} ${token.symbol}${tokenValue}`,
        iconUrl: token.icon,
        id: `token:${token.id ?? token.symbol}:${
          token.isSecured ? "shielded" : "public"
        }:${index}`,
        keywords: [
          token.symbol,
          token.isSecured ? "shielded private" : "unshielded public",
          "details",
        ],
        label: `${token.symbol}${token.isSecured ? " shielded" : ""}`,
        onSelect: () => runOnWallet(() => handleTokenDetail(token)),
      };
    });

    const policyCommands = mockPolicies
      .filter((policy) => policy.status === "active")
      .map((policy) => ({
        description: policy.schedule,
        icon: (
          <span
            style={{
              alignItems: "center",
              backgroundImage: `linear-gradient(135deg, ${policy.gradient[0]} 0%, ${policy.gradient[1]} 100%)`,
              color: "#fff",
              display: "inline-flex",
              height: 40,
              justifyContent: "center",
              width: 40,
            }}
          >
            <PolicyGlyph kind={policy.icon} size={20} />
          </span>
        ),
        id: `policy:${policy.id}`,
        keywords: ["policy", "automation", policy.title],
        label: policy.title,
        onSelect: () => handleCommandSelectPolicy(policy.id),
      }));

    const policiesGroup: WalletCommandGroup = {
      heading: "Policies",
      items: policyCommands,
    };
    const actionsGroup: WalletCommandGroup = {
      heading: "Actions",
      items: [
        {
          description: "Start from a blank workflow",
          icon: <FileIcon size={19} strokeWidth={1.9} />,
          id: "policy:create-blank",
          keywords: ["create", "new", "blank", "policy"],
          label: "Create policy",
          onSelect: () => handleNewPolicy("blank"),
        },
        {
          description: "Pick a starter template",
          icon: <LayoutTemplate size={19} strokeWidth={1.9} />,
          id: "policy:create-template",
          keywords: ["create", "new", "template", "policy"],
          label: "Create policy from template",
          onSelect: () => handleNewPolicy("template"),
        },
        {
          description: "Open shield flow for USDC APY",
          disabled: !isSignedIn || !usdcToken,
          icon: <Sparkles size={18} strokeWidth={1.9} />,
          id: "action:shield-usdc",
          keywords: ["apy", "earn", "usdc", "private"],
          label: "Shield USDC to earn",
          onSelect: () => runOnWallet(handleCommandShieldUsdc),
        },
        {
          description: "Send tokens",
          disabled: !isSignedIn || (!isWalletActive && !isVaultActive),
          icon: <ArrowUpRight size={19} strokeWidth={1.9} />,
          id: "action:send",
          label: "Send",
          onSelect: () => runOnWallet(handleCommandSend),
        },
        {
          description: isVaultActive
            ? "Receive funds into this vault"
            : selectedSignerId
            ? "Fund selected user from your wallet"
            : "Show wallet receive address",
          disabled: !isSignedIn || (!isWalletActive && !isVaultActive),
          icon: <ArrowDownLeft size={19} strokeWidth={1.9} />,
          id: "action:receive",
          label: isVaultActive
            ? "Top Up"
            : selectedSignerId
            ? "Top Up"
            : "Receive",
          onSelect: () => runOnWallet(handleCommandReceiveOrTopUp),
        },
        {
          description: "Exchange tokens",
          disabled: !isSignedIn || !isWalletActive,
          icon: <Repeat2 size={19} strokeWidth={1.9} />,
          id: "action:swap",
          label: "Swap",
          onSelect: () => runOnWallet(handleCommandSwap),
        },
        {
          description: "Move a token into private balance",
          disabled: !isSignedIn || !isWalletActive,
          icon: <ShieldIcon size={19} strokeWidth={1.9} />,
          id: "action:shield",
          label: "Shield",
          onSelect: () => runOnWallet(handleCommandShield),
        },
        ...(isMockBackupSignerFlowEnabled
          ? [
              {
                description: selectedVault ? "Add Backup Account" : undefined,
                disabled: !isSignedIn || !selectedVault || hasBackupAccount,
                icon: <Plus size={20} strokeWidth={1.8} />,
                id: "action:add-signer",
                label: "Add backup",
                onSelect: () => runOnWallet(handleCommandAddSigner),
              },
            ]
          : []),
      ],
    };
    const tokensGroup: WalletCommandGroup = {
      heading: "Tokens",
      items: tokenCommands,
    };

    const isPoliciesSection = activeSection === "policies";

    return [
      ...(isPoliciesSection ? [policiesGroup] : []),
      actionsGroup,
      tokensGroup,
      ...(isPoliciesSection ? [] : [policiesGroup]),
      {
        heading: "Approvals",
        items: [
          {
            description: latestPendingApproval
              ? `${latestPendingApproval.amount} ${latestPendingApproval.symbol} to ${latestPendingApproval.destinationLabel}`
              : undefined,
            disabled:
              !isSignedIn ||
              !latestPendingApproval ||
              smartAccountData.isActionPending,
            icon: <KeyRound size={18} strokeWidth={1.9} />,
            id: "approval:approve-latest",
            keywords: ["proposal", "approve", "approval"],
            label: "Approve latest pending approval",
            onSelect: () =>
              runOnWallet(() => {
                if (!latestPendingApproval) return;

                void runProposalAction(() =>
                  smartAccountData.approveProposal(
                    latestPendingApproval.proposal
                  )
                );
              }),
          },
        ],
      },
      {
        heading: "Account",
        items: [
          {
            description: "Start wallet sign in",
            disabled: isSignedIn,
            icon: <Wallet size={18} strokeWidth={1.8} />,
            id: "account:connect",
            label: "Connect wallet",
            onSelect: openSignIn,
          },
          {
            description: isBalanceHidden
              ? "Reveal balances in the workspace"
              : "Blur balances in the workspace",
            disabled: !isSignedIn,
            icon: isBalanceHidden ? (
              <Eye size={19} strokeWidth={1.8} />
            ) : (
              <EyeOff size={19} strokeWidth={1.8} />
            ),
            id: "account:hide-assets",
            keywords: ["privacy", "balance", "hide", "show"],
            label: isBalanceHidden ? "Show assets" : "Hide assets",
            onSelect: () => setIsBalanceHidden((current) => !current),
          },
          {
            description: shortCommandAddress(personalWalletAddress),
            disabled: !personalWalletAddress,
            icon: <Copy size={18} strokeWidth={1.8} />,
            id: "account:copy-wallet",
            keywords: ["copy", "address", "wallet"],
            label: "Copy wallet address",
            onSelect: handleCommandCopyWalletAddress,
          },
          {
            description: "Disconnect this browser session",
            disabled: !isSignedIn,
            icon: <LogOut size={18} strokeWidth={1.8} />,
            id: "account:disconnect",
            label: "Disconnect wallet",
            onSelect: () => {
              void handleDisconnect();
            },
          },
        ],
      },
    ];
  }, [
    activeDetailSelection,
    activeSection,
    derivedTokens,
    handleCommandAddSigner,
    handleCommandCopyWalletAddress,
    handleCommandReceiveOrTopUp,
    handleCommandSelectPolicy,
    handleCommandSend,
    handleCommandShield,
    handleCommandShieldUsdc,
    handleCommandSwap,
    handleDisconnect,
    handleNewPolicy,
    handleTokenDetail,
    hasBackupAccount,
    isBalanceHidden,
    isMockBackupSignerFlowEnabled,
    isSignedIn,
    latestPendingApproval,
    openSignIn,
    personalWalletAddress,
    personalWalletAllTokenRows,
    runOnWallet,
    runProposalAction,
    selectedSignerId,
    selectedVault,
    smartAccountData,
    trackedKaminoUsdcMint,
  ]);

  const handleTransientDetailBack = useCallback(() => {
    if (detailSelection === "action" && viewStack.length > 0) {
      handleActionBack();
      return true;
    }

    if (isEarnDepositSubViewActive) {
      handleOpenEarn();
      return true;
    }

    if (detailSelection === "earnWithdraw") {
      handleBackFromEarnWithdraw();
      return true;
    }

    if (detailSelection === "earnAutodeposit") {
      handleBackFromAutodeposit();
      return true;
    }

    if (detailSelection === "connect") {
      handleCloseConnectRequest();
      return true;
    }

    if (detailSelection === "addSigner") {
      handleBackFromAddSigner();
      return true;
    }

    return false;
  }, [
    detailSelection,
    handleActionBack,
    handleBackFromAddSigner,
    handleBackFromAutodeposit,
    handleBackFromEarnWithdraw,
    handleCloseConnectRequest,
    handleOpenEarn,
    isEarnDepositSubViewActive,
    viewStack.length,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Cmd+K command-menu shortcut temporarily disabled.
      // if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      //   event.preventDefault();
      //   setIsCommandMenuOpen((current) => !current);
      //   return;
      // }

      if (event.key !== "Escape") return;
      if (isCommandMenuOpen) return;

      if (isReviewApprovalFocused) {
        event.preventDefault();
        handleDismissFocusedEarnPreview();
        return;
      }

      if (handleTransientDetailBack()) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [
    handleDismissFocusedEarnPreview,
    handleTransientDetailBack,
    isCommandMenuOpen,
    isReviewApprovalFocused,
  ]);

  const handleOpenMobileActivity = useCallback(() => {
    setMobilePane("activity");
  }, []);

  const handleMobilePaneBack = useCallback(() => {
    if (mobilePane === "activity") {
      setMobilePane("detail");
      return;
    }

    if (mobilePane === "detail" && handleTransientDetailBack()) {
      return;
    }

    setMobilePane("accounts");
  }, [handleTransientDetailBack, mobilePane]);

  const hasMobilePaneBackTarget =
    isMobileWorkspaceViewport &&
    showAccountShell &&
    mobilePane !== "accounts" &&
    !isAnonymousMobilePreview;

  const handleMobileBackIntent = useCallback(() => {
    if (hasMobilePaneBackTarget && mobilePaneHistoryArmedRef.current) {
      window.history.back();
      return;
    }

    handleMobilePaneBack();
  }, [handleMobilePaneBack, hasMobilePaneBackTarget]);

  useEffect(() => {
    const handlePopState = () => {
      if (!mobilePaneHistoryArmedRef.current) return;

      mobilePaneHistoryArmedRef.current = false;
      handleMobilePaneBack();
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [handleMobilePaneBack]);

  useEffect(() => {
    if (!hasMobilePaneBackTarget) {
      mobilePaneHistoryArmedRef.current = false;
      return;
    }

    if (mobilePaneHistoryArmedRef.current) return;

    window.history.pushState(
      createMobilePaneHistoryState(),
      "",
      window.location.href
    );
    mobilePaneHistoryArmedRef.current = true;
  }, [hasMobilePaneBackTarget]);

  const mobileHeaderTitle =
    mobilePane === "activity" ? "Transactions" : selectedDetail || "Details";
  const canOpenMobileActivity =
    !isAnonymousMobilePreview &&
    mobilePane === "detail" &&
    activeSection === "wallet" &&
    (detailSelection === "earn" ||
      (isEarnDepositDetailActive && !hasEarnPosition));

  const renderDetailPane = () => {
    if (activeSection === "settings") {
      return <div className="wallet-workspace-detail-empty" />;
    }
    if (activeSection === "policies") {
      if (isAuthResolving) {
        return <div className="wallet-workspace-auth-pending" />;
      }
      const selectedPolicy =
        mockPolicies.find((p) => p.id === selectedPolicyId) ?? mockPolicies[0];
      return (
        <div className="wallet-workspace-policies-stack">
          <PolicyDetailsPane
            availableSigners={availablePolicySigners}
            key={selectedPolicy.id}
            onEditRules={() => setPolicyView("builder")}
            onOpenSigner={handleOpenFirstPolicyAgent}
            policy={selectedPolicy}
          />
          <AnimatePresence initial={false}>
            {policyView === "builder" ? (
              <motion.div
                animate={{
                  x: 0,
                  transition: {
                    delay: 0.3,
                    duration: 0.4,
                    ease: [0.22, 1, 0.36, 1],
                  },
                }}
                className="wallet-workspace-builder-overlay"
                exit={{
                  x: "calc(100% + 8px)",
                  transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
                }}
                initial={{ x: "calc(100% + 8px)" }}
                key="builder-overlay"
              >
                <WorkflowBuilderPane onBack={() => setPolicyView("details")} />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      );
    }

    if (isSmartAccountRateLimited) {
      return (
        <WorkspaceErrorPane
          error={smartAccountData.error}
          onRetry={() => {
            void smartAccountData.refresh();
          }}
        />
      );
    }

    if (isAuthResolving) {
      return <div className="wallet-workspace-auth-pending" />;
    }

    if (isWorkspaceLoading) {
      return <WorkspaceDetailSkeleton />;
    }

    if (smartAccountData.error && !smartAccountData.overview) {
      return (
        <WorkspaceErrorPane
          error={smartAccountData.error}
          onRetry={() => {
            void smartAccountData.refresh();
          }}
        />
      );
    }

    // Hold the skeleton until the persisted selection is restored, so the pane
    // paints the user's actual selection directly instead of briefly flashing
    // the default (Earn) first. `isWorkspaceLoading` clears as soon as the
    // wallet address loads — which is before `overview`/restore — so without
    // this guard the default pane paints in that gap. Gated on `settingsPda`
    // The anonymous preview path skips this gate entirely so it can render the
    // Earn deposit surface with empty personal state.
    if (canLoadPersonalAccount && !isSelectionRestored) {
      return <WorkspaceDetailSkeleton />;
    }

    if (detailSelection === "action") {
      return renderActionView();
    }

    if (detailSelection === "connect" && connectAgentAddress) {
      return (
        <ConnectRequestContent
          agentAddress={connectAgentAddress}
          onApprove={async () => {
            if (!ensureCanSignAccountAction()) {
              return;
            }

            await smartAccountData.addInitiateSigner({
              signerAddress: connectAgentAddress,
            });
          }}
          onClose={handleCloseConnectRequest}
          onDecline={handleCloseConnectRequest}
          onDone={handleCloseConnectRequest}
        />
      );
    }

    if (isEarnAccessResolving) {
      return <WorkspaceDetailSkeleton />;
    }

    if (isEarnDepositDetailActive) {
      return (
        <EarnDepositView
          defaultChartTab={canMutateAccount ? "Forecast" : "Historical"}
          existingPrincipalAmount={
            isEarnDepositSubViewActive ? earnPrincipalAmount : 0
          }
          isSubmitting={
            smartAccountData.isActionPending || isEarnDepositPreparePending
          }
          onDraftChange={handleEarnDepositFormDraftChange}
          onClose={handleOpenEarn}
          onDraftSubmit={handleSubmitEarnDepositDraft}
          showFundingControls={canMutateAccount}
          showCloseButton={hasEarnPosition}
          sources={earnDepositSources}
          submitCtaLabel={canMutateAccount ? null : "Connect"}
          submitError={earnDepositPrepareError}
        />
      );
    }

    if (detailSelection === "earn") {
      return (
        <EarnDetailView
          autodepositFloorAccountLabel={
            earnDepositSources.find((source) => source.id === "main")
              ?.addressLabel
          }
          autodepositFloorLabel={autodepositFloorLabel}
          autodepositScheduledSweeps={visibleAutodepositScheduledSweeps}
          autodepositState={autodepositConfig?.state ?? "idle"}
          currentBalanceAmount={earnCurrentBalanceAmount}
          currentPositionHoldings={activeEarnPosition?.holdings}
          currentPositionMarketName={activeEarnPosition?.display?.marketName}
          currentPositionTokenSymbol={activeEarnPosition?.display?.mintSymbol}
          currentSupplyApyBps={activeEarnPosition?.currentSupplyApyBps}
          earningsCacheKey={earnEarningsCacheKey}
          earningsCacheScope={{
            expectedPrincipalAmountRaw: earnEarningsPrincipalAmountRaw,
            settingsPda: smartAccountData.overview?.settingsPda,
            solanaEnv: publicEnv.solanaEnv,
            walletAddress: personalWalletAddress,
          }}
          hasCurrentPosition={hasEarnPosition}
          isAutodepositConfigured={isAutodepositReady}
          isAutodepositPending={isAutodepositPendingSetup}
          isBalanceHidden={isBalanceHidden}
          onDeposit={handleOpenEarnDeposit}
          onDisableAutodeposit={handleDisableAutodeposit}
          onOpenAutodeposit={handleOpenAutodeposit}
          onWithdraw={handleOpenEarnWithdraw}
          principalAmount={earnPrincipalAmount}
        />
      );
    }

    if (detailSelection === "earnAutodeposit") {
      return (
        <AutodepositSetupView
          earnBalance={earnCurrentBalanceAmount}
          earnVaultAddressLabel={earnVaultAddressLabel}
          initialKeepAmount={autodepositConfig?.keepAmount ?? "500"}
          isEditing={isAutodepositReady}
          isPendingSetup={isAutodepositPendingSetup}
          mainSource={
            earnDepositSources.find((source) => source.id === "main") ?? null
          }
          onBack={handleBackFromAutodeposit}
          onDelete={handleDeleteAutodeposit}
          onSubmit={handleSaveAutodeposit}
        />
      );
    }

    if (detailSelection === "earnWithdraw") {
      return (
        <EarnWithdrawView
          currentPositionHoldings={activeEarnPosition?.holdings}
          cleanupOnly={hasEarnPolicy && !hasEarnPosition}
          destinations={earnWithdrawDestinations}
          isSubmitting={
            smartAccountData.isActionPending || isEarnWithdrawPreparePending
          }
          onCleanupSubmit={handleSubmitEarnCleanup}
          onDraftChange={handleEarnWithdrawDraftChange}
          onDraftSubmit={handleSubmitEarnWithdrawDraft}
          onClose={handleBackFromEarnWithdraw}
          submitError={earnDepositPrepareError}
        />
      );
    }

    if (detailSelection === "wallet") {
      const isMainAccountDetail = Boolean(
        selectedAgent?.address &&
          personalWalletAddress &&
          selectedAgent.address === personalWalletAddress
      );
      const walletDetailAddress =
        selectedMockRootSigner?.address ?? personalWalletAddress;
      const walletDetailIcon = selectedMockRootSigner?.icon ?? getWalletIcon();
      const walletFallbackBalanceWhole = canLoadPersonalAccount
        ? walletDesktopData.balanceWhole
        : "0";
      const walletFallbackBalanceFraction = canLoadPersonalAccount
        ? walletDesktopData.balanceFraction
        : "00";
      const canUseWalletDetailData =
        canLoadPersonalAccount && !selectedMockRootSigner;
      const walletDetailBalanceWhole =
        selectedMockRootSigner?.balanceWhole ??
        (isMainAccountDetail
          ? mainAccountDisplayBalance.balanceWhole
          : walletFallbackBalanceWhole);
      const walletDetailBalanceFraction =
        selectedMockRootSigner?.balanceFraction ??
        (isMainAccountDetail
          ? mainAccountDisplayBalance.balanceFraction
          : walletFallbackBalanceFraction);
      const walletDetailTokenRows = canUseWalletDetailData
        ? personalWalletAllTokenRows
        : [];
      const walletDetailCashTokenRows = canUseWalletDetailData
        ? walletDesktopData.cashTokenRows
        : [];
      const walletDetailInvestmentTokenRows = canUseWalletDetailData
        ? walletDesktopData.investmentTokenRows
        : [];
      const walletDetailActivityRows = canUseWalletDetailData
        ? walletDesktopData.allActivityRows
        : [];
      const walletDetailTransactionDetails = canUseWalletDetailData
        ? walletDesktopData.transactionDetails
        : {};

      return (
        <WalletDetailView
          address={walletDetailAddress}
          activityRows={walletDetailActivityRows}
          balanceFraction={walletDetailBalanceFraction}
          balanceWhole={walletDetailBalanceWhole}
          cashTokenRows={walletDetailCashTokenRows}
          icon={walletDetailIcon}
          initialTab={detailInitialTab}
          investmentTokenRows={walletDetailInvestmentTokenRows}
          isBalanceHidden={isBalanceHidden}
          label={
            selectedMockRootSigner
              ? selectedMockRootSigner.label
              : selectedSignerId
              ? "Main Account"
              : "My Wallet"
          }
          onNavigate={(view) =>
            openWorkspaceActionView(
              view,
              typeof view === "string" ? view : view.type,
              "",
              "wallet"
            )
          }
          onOpenReceive={() => {
            openActionView({ type: "receivePanel" }, "Receive", "", "wallet");
          }}
          onOpenSend={() => {
            openActionView({ type: "sendPanel" }, "Send", "", "wallet");
          }}
          onOpenShield={() => {
            handleOpenMainAccountShield();
          }}
          onOpenSwap={() => {
            openActionView(
              { type: "swapPanel", mode: "swap" },
              "Swap",
              "",
              "wallet"
            );
          }}
          onRemoveSigner={
            selectedMockRootSigner
              ? () =>
                  setPendingRootSignerRemovalDraft({
                    signerAddress: selectedMockRootSigner.address,
                  })
              : undefined
          }
          accessLevel={
            selectedSignerId ? selectedAgent?.accessLevel : undefined
          }
          accessTitle="Access level"
          onAccessLevelChange={
            selectedSignerId && selectedAgent
              ? async (level) => {
                  handleCreatePermissionDraft({
                    signerAddress: selectedAgent.address,
                    signerLabel: selectedAgent.label,
                    previousLevel: selectedAgent.accessLevel,
                    nextLevel: level,
                    permissions:
                      level === "suggest"
                        ? ["initiate"]
                        : level === "sign"
                        ? ["initiate", "vote"]
                        : ["initiate", "vote", "execute"],
                    policyAddress:
                      selectedAgent.scope === "policy"
                        ? selectedAgent.policyAddress
                        : null,
                    accountIndex:
                      selectedAgent.scope === "policy"
                        ? selectedVaultAccountIndex
                        : undefined,
                  });
                }
              : undefined
          }
          isAccessLevelPending={
            selectedAgent
              ? (permissionDraft?.signerAddress === selectedAgent.address &&
                  isPermissionDraftSubmitting) ||
                smartAccountData.pendingSpendingLimitActionKey ===
                  `update-signer-permissions:${selectedAgent.address}`
              : false
          }
          getTokenActions={getTokenActions}
          onActivityTabOpen={() => {
            if (!selectedMockRootSigner && canLoadPersonalAccount) {
              void walletDesktopData.loadActivity();
            }
          }}
          onTokenDetail={handleTokenDetail}
          tokenRows={walletDetailTokenRows}
          transactionDetails={walletDetailTransactionDetails}
          spendingLimit={
            selectedSignerId && !selectedMockRootSigner
              ? selectedVaultSpendingLimit
              : undefined
          }
          isSpendingLimitPending={
            selectedSignerId && !selectedMockRootSigner
              ? smartAccountData.pendingSpendingLimitActionKey !== null &&
                walletSpendingLimitActionKeys.has(
                  smartAccountData.pendingSpendingLimitActionKey
                )
              : false
          }
          onSetSpendingLimit={
            selectedSignerId && !selectedMockRootSigner
              ? async (amountUsd) => {
                  if (!personalWalletAddress) {
                    throw new Error(
                      "Connect a wallet before setting a spending limit."
                    );
                  }

                  handleCreateSpendingLimitDraft({
                    kind: "set",
                    signerAddress: personalWalletAddress,
                    signerLabel: "Main Account",
                    accountIndex: selectedVaultAccountIndex,
                    amountUsd,
                    existingSpendingLimitAddress:
                      selectedVaultSpendingLimit?.address ?? null,
                    isPolicyScope: false,
                  });
                }
              : undefined
          }
          onDeleteSpendingLimit={
            selectedSignerId && !selectedMockRootSigner
              ? async (spendingLimit) => {
                  if (!personalWalletAddress) {
                    throw new Error(
                      "Connect a wallet before deleting a spending limit."
                    );
                  }

                  handleCreateSpendingLimitDraft({
                    kind: "delete",
                    signerAddress: personalWalletAddress,
                    signerLabel: "Main Account",
                    accountIndex: selectedVaultAccountIndex,
                    spendingLimitAddress: spendingLimit.address,
                    isPolicyScope: false,
                  });
                }
              : undefined
          }
        />
      );
    }

    if (detailSelection === "agent" && selectedAgent && selectedVault) {
      const signerView =
        smartAccountData.signerPortfolioByAddress[selectedAgent.address];
      return (
        <AgentPageView
          agentIcon={selectedAgent.icon}
          balanceFraction={selectedAgent.balanceFraction}
          balanceWhole={selectedAgent.balanceWhole}
          canDeleteSigner={selectedAgent.scope === "policy"}
          initialAccessLevel={selectedAgent.accessLevel}
          onAccessLevelChange={async (level) => {
            handleCreatePermissionDraft({
              signerAddress: selectedAgent.address,
              signerLabel: selectedAgent.label,
              previousLevel: selectedAgent.accessLevel,
              nextLevel: level,
              permissions:
                level === "suggest"
                  ? ["initiate"]
                  : level === "sign"
                  ? ["initiate", "vote"]
                  : ["initiate", "vote", "execute"],
              policyAddress:
                selectedAgent.scope === "policy"
                  ? selectedAgent.policyAddress
                  : null,
              accountIndex:
                selectedAgent.scope === "policy"
                  ? selectedVaultAccountIndex
                  : undefined,
            });
          }}
          isAccessLevelPending={
            (permissionDraft?.signerAddress === selectedAgent.address &&
              isPermissionDraftSubmitting) ||
            smartAccountData.pendingSpendingLimitActionKey ===
              `update-signer-permissions:${selectedAgent.address}`
          }
          isBalanceHidden={isBalanceHidden}
          isSignerDeletePending={
            smartAccountData.pendingSpendingLimitActionKey ===
            pendingSignerDeleteKey
          }
          isSpendingLimitPending={
            smartAccountData.pendingSpendingLimitActionKey !== null &&
            pendingSpendingLimitKeys.has(
              smartAccountData.pendingSpendingLimitActionKey
            )
          }
          label={selectedAgent.label}
          onBack={() => {
            markDetailPaneTransition("back");
            setSelectedSignerId(null);
          }}
          onBalanceHiddenChange={setIsBalanceHidden}
          onDeleteSigner={(deleteArgs) =>
            smartAccountData.deleteSigner({
              ...deleteArgs,
              policyAddress: selectedAgent.policyAddress ?? null,
            })
          }
          onDeleteSpendingLimit={async (args) => {
            handleCreateSpendingLimitDraft({
              kind: "delete",
              signerAddress: args.signerAddress,
              signerLabel: selectedAgent.label,
              accountIndex: args.accountIndex,
              spendingLimitAddress: args.spendingLimitAddress,
              isPolicyScope: selectedAgent.scope === "policy",
            });
          }}
          onNavigate={(view) =>
            openWorkspaceActionView(
              view,
              typeof view === "string" ? view : view.type,
              "",
              "agent"
            )
          }
          onSetSpendingLimit={async (args) => {
            handleCreateSpendingLimitDraft({
              kind: "set",
              signerAddress: args.signerAddress,
              signerLabel: selectedAgent.label,
              accountIndex: args.accountIndex,
              amountUsd: args.amountUsd,
              existingSpendingLimitAddress:
                args.existingSpendingLimitAddress ?? null,
              isPolicyScope: selectedAgent.scope === "policy",
            });
          }}
          onTopUp={() =>
            openActionView(
              { type: "sendPanel" },
              "Top Up",
              selectedAgent.address,
              "agent"
            )
          }
          onTopUpWithSpendingLimit={
            smartAccountData.topUpSignerWithSpendingLimitUsd
          }
          signerAddress={selectedAgent.address}
          showSpendingLimit
          showTopUpAction={false}
          spendingLimit={selectedAgent.spendingLimit}
          tokenRows={signerView?.tokenRows ?? []}
          transactionDetails={signerView?.transactionDetails ?? {}}
          activityRows={signerView?.activityRows ?? []}
          vaultAccountIndex={selectedVaultAccountIndex}
          getTokenActions={getTokenActions}
          initialTab={detailInitialTab}
          onActivityTabOpen={() => {
            void smartAccountData
              .loadSignerActivity(selectedAgent.address)
              .catch(() => undefined);
          }}
          onTokenDetail={handleTokenDetail}
          variant="workspace"
        />
      );
    }

    if (detailSelection === "vault" && selectedVault) {
      return (
        <StashDetailView
          accountIndex={selectedVault.entry.accountIndex}
          address={selectedVault.entry.address}
          activityRows={selectedVault.activityRows}
          balanceFraction={selectedVault.entry.balanceFraction}
          balanceWhole={selectedVault.entry.balanceWhole}
          isBalanceHidden={isBalanceHidden}
          label={selectedVault.entry.label}
          onNavigate={(view) =>
            openWorkspaceActionView(
              view,
              typeof view === "string" ? view : view.type,
              "",
              "vault"
            )
          }
          onOpenReceive={() =>
            openActionView({ type: "receivePanel" }, "Receive", "", "vault")
          }
          onOpenSend={() =>
            openActionView({ type: "sendPanel" }, "Send", "", "vault")
          }
          onOpenSwap={() =>
            openActionView(
              { type: "swapPanel", mode: "swap" },
              "Swap",
              "",
              "vault"
            )
          }
          tokenRows={selectedVault.tokenRows}
          transactionDetails={selectedVault.transactionDetails}
          getTokenActions={getTokenActions}
          initialTab={detailInitialTab}
          onActivityTabOpen={() => {
            void smartAccountData
              .loadVaultActivity(selectedVault.entry.accountIndex)
              .catch(() => undefined);
          }}
          onTokenDetail={handleTokenDetail}
        />
      );
    }

    if (isMockBackupSignerFlowEnabled && detailSelection === "addSigner") {
      return (
        <AddSignerPane
          connectedWalletAddress={personalWalletAddress}
          existingSigners={allKnownSignerEntries}
          isBackupLimitReached={hasBackupAccount}
          onPreviewSigner={({ signerAddress }) => {
            if (hasBackupAccount) {
              return;
            }

            setProposalActionError(null);
            setPendingRootSignerDraft({ signerAddress });
          }}
          settingsAddress={smartAccountData.overview?.settingsPda}
          targetAccountLabel="Main Account"
        />
      );
    }

    return (
      <div className="wallet-workspace-placeholder">
        <span>Selected</span>
        <strong>{selectedDetail}</strong>
      </div>
    );
  };

  const handleResizeStart = useCallback(
    (target: ResizeTarget, event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      resizeStateRef.current = {
        startWidth: target === "account" ? accountPaneWidth : reviewPaneWidth,
        startX: event.clientX,
        target,
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [accountPaneWidth, reviewPaneWidth]
  );

  function renderActionView() {
    const actionView = viewStack[viewStack.length - 1];

    if (!actionView) {
      return null;
    }

    const type = viewType(actionView);

    if (type === "transaction") {
      const detail = (
        actionView as {
          type: "transaction";
          detail: TransactionDetail;
          from: string;
        }
      ).detail;

      return (
        <TransactionDetailView
          detail={detail}
          dismissIcon={actionReturnSelection === "earn" ? "close" : "back"}
          onBack={handleActionBack}
        />
      );
    }

    if (type === "tokenDetail") {
      const token = (actionView as { type: "tokenDetail"; token: TokenRow })
        .token;

      return <TokenDetailView onBack={handleActionBack} token={token} />;
    }

    if (type === "tokenSelect") {
      const field = (
        actionView as { type: "tokenSelect"; field: "from" | "to" }
      ).field;

      return (
        <TokenSelectView
          currentToken={field === "from" ? swapFromToken : swapToToken}
          onBack={handleActionBack}
          onClose={closeActionView}
          onSearch={field === "to" ? searchTokens : undefined}
          onSelect={handleTokenSelect}
          title={field === "from" ? "You Swap" : "You Receive"}
          tokens={field === "to" ? swapTargetTokens : derivedTokens}
        />
      );
    }

    if (type === "sendTokenSelect") {
      const sendingFromVault = actionReturnSelection === "vault";
      const tokensForSelect = sendingFromVault
        ? vaultDerivedTokens
        : derivedTokens;
      const currentTokenForSelect = sendingFromVault
        ? vaultDerivedTokens.find((entry) => entry.mint === sendToken.mint) ??
          vaultDerivedTokens[0] ?? { ...sendToken, balance: 0 }
        : sendToken;
      return (
        <TokenSelectView
          currentToken={currentTokenForSelect}
          onBack={handleActionBack}
          onClose={closeActionView}
          onSelect={setSendToken}
          title="Send"
          tokens={tokensForSelect}
        />
      );
    }

    if (type === "shieldTokenSelect") {
      return (
        <TokenSelectView
          currentToken={shieldToken}
          isTokenSelected={(token) =>
            token.mint === shieldToken.mint &&
            (token.isSecured
              ? shieldDirection === "unshield"
              : shieldDirection === "shield")
          }
          onBack={handleActionBack}
          onClose={closeActionView}
          onSelect={(token) => {
            const nextDirection = token.isSecured ? "unshield" : "shield";
            const baseToken =
              derivedTokens.find(
                (nextToken) => nextToken.mint === token.mint
              ) ??
              personalWalletPositions
                .filter((position) => position.asset.mint === token.mint)
                .map(portfolioPositionToSwapToken)[0] ??
              token;

            setShieldToken(baseToken);
            setShieldDirection(nextDirection);
          }}
          title="Select token"
          tokens={shieldSourceTokens}
        />
      );
    }

    if (type === "sendPanel") {
      const sendingFromVault = actionReturnSelection === "vault";
      const effectiveSendToken = sendingFromVault
        ? vaultDerivedTokens.find((entry) => entry.mint === sendToken.mint) ??
          vaultDerivedTokens[0] ?? { ...sendToken, balance: 0 }
        : sendToken;
      const vaultContextProp = sendingFromVault
        ? buildVaultSendContext({
            accountIndex: selectedVaultAccountIndex,
            evaluateCapability:
              smartAccountData.evaluateVaultTransferCapability,
            executeTransfer: async (request) => {
              if (!ensureCanSignAccountAction()) {
                return {
                  success: false,
                  error: "Reconnect wallet to sign this action.",
                };
              }

              return smartAccountData.executeVaultTransfer(request);
            },
            tokenMint: effectiveSendToken.mint,
            tokenDecimals: lookupVaultMintDecimals(
              smartAccountData.overview,
              selectedVaultAccountIndex,
              effectiveSendToken.mint
            ),
            onCreateDraft: handleCreateDraftProposal,
          })
        : undefined;
      const ownAddress = personalWalletAddress;
      const recipientSuggestions: RecipientSuggestion[] | undefined = (() => {
        if (sendingFromVault) {
          if (!ownAddress) return undefined;
          return [
            {
              id: `main:${ownAddress}`,
              label: "Main Account",
              address: ownAddress,
              icon: "/agents/Agent-01.svg",
              kind: "agent" as const,
            },
          ];
        }
        const suggestions: RecipientSuggestion[] = [];
        const seen = new Set<string>();
        for (const vault of smartAccountData.vaultEntries) {
          if (vault.address && !seen.has(vault.address)) {
            seen.add(vault.address);
            suggestions.push({
              id: `stash:${vault.address}`,
              label: vault.label,
              address: vault.address,
              icon: getVaultIcon(vault.accountIndex),
              kind: "stash",
            });
          }
          for (const signer of vault.signers) {
            if (signer.scope !== "policy") continue;
            if (!signer.address || seen.has(signer.address)) continue;
            if (ownAddress && signer.address === ownAddress) continue;
            seen.add(signer.address);
            suggestions.push({
              id: `agent:${signer.address}`,
              label: signer.label,
              address: signer.address,
              icon: signer.icon,
              kind: "agent",
            });
          }
        }
        return suggestions.length > 0 ? suggestions : undefined;
      })();
      return (
        <SendContent
          addLocalActivity={walletDesktopData.addLocalActivity}
          allowPrivateSend={!sendingFromVault && !selectedSignerId}
          initialRecipient={sendInitialRecipient}
          onClose={closeActionView}
          onDone={closeActionView}
          onNavigate={pushView}
          onSuccess={handleSendSuccess}
          recipientSuggestions={recipientSuggestions}
          token={effectiveSendToken}
          vaultContext={vaultContextProp}
        />
      );
    }

    if (type === "receivePanel") {
      const receiveAddress =
        actionReturnSelection === "vault"
          ? selectedVault?.entry.address ?? personalWalletAddress
          : personalWalletAddress;

      return (
        <ReceiveContent
          onClose={closeActionView}
          walletAddress={receiveAddress}
        />
      );
    }

    if (type === "swapPanel") {
      const isVaultSwap = actionReturnSelection === "vault";
      const refreshAfterWalletAction = isVaultSwap
        ? undefined
        : refreshMainAccountBalances;
      const showTabs =
        !isVaultSwap &&
        (swapMode === "swap" ? swapFormActive : shieldFormActive);
      const buttonProps =
        swapMode === "swap" ? swapButtonProps : shieldButtonProps;

      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            height: "100%",
            minHeight: 0,
          }}
        >
          {showTabs && (
            <SwapShieldTabs
              mode={swapMode}
              onClose={closeActionView}
              onModeChange={handleSwapModeChange}
            />
          )}
          <div
            style={{
              position: "relative",
              flex: 1,
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                transform:
                  swapMode === "swap" ? "translateX(0)" : "translateX(-100%)",
                transition: "transform 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)",
                willChange: "transform",
              }}
            >
              <SwapContent
                fromToken={swapFromToken}
                hideFormChrome
                onClose={closeActionView}
                onDone={closeActionView}
                onFormActiveChange={setSwapFormActive}
                onFormButtonChange={setSwapButtonProps}
                onFromTokenChange={setSwapFromToken}
                onNavigate={pushView}
                onSuccess={refreshAfterWalletAction}
                onSwapModeChange={handleSwapModeChange}
                onToTokenChange={setSwapToToken}
                swapMode={swapMode}
                toToken={swapToToken}
              />
            </div>
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                transform:
                  swapMode === "shield" ? "translateX(0)" : "translateX(100%)",
                transition: "transform 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)",
                willChange: "transform",
              }}
            >
              <ShieldContent
                hideFormChrome
                onClose={closeActionView}
                onDone={closeActionView}
                onFormActiveChange={setShieldFormActive}
                onFormButtonChange={setShieldButtonProps}
                initialDirection={shieldDirection}
                onNavigate={pushView}
                onSuccess={refreshAfterWalletAction}
                onSwapModeChange={handleSwapModeChange}
                onTokenChange={setShieldToken}
                securedBalance={shieldSecuredBalance}
                swapMode={swapMode}
                token={shieldToken}
              />
            </div>
          </div>

          {buttonProps && (
            <div style={{ padding: "16px 20px" }}>
              <button
                disabled={buttonProps.disabled}
                onClick={buttonProps.onClick}
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  borderRadius: "9999px",
                  background: buttonProps.disabled ? "#CCCDCD" : "#000",
                  border: "none",
                  cursor: buttonProps.disabled ? "default" : "pointer",
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: "16px",
                  fontWeight: 400,
                  lineHeight: "20px",
                  color: "#fff",
                  textAlign: "center",
                  transition: "background 0.15s ease",
                }}
                type="button"
              >
                {buttonProps.label}
              </button>
            </div>
          )}
        </div>
      );
    }

    return null;
  }

  // Whichever staged review is active, flattened to one props bag so the review
  // pane can render a single sliding overlay for all flows.
  const earnReviewPane = earnDepositReviewItem
    ? {
        actionError: proposalActionError,
        approval: earnDepositReviewItem,
        isSubmitting:
          isEarnAutoSigning ||
          smartAccountData.isActionPending ||
          isEarnDepositPreparePending ||
          isEarnWithdrawPreparePending,
        onApprove: handleContinueEarnDepositReview,
        onBack: handleOpenEarn,
        onClose: handleOpenEarn,
        onDecline: handleDismissEarnDepositPreview,
        onExecute: handleContinueEarnDepositReview,
      }
    : earnWithdrawReviewItem
    ? {
        actionError: proposalActionError,
        approval: earnWithdrawReviewItem,
        isSubmitting:
          isEarnAutoSigning ||
          smartAccountData.isActionPending ||
          isEarnDepositPreparePending ||
          isEarnWithdrawPreparePending,
        onApprove: handleContinueEarnWithdrawReview,
        onBack: handleBackFromEarnWithdraw,
        onClose: handleBackFromEarnWithdraw,
        onDecline: handleDismissEarnWithdrawPreview,
        onExecute: handleContinueEarnWithdrawReview,
      }
    : earnCleanupReviewItem
    ? {
        actionError: proposalActionError,
        approval: earnCleanupReviewItem,
        isSubmitting:
          isEarnAutoSigning ||
          smartAccountData.isActionPending ||
          isEarnDepositPreparePending ||
          isEarnWithdrawPreparePending,
        onApprove: () => void handleCompleteEarnCleanup(),
        onBack: handleBackFromEarnWithdraw,
        onClose: handleBackFromEarnWithdraw,
        onDecline: handleDismissEarnWithdrawPreview,
        onExecute: () => void handleCompleteEarnCleanup(),
      }
    : earnAutodepositSetupReviewItem
    ? {
        actionError: proposalActionError,
        approval: earnAutodepositSetupReviewItem,
        isSubmitting:
          isEarnAutoSigning ||
          smartAccountData.isActionPending ||
          isEarnDepositPreparePending ||
          isEarnWithdrawPreparePending,
        onApprove: () => void handleCompleteEarnAutodepositSetup(),
        onBack: handleBackFromAutodeposit,
        onClose: handleBackFromAutodeposit,
        onDecline: handleDismissEarnAutodepositPreview,
        onExecute: () => void handleCompleteEarnAutodepositSetup(),
      }
    : earnAutodepositCloseReviewItem
    ? {
        actionError: proposalActionError,
        approval: earnAutodepositCloseReviewItem,
        isSubmitting:
          isEarnAutoSigning ||
          smartAccountData.isActionPending ||
          isEarnDepositPreparePending ||
          isEarnWithdrawPreparePending,
        onApprove: () => void handleCompleteEarnAutodepositClose(),
        onBack: handleBackFromAutodeposit,
        onClose: handleBackFromAutodeposit,
        onDecline: handleDismissEarnAutodepositPreview,
        onExecute: () => void handleCompleteEarnAutodepositClose(),
      }
    : shieldedBalancesUnlockReviewItem
    ? {
        actionError: shieldedBalancesUnlockError,
        approval: shieldedBalancesUnlockReviewItem,
        isSubmitting: isShieldedBalancesUnlocking,
        onApprove: () => void unlockShieldedBalances(),
        onBack: dismissShieldedBalancesUnlockReview,
        onClose: dismissShieldedBalancesUnlockReview,
        onDecline: dismissShieldedBalancesUnlockReview,
        onExecute: () => void unlockShieldedBalances(),
      }
    : pendingRootSignerReviewItem
    ? {
        actionError: proposalActionError,
        approval: pendingRootSignerReviewItem,
        isSubmitting: false,
        onApprove: () => {
          if (
            !isMockBackupSignerFlowEnabled ||
            !pendingRootSignerDraft ||
            hasBackupAccount
          ) {
            return;
          }
          const signerAddress = pendingRootSignerDraft.signerAddress;
          const existingSigner = mockRootSigners.find(
            (entry) => entry.address === signerAddress
          );
          const nextSigner =
            existingSigner ??
            ({
              address: signerAddress,
              balanceFraction: walletDesktopData.balanceFraction,
              balanceWhole: walletDesktopData.balanceWhole,
              icon: getMockRootSignerIcon(mockRootSigners.length),
              id: `mock-root-signer:${signerAddress}`,
              label: "Backup Account",
              shortAddress: shortAddressForLabel(signerAddress),
            } satisfies MockRootSignerEntry);
          setMockRootSigners((current) => {
            if (current.some((entry) => entry.address === nextSigner.address)) {
              return current;
            }

            return [...current, nextSigner];
          });
          setPendingRootSignerDraft(null);
          setSelectedSignerId(nextSigner.id);
          setDetailSelection("wallet");
          setSelectedDetail(`${nextSigner.label} · ${nextSigner.shortAddress}`);
        },
        onBack: () => setPendingRootSignerDraft(null),
        onClose: () => setPendingRootSignerDraft(null),
        onDecline: () => setPendingRootSignerDraft(null),
        onExecute: () => undefined,
      }
    : pendingRootSignerRemovalReviewItem
    ? {
        actionError: proposalActionError,
        approval: pendingRootSignerRemovalReviewItem,
        isSubmitting: false,
        onApprove: () => {
          if (
            !isMockBackupSignerFlowEnabled ||
            !pendingRootSignerRemovalDraft
          ) {
            return;
          }
          setMockRootSigners((current) =>
            current.filter(
              (entry) =>
                entry.address !== pendingRootSignerRemovalDraft.signerAddress
            )
          );
          setPendingRootSignerRemovalDraft(null);
          setSelectedSignerId(null);
          setDetailSelection("wallet");
          setSelectedDetail("My Wallet");
        },
        onBack: () => setPendingRootSignerRemovalDraft(null),
        onClose: () => setPendingRootSignerRemovalDraft(null),
        onDecline: () => setPendingRootSignerRemovalDraft(null),
        onExecute: () => undefined,
      }
    : null;

  return (
    <main
      className="wallet-workspace"
      data-policy-view={activeSection === "policies" ? policyView : undefined}
      data-app-mode={appAccessMode}
      data-anonymous-mobile-preview={
        isAnonymousMobilePreview ? "true" : undefined
      }
      data-mobile-pane={mobilePane}
      data-rate-limited={isSmartAccountRateLimited}
      data-review-focused={isReviewApprovalFocused || isEarnReviewExiting}
      data-signed-in={showAccountShell}
      data-workspace-section={activeSection}
      style={
        {
          "--wallet-account-pane-width": `${accountPaneWidth}px`,
          "--wallet-review-pane-width": `${reviewPaneWidth}px`,
        } as React.CSSProperties
      }
    >
      <PrivateClientPreloader
        enabled={canLoadPersonalAccount && hasUnlockedShieldedBalances}
      />

      <WalletWorkspaceLogout
        isSignedIn={isSignedIn}
        mobilePane={mobilePane}
        onDisconnect={handleDisconnect}
      />

      <WalletCommandMenu
        groups={commandGroups}
        onOpenChange={setIsCommandMenuOpen}
        open={isCommandMenuOpen}
      />

      <WalletReconnectPrompt
        expectedWalletAddress={authenticatedWalletAddress}
        onClose={() => setIsReconnectToSignOpen(false)}
        onReady={() => setIsReconnectToSignOpen(false)}
        open={isReconnectToSignOpen}
      />

      {showAccountShell &&
      mobilePane !== "accounts" &&
      !isAnonymousMobilePreview ? (
        <MobileWorkspaceHeader
          canOpenActivity={canOpenMobileActivity}
          onBack={handleMobileBackIntent}
          onOpenActivity={handleOpenMobileActivity}
          pane={mobilePane === "activity" ? "activity" : "detail"}
          title={mobileHeaderTitle}
        />
      ) : null}

      <AnimatePresence initial={false}>
        {isReviewApprovalFocused ? (
          <motion.button
            animate={{ opacity: 1 }}
            aria-label="Close review"
            className="wallet-workspace-review-backdrop"
            exit={{
              opacity: 0,
              // Tracks the review overlay's full exit: mascot fade, then slide.
              transition: { duration: 0.45, ease: "easeOut" },
            }}
            initial={{ opacity: 0 }}
            key="review-backdrop"
            onPointerDown={handleEarnPreviewBackdropPointerDown}
            transition={{ duration: 0.24, ease: "easeOut" }}
            type="button"
          />
        ) : null}
      </AnimatePresence>

      {showAccountShell &&
      !isAnonymousMobilePreview &&
      (!isSmartAccountRateLimited ||
        activeSection === "policies" ||
        activeSection === "settings") ? (
        <>
          <section className="wallet-workspace-pane wallet-workspace-account-pane">
            {activeSection === "policies" ? (
              <PoliciesPane
                onNewPolicy={handleNewPolicy}
                onOpenAgent={handleOpenFirstPolicyAgent}
                onSelectPolicy={setSelectedPolicyId}
                selectedPolicyId={selectedPolicyId}
              />
            ) : activeSection === "settings" ? (
              <SettingsPane />
            ) : (
              <PortfolioContent
                approvals={smartAccountData.approvals}
                balanceFraction={totalBalance.balanceFraction}
                balanceWhole={totalBalance.balanceWhole}
                earnDepositLabel={canMutateAccount ? "Deposit" : "Connect"}
                earnBalance={earnCurrentBalanceAmount}
                hasEarnPolicy={hasEarnPolicy}
                hasEarnPosition={hasEarnPosition}
                hasVaultAccount={smartAccountData.vaultEntries.length > 0}
                isBalanceHidden={isBalanceHidden}
                isEarnPositionLoading={isEarnPositionInitialLoading}
                isLoading={isWorkspaceLoading || isSmartAccountShellLoading}
                enableMockBackupSignerFlow={isMockBackupSignerFlowEnabled}
                mockRootSigners={activeMockRootSigners}
                onBalanceHiddenChange={setIsBalanceHidden}
                onClose={() => undefined}
                onDisconnect={handleDisconnect}
                onOpenAgent={handleOpenAgent}
                onOpenAddSigner={
                  isMockBackupSignerFlowEnabled
                    ? handleOpenAddSigner
                    : undefined
                }
                onOpenMockRootSigner={
                  isMockBackupSignerFlowEnabled
                    ? handleOpenMockRootSigner
                    : undefined
                }
                onOpenReceive={() => handleRailAction("receive")}
                onOpenSend={() => handleRailAction("send")}
                onOpenShield={() => handleRailAction("shield")}
                onOpenSwap={() => handleRailAction("swap")}
                onOpenEarnDeposit={
                  canMutateAccount ? handleOpenEarnDeposit : openSignIn
                }
                onOpenEarn={
                  hasEarnPosition || isEarnPositionInitialLoading
                    ? handleOpenEarn
                    : handleOpenEarnDeposit
                }
                onOpenAutodeposit={handleOpenAutodeposit}
                onOpenCreateAccount={canMutateAccount ? undefined : openSignIn}
                autodepositDepositedLabel={autodepositDepositedLabel}
                autodepositFloorLabel={autodepositFloorLabel}
                isAutodepositConfigured={isAutodepositReady}
                isAutodepositPending={isAutodepositPendingSetup}
                hasEarnStateLoadError={Boolean(
                  smartAccountData.earnStateLoadErrors.autodeposit
                )}
                hasEarnStateResolved={smartAccountData.hasEarnStateResolved}
                isEarnStateLoading={smartAccountData.isEarnStateLoading}
                onOpenVault={handleOpenVault}
                onSmartAccountRetry={() => {
                  void smartAccountData.refresh();
                }}
                onReviewApproval={handleReviewApproval}
                onSeeAllApprovals={() => {
                  markDetailPaneTransition("switch");
                  setDetailSelection("approval");
                  setSelectedDetail("Approvals");
                  setMobilePane("detail");
                }}
                selectedSignerId={selectedSignerId}
                selectedVaultIndex={smartAccountData.selectedVaultIndex}
                isEarnSelected={
                  activeDetailSelection === "earn" ||
                  activeDetailSelection === "earnAutodeposit" ||
                  activeDetailSelection === "earnDeposit" ||
                  activeDetailSelection === "earnWithdraw"
                }
                isWalletSelected={
                  (detailSelection === "wallet" ||
                    (detailSelection === "action" &&
                      actionReturnSelection === "wallet")) &&
                  selectedSignerId === null
                }
                showActionButtons={false}
                showApprovals={false}
                showHeaderControls={false}
                showMainAccountOnly
                smartAccountError={smartAccountData.error}
                topInset={47}
                vaultEntries={smartAccountData.vaultEntries}
                portfolioChange24h={
                  canLoadPersonalAccount
                    ? walletDesktopData.portfolioChange24h
                    : null
                }
                earningsSummary={
                  canLoadPersonalAccount
                    ? walletDesktopData.earningsSummary
                    : null
                }
              />
            )}
          </section>

          <button
            aria-label="Resize account pane"
            className="wallet-workspace-resize-handle wallet-workspace-account-resize"
            onPointerDown={(event) => handleResizeStart("account", event)}
            type="button"
          />
        </>
      ) : null}

      <section className="wallet-workspace-pane wallet-workspace-detail-pane">
        <div
          className="wallet-workspace-detail-transition"
          data-transition={detailPaneTransition}
          key={detailPaneTransitionKey}
        >
          {renderDetailPane()}
        </div>
      </section>

      {showAccountShell &&
      !isAnonymousMobilePreview &&
      (!isSmartAccountRateLimited || activeSection === "policies") ? (
        <>
          <button
            aria-label="Resize approvals pane"
            className="wallet-workspace-resize-handle wallet-workspace-review-resize"
            onPointerDown={(event) => handleResizeStart("review", event)}
            type="button"
          />

          <section className="wallet-workspace-pane wallet-workspace-review-pane">
            {activeSection === "policies" ? (
              <AnimatePresence initial={false}>
                {policyView === "builder" ? (
                  <motion.div
                    animate={{
                      x: 0,
                      transition: {
                        duration: 0.4,
                        ease: [0.22, 1, 0.36, 1],
                      },
                    }}
                    className="wallet-workspace-review-anim"
                    exit={{
                      x: "100%",
                      transition: {
                        delay: 0.4,
                        duration: 0.4,
                        ease: [0.22, 1, 0.36, 1],
                      },
                    }}
                    initial={{ x: "100%" }}
                    key="builder-blocks"
                  >
                    <BuilderBlocksPane />
                  </motion.div>
                ) : null}
              </AnimatePresence>
            ) : isEarnReviewContext ? (
              <EarnTransactionsPane
                hasCurrentPosition={hasEarnPosition}
                isAutodepositConfigured={isAutodepositReady}
                isBalanceHidden={isBalanceHidden}
                isExecutingScheduledSweep={isExecutingScheduledSweep}
                onExperimentalModeToggle={toggleExperimentalMode}
                onExecuteScheduledSweep={handleExecuteScheduledAutodepositSweep}
                onRefreshScheduledSweeps={smartAccountData.refresh}
                onSelectTransaction={(detail) => {
                  openActionView(
                    { type: "transaction", detail, from: "portfolio" },
                    "Transaction",
                    "",
                    "earn"
                  );
                }}
                pendingScheduledSweep={pendingScheduledSweepPreview}
                refreshKey={earnTransactionsRefreshKey}
                scheduledSweepExecuteError={scheduledSweepExecuteError}
                scheduledSweeps={earnTransactionScheduledSweeps}
                showPolicyRefundScan={
                  canLoadPersonalAccount && isMockBackupSignerFlowEnabled
                }
                settingsPda={smartAccountData.overview?.settingsPda}
                solanaEnv={publicEnv.solanaEnv}
                walletAddress={personalWalletAddress}
              />
            ) : shouldShowApprovalsSkeleton ? (
              <WorkspaceApprovalsSkeleton />
            ) : (
              <ApprovalsPane
                actionError={proposalActionError}
                approvals={smartAccountData.approvals}
                error={smartAccountData.error}
                isBalanceHidden={isBalanceHidden}
                isSubmitting={smartAccountData.isActionPending}
                onApprove={(approval) =>
                  void runProposalAction(() =>
                    smartAccountData.approveProposal(approval.proposal)
                  )
                }
                draft={draftProposal}
                draftError={draftError}
                isDraftSubmitting={isDraftSubmitting}
                permissionDraft={permissionDraft}
                permissionDraftError={permissionDraftError}
                isPermissionDraftSubmitting={isPermissionDraftSubmitting}
                onCancelPermissionDraft={handleCancelPermissionDraft}
                onSubmitPermissionDraft={() =>
                  void handleSubmitPermissionDraft()
                }
                spendingLimitDraft={spendingLimitDraft}
                spendingLimitDraftError={spendingLimitDraftError}
                isSpendingLimitDraftSubmitting={isSpendingLimitDraftSubmitting}
                onCancelSpendingLimitDraft={handleCancelSpendingLimitDraft}
                onSubmitSpendingLimitDraft={() =>
                  void handleSubmitSpendingLimitDraft()
                }
                onBackToList={() => {
                  setSelectedApprovalId(null);
                  setProposalActionError(null);
                  setDraftError(null);
                }}
                onCancelDraft={handleCancelDraftProposal}
                onDecline={(approval) =>
                  void runProposalAction(() =>
                    smartAccountData.rejectProposal(approval.proposal)
                  )
                }
                onExecute={(approval) =>
                  void runProposalAction(() =>
                    smartAccountData.executeProposal(approval.proposal)
                  )
                }
                onReview={handleReviewApproval}
                onReviewDraft={(draft) => {
                  setSelectedApprovalId(draft.id);
                  setDraftError(null);
                }}
                onRetry={() => {
                  void smartAccountData.refresh();
                }}
                onSubmitDraft={() => void handleSubmitDraftProposal()}
                pendingApprovalId={smartAccountData.pendingProposalId}
                selectedApproval={selectedApproval}
                selectedDraft={
                  draftProposal && selectedApprovalId === draftProposal.id
                    ? draftProposal
                    : null
                }
              />
            )}
            <AnimatePresence
              initial={false}
              onExitComplete={() => setIsEarnReviewExiting(false)}
            >
              {earnReviewPane ? (
                <motion.div
                  animate="enter"
                  className="wallet-workspace-earn-review-overlay"
                  exit="exit"
                  initial="hidden"
                  key="earn-review"
                  variants={EARN_REVIEW_OVERLAY_VARIANTS}
                >
                  <ApprovalReviewContent
                    actionError={earnReviewPane.actionError}
                    approval={earnReviewPane.approval}
                    isSubmitting={earnReviewPane.isSubmitting}
                    onApprove={earnReviewPane.onApprove}
                    onBack={earnReviewPane.onBack}
                    onClose={earnReviewPane.onClose}
                    onDecline={earnReviewPane.onDecline}
                    onExecute={earnReviewPane.onExecute}
                    showBack={false}
                    showClose={false}
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </section>
        </>
      ) : null}

      {/* Footer intentionally hidden during the wallet workspace redesign. */}

      <style jsx global>{`
        .wallet-workspace {
          display: grid;
          grid-template-columns:
            32px
            minmax(360px, var(--wallet-account-pane-width))
            8px
            minmax(420px, 1fr)
            8px
            minmax(320px, var(--wallet-review-pane-width));
          height: 100dvh;
          max-height: 100dvh;
          min-height: 0;
          width: 100%;
          overflow: hidden;
          background: #fff;
          color: #000;
          font-family: var(--font-geist-sans), sans-serif;
        }

        .wallet-workspace[data-signed-in="false"] {
          grid-template-columns: 32px minmax(0, 1fr);
        }

        .wallet-workspace[data-rate-limited="true"] {
          grid-template-columns: 32px minmax(420px, 1fr);
        }

        .wallet-workspace[data-workspace-section="policies"] {
          grid-template-columns:
            32px minmax(360px, var(--wallet-account-pane-width)) 8px
            minmax(420px, 1fr) 8px
            minmax(320px, var(--wallet-review-pane-width));
        }

        .wallet-workspace-logout {
          position: fixed;
          left: 16px;
          bottom: 16px;
          z-index: 30;
          width: 44px;
          height: 44px;
          border-radius: 9999px;
          border: 0;
          background: rgba(0, 0, 0, 0.04);
          color: rgba(60, 60, 67, 0.58);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease,
            transform 0.15s ease;
        }

        .wallet-workspace-logout:hover {
          background: rgba(249, 54, 60, 0.12);
          color: #f9363c;
          transform: translateY(-1px);
        }

        .wallet-workspace-logout:focus-visible {
          outline: 2px solid rgba(249, 54, 60, 0.55);
          outline-offset: 2px;
        }

        .wallet-workspace-logout[data-disabled="true"] {
          cursor: default;
          opacity: 0.35;
        }

        .wallet-workspace-logout[data-disabled="true"]:hover {
          background: rgba(0, 0, 0, 0.04);
          color: rgba(60, 60, 67, 0.58);
          transform: none;
        }

        .wallet-workspace-mobile-header {
          display: none;
        }

        .wallet-workspace-mobile-icon-button {
          display: inline-flex;
          width: 40px;
          height: 40px;
          align-items: center;
          justify-content: center;
          border: 0;
          border-radius: 9999px;
          background: rgba(0, 0, 0, 0.04);
          color: #3c3c43;
          cursor: pointer;
          transition: background 0.15s ease, transform 0.15s ease;
        }

        .wallet-workspace-mobile-icon-button:hover {
          background: rgba(0, 0, 0, 0.08);
          transform: translateY(-1px);
        }

        .wallet-workspace-mobile-icon-button:active {
          transform: translateY(0);
        }

        .wallet-workspace-mobile-action-button {
          display: inline-flex;
          min-width: 0;
          height: 40px;
          align-items: center;
          justify-content: center;
          gap: 6px;
          border: 0;
          border-radius: 9999px;
          background: rgba(0, 0, 0, 0.04);
          color: #000;
          cursor: pointer;
          font-family: var(--font-geist-sans), sans-serif;
          font-size: 13px;
          font-weight: 600;
          line-height: 18px;
          padding: 0 12px;
          white-space: nowrap;
          transition: background 0.15s ease, transform 0.15s ease;
        }

        .wallet-workspace-mobile-action-button:hover {
          background: rgba(0, 0, 0, 0.08);
          transform: translateY(-1px);
        }

        .wallet-workspace-mobile-action-button:active {
          transform: translateY(0);
        }

        .wallet-workspace-mobile-title {
          min-width: 0;
          overflow: hidden;
          color: #000;
          font-family: var(--font-geist-sans), sans-serif;
          font-size: 17px;
          font-weight: 600;
          line-height: 22px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .wallet-workspace-mobile-spacer {
          width: 40px;
          height: 40px;
        }

        .wallet-workspace-pane {
          height: 100%;
          min-height: 0;
          min-width: 0;
          overflow: hidden;
          background: #fff;
        }

        .wallet-workspace-account-pane {
          grid-column: 2;
          display: flex;
          box-sizing: border-box;
          min-height: 0;
          padding-top: 8px;
          border-right: 1px solid rgba(0, 0, 0, 0.06);
        }

        .wallet-workspace[data-workspace-section="policies"]
          .wallet-workspace-account-pane {
          border-right: 0;
        }

        .wallet-workspace-account-pane > div {
          height: 100%;
          min-height: 0;
          width: 100%;
        }

        .wallet-workspace-detail-pane {
          grid-column: 4;
          display: flex;
          flex-direction: column;
          min-height: 0;
          padding: 8px;
          border-right: 1px solid rgba(0, 0, 0, 0.06);
        }

        .wallet-workspace[data-workspace-section="policies"]
          .wallet-workspace-detail-pane {
          padding: 8px 0;
          overflow: hidden;
        }

        .wallet-workspace[data-workspace-section="policies"][data-policy-view="builder"]
          .wallet-workspace-detail-pane {
          border-right: 0;
        }

        .wallet-workspace[data-workspace-section="policies"][data-policy-view="details"]
          .wallet-workspace-detail-pane {
          border-right: 1px solid rgba(0, 0, 0, 0.06) !important;
        }

        .wallet-workspace[data-workspace-section="policies"]
          .wallet-workspace-detail-pane {
          grid-column: 4 !important;
        }

        .wallet-workspace[data-signed-in="false"]
          .wallet-workspace-detail-pane {
          grid-column: 2;
          border-right: 0;
        }

        .wallet-workspace[data-rate-limited="true"]
          .wallet-workspace-detail-pane {
          grid-column: 2;
          border-right: 0;
        }

        .wallet-workspace-detail-pane > div {
          min-height: 0;
          width: 100%;
        }

        /* Constrain every center pane to the same readable fixed width the Earn
           pane uses. Excludes the policies section, whose workflow builder is
           intentionally full-width. */
        .wallet-workspace:not([data-workspace-section="policies"])
          .wallet-workspace-detail-pane
          > div {
          max-width: 768px;
          margin-inline: auto;
        }

        /* Focus the active approval: darken everything with a scrim and lift
           the review pane above it so only the approval stays bright. */
        .wallet-workspace-review-backdrop {
          position: fixed;
          inset: 0;
          z-index: 40;
          background: rgba(0, 0, 0, 0.5);
          border: 0;
          cursor: default;
          margin: 0;
          padding: 0;
        }

        .wallet-workspace-review-backdrop:focus {
          outline: none;
        }

        .wallet-workspace[data-review-focused="true"]
          .wallet-workspace-review-pane {
          position: relative;
          z-index: 50;
          /* Keep the staged review as an opaque drawer over the Earn rail. */
          overflow: hidden;
        }

        .wallet-workspace-detail-transition {
          display: flex;
          width: 100%;
          height: 100%;
          min-height: 0;
          flex-direction: column;
          animation: wallet-workspace-pane-switch 0.18s ease-out both;
          will-change: opacity, transform;
        }

        .wallet-workspace-detail-transition > * {
          width: 100%;
          min-height: 0;
          flex: 1 1 auto;
        }

        .wallet-workspace-policies-stack {
          position: relative;
          display: flex;
          width: 100%;
          height: 100%;
          min-height: 0;
          flex-direction: column;
        }

        .wallet-workspace-policies-stack > * {
          width: 100%;
          min-height: 0;
          flex: 1 1 auto;
        }

        .wallet-workspace-builder-overlay {
          position: absolute;
          inset: 0;
          z-index: 1;
          display: flex;
          flex-direction: column;
          will-change: transform;
        }

        .wallet-workspace-review-anim {
          display: flex;
          width: 100%;
          height: 100%;
          min-height: 0;
          flex-direction: column;
          will-change: transform;
        }

        /* Earn approval review: slides in from the right over the pane's
           regular content and back out on dismissal. Mirrors the pane's own
           padding so the review keeps its usual inset. */
        .wallet-workspace-earn-review-overlay {
          position: absolute;
          inset: 0;
          z-index: 10;
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
          padding: 8px 8px 8px 0;
          background: #fff;
          will-change: transform;
        }

        .wallet-workspace-detail-transition[data-transition="forward"] {
          animation: wallet-workspace-pane-forward 0.24s
            cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        .wallet-workspace-detail-transition[data-transition="back"] {
          animation: wallet-workspace-pane-back 0.22s
            cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        .wallet-workspace-detail-transition[data-transition="open"] {
          animation: wallet-workspace-pane-open 0.2s
            cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        .wallet-workspace-detail-transition[data-transition="close"] {
          animation: wallet-workspace-pane-close 0.18s ease-out both;
        }

        .wallet-workspace-review-pane {
          grid-column: 6;
          padding: 8px 8px 8px 0;
          /* Anchors the sliding Earn review overlay. */
          position: relative;
        }

        .wallet-workspace[data-workspace-section="policies"]
          .wallet-workspace-review-pane {
          padding: 8px 8px 8px 0;
        }

        .wallet-workspace[data-workspace-section="policies"][data-policy-view="builder"]
          .wallet-workspace-review-resize {
          position: relative;
          z-index: 2;
          background: #f5f5f5;
          background-clip: content-box;
          box-sizing: border-box;
          padding: 8px 0;
        }

        .wallet-workspace[data-workspace-section="policies"][data-policy-view="builder"]
          .wallet-workspace-review-resize:hover,
        .wallet-workspace[data-workspace-section="policies"][data-policy-view="builder"]
          .wallet-workspace-review-resize:focus-visible {
          background: #f5f5f5;
          background-clip: content-box;
        }

        .wallet-workspace[data-workspace-section="policies"][data-policy-view="details"]
          .wallet-workspace-review-resize {
          background: transparent;
        }

        .wallet-workspace-resize-handle {
          width: 8px;
          height: 100%;
          min-height: 0;
          padding: 0;
          border: 0;
          background: transparent;
          cursor: col-resize;
          transition: background 0.15s ease;
        }

        .wallet-workspace-resize-handle:hover,
        .wallet-workspace-resize-handle:focus-visible {
          background: rgba(249, 54, 60, 0.12);
          outline: none;
        }

        .wallet-workspace-account-resize {
          grid-column: 3;
        }

        .wallet-workspace-review-resize {
          grid-column: 5;
        }

        @keyframes wallet-workspace-skeleton {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.46;
          }
        }

        .wallet-workspace-loading-detail,
        .wallet-workspace-loading-approvals {
          display: flex;
          height: 100%;
          min-height: 0;
          flex-direction: column;
        }

        .wallet-workspace-loading-detail {
          padding: 36px 48px;
          overflow: hidden;
        }

        .wallet-workspace-loading-hero {
          display: flex;
          align-items: center;
          gap: 20px;
        }

        .wallet-workspace-loading-hero-copy,
        .wallet-workspace-loading-token-copy,
        .wallet-workspace-loading-token-values {
          display: flex;
          min-width: 0;
          flex-direction: column;
          gap: 8px;
        }

        .wallet-workspace-skeleton-line,
        .wallet-workspace-skeleton-avatar,
        .wallet-workspace-skeleton-balance,
        .wallet-workspace-skeleton-pill,
        .wallet-workspace-skeleton-token,
        .wallet-workspace-skeleton-approval-icon {
          background: rgba(0, 0, 0, 0.055);
          animation: wallet-workspace-skeleton 1.55s ease-in-out infinite;
        }

        .wallet-workspace-skeleton-avatar {
          width: 96px;
          height: 96px;
          flex: 0 0 auto;
          border-radius: 26px;
        }

        .wallet-workspace-skeleton-line {
          height: 16px;
          border-radius: 999px;
        }

        .wallet-workspace-skeleton-line-title {
          width: 154px;
          height: 28px;
        }

        .wallet-workspace-skeleton-line-short {
          width: 196px;
          height: 18px;
        }

        .wallet-workspace-skeleton-balance {
          width: min(330px, 72%);
          height: 76px;
          margin-top: 28px;
          border-radius: 22px;
        }

        .wallet-workspace-loading-actions {
          display: grid;
          grid-template-columns: repeat(4, minmax(88px, 1fr));
          gap: 12px;
          margin-top: 28px;
        }

        .wallet-workspace-skeleton-pill {
          height: 56px;
          border-radius: 999px;
        }

        .wallet-workspace-skeleton-pill-active {
          background: rgba(0, 0, 0, 0.1);
        }

        .wallet-workspace-loading-tabs {
          display: flex;
          gap: 32px;
          margin-top: 52px;
        }

        .wallet-workspace-skeleton-line-tab {
          width: 92px;
          height: 24px;
          background: rgba(0, 0, 0, 0.09);
        }

        .wallet-workspace-skeleton-line-tab-muted {
          width: 104px;
          height: 24px;
        }

        .wallet-workspace-loading-token-list {
          display: flex;
          min-height: 0;
          flex-direction: column;
          gap: 10px;
          margin-top: 28px;
          overflow: hidden;
        }

        .wallet-workspace-loading-token-row {
          display: grid;
          grid-template-columns: 56px minmax(0, 1fr) minmax(92px, auto);
          align-items: center;
          gap: 16px;
          padding: 8px 0;
        }

        .wallet-workspace-skeleton-token {
          width: 56px;
          height: 56px;
          border-radius: 999px;
        }

        .wallet-workspace-skeleton-line-token {
          width: 118px;
          height: 22px;
        }

        .wallet-workspace-skeleton-line-price {
          width: 72px;
          height: 16px;
        }

        .wallet-workspace-loading-token-values {
          align-items: flex-end;
        }

        .wallet-workspace-skeleton-line-amount {
          width: 88px;
          height: 22px;
        }

        .wallet-workspace-skeleton-line-value {
          width: 64px;
          height: 16px;
        }

        .wallet-workspace-loading-approvals {
          padding: 20px 24px;
        }

        .wallet-workspace-skeleton-line-approvals-title {
          width: 112px;
          height: 28px;
          background: rgba(0, 0, 0, 0.09);
        }

        .wallet-workspace-loading-approval-card {
          display: flex;
          flex: 1;
          min-height: 0;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
        }

        .wallet-workspace-skeleton-approval-icon {
          width: 56px;
          height: 56px;
          border-radius: 999px;
        }

        .wallet-workspace-skeleton-line-approval-main {
          width: 156px;
          height: 20px;
        }

        .wallet-workspace-skeleton-line-approval-sub {
          width: 210px;
          height: 16px;
        }

        .wallet-workspace-error-pane {
          display: flex;
          height: 100%;
          min-height: 0;
          align-items: center;
          justify-content: center;
          padding: 32px;
        }

        .wallet-workspace-error-card {
          display: flex;
          width: min(360px, 100%);
          flex-direction: column;
          align-items: center;
          gap: 14px;
          border-radius: 32px;
          background: #f5f5f5;
          padding: 28px;
          text-align: center;
        }

        .wallet-workspace-error-icon {
          display: inline-flex;
          width: 60px;
          height: 60px;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          background: #fde8e9;
          color: #f9363c;
        }

        .wallet-workspace-error-title {
          margin: 0;
          font-size: 20px;
          font-weight: 600;
          line-height: 24px;
          color: #000;
        }

        .wallet-workspace-error-copy {
          margin: 8px 0 0;
          font-size: 14px;
          line-height: 20px;
          color: rgba(60, 60, 67, 0.6);
        }

        .wallet-workspace-error-card button {
          margin-top: 4px;
          border: 0;
          border-radius: 999px;
          background: #000;
          color: #fff;
          cursor: pointer;
          font-family: inherit;
          font-size: 14px;
          font-weight: 500;
          line-height: 18px;
          padding: 10px 18px;
          transition: background 0.15s ease, transform 0.15s ease;
        }

        .wallet-workspace-error-card button:hover {
          background: rgba(0, 0, 0, 0.82);
          transform: translateY(-1px);
        }

        .wallet-workspace-placeholder {
          display: flex;
          height: 100%;
          min-height: 0;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border-radius: 18px;
          color: rgba(60, 60, 67, 0.6);
          text-align: center;
        }

        .wallet-workspace-placeholder-left {
          align-items: flex-start;
          justify-content: flex-start;
          padding: 40px 32px;
          text-align: left;
        }

        .wallet-workspace-placeholder span {
          font-size: 13px;
          line-height: 16px;
          color: rgba(60, 60, 67, 0.6);
        }

        .wallet-workspace-placeholder strong {
          margin: 0;
          font-size: 20px;
          font-weight: 600;
          line-height: 24px;
          color: #000;
        }

        .wallet-workspace-auth-detail {
          display: flex;
          height: 100%;
          min-height: 0;
          align-items: center;
          justify-content: center;
          padding: 48px;
        }

        .wallet-workspace-auth-detail-main {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .wallet-signin-screen {
          display: flex;
          height: 100%;
          min-height: 0;
          align-items: center;
          justify-content: center;
          padding: 44px;
          overflow-y: auto;
        }

        .wallet-signin-card {
          display: grid;
          grid-template-columns: 1.05fr 0.95fr;
          width: 100%;
          max-width: 880px;
          overflow: hidden;
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 32px;
          background: #fff;
        }

        .wallet-signin-brand {
          display: flex;
          flex-direction: column;
          gap: 26px;
          padding: 44px;
          border-right: 1px solid rgba(0, 0, 0, 0.07);
          background: #f7f7f8;
        }

        .wallet-signin-mascot {
          width: 124px;
          margin-left: -6px;
        }

        .wallet-signin-mascot svg {
          width: 124px;
          height: auto;
        }

        .wallet-signin-headline {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .wallet-signin-headline h2 {
          margin: 0;
          color: #0a0a0a;
          font-size: 32px;
          font-weight: 600;
          line-height: 34px;
          letter-spacing: -0.4px;
        }

        .wallet-signin-headline p {
          margin: 0;
          max-width: 320px;
          color: rgba(60, 60, 67, 0.6);
          font-size: 15px;
          line-height: 21px;
        }

        .wallet-signin-values {
          display: flex;
          flex-direction: column;
          gap: 16px;
          margin-top: 2px;
        }

        .wallet-signin-value {
          display: flex;
          align-items: flex-start;
          gap: 12px;
        }

        .wallet-signin-value-icon {
          display: inline-flex;
          width: 38px;
          height: 38px;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          border-radius: 11px;
          background: rgba(249, 54, 60, 0.1);
          color: #f9363c;
        }

        .wallet-signin-value-copy {
          display: flex;
          min-width: 0;
          flex-direction: column;
          gap: 2px;
          padding-top: 1px;
        }

        .wallet-signin-value-copy strong {
          color: #0a0a0a;
          font-size: 14px;
          font-weight: 500;
          line-height: 18px;
        }

        .wallet-signin-value-copy small {
          color: rgba(60, 60, 67, 0.6);
          font-size: 13px;
          line-height: 17px;
        }

        .wallet-signin-form {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 22px;
          padding: 44px;
          background: #fff;
        }

        .wallet-signin-form-head {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .wallet-signin-form-head h3 {
          margin: 0;
          color: #0a0a0a;
          font-size: 22px;
          font-weight: 600;
          line-height: 28px;
          letter-spacing: -0.2px;
        }

        .wallet-signin-form-head p {
          margin: 0;
          color: rgba(60, 60, 67, 0.6);
          font-size: 14px;
          line-height: 20px;
        }

        @media (max-width: 860px) {
          .wallet-signin-screen {
            align-items: flex-start;
            padding: 36px 24px;
          }

          .wallet-signin-card {
            max-width: 440px;
            grid-template-columns: 1fr;
          }

          .wallet-signin-brand {
            gap: 18px;
            padding: 28px;
            border-right: 0;
            border-bottom: 1px solid rgba(0, 0, 0, 0.07);
          }

          .wallet-signin-mascot {
            width: 104px;
          }

          .wallet-signin-mascot svg {
            width: 104px;
          }

          .wallet-signin-headline h2 {
            font-size: 27px;
            line-height: 29px;
          }

          .wallet-signin-form {
            padding: 28px;
          }
        }

        .wallet-workspace-auth-cta {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 60px;
          padding: 0 36px;
          border: 0;
          border-radius: 9999px;
          background: #000;
          color: #fff;
          cursor: pointer;
          font: inherit;
          font-size: 18px;
          font-weight: 500;
          letter-spacing: -0.1px;
          transition: background-color 0.15s ease;
        }

        .wallet-workspace-auth-cta-label {
          position: relative;
        }

        .wallet-workspace-auth-cta:hover {
          background: #222;
        }

        .wallet-workspace-auth-cta:active {
          background: #1a1a1a;
        }

        .wallet-workspace-auth-cta:focus-visible {
          outline: 2px solid #000;
          outline-offset: 2px;
        }

        .wallet-workspace-review-empty {
          display: flex;
          height: 100%;
          min-height: 0;
          flex-direction: column;
          align-items: flex-start;
          justify-content: flex-start;
          padding: 28px 24px;
        }

        .wallet-workspace-review-empty strong {
          font-size: 20px;
          line-height: 24px;
          letter-spacing: 0;
        }

        .wallet-workspace-review-empty > span {
          color: rgba(60, 60, 67, 0.6);
          font-size: 13px;
          line-height: 16px;
          margin-bottom: 6px;
        }

        .wallet-workspace-review-empty p {
          color: rgba(60, 60, 67, 0.6);
          font-size: 15px;
          line-height: 21px;
          margin: 12px 0 0;
          max-width: 360px;
        }

        @keyframes wallet-workspace-pane-forward {
          from {
            opacity: 0;
            transform: translateX(22px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @keyframes wallet-workspace-pane-back {
          from {
            opacity: 0;
            transform: translateX(-22px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @keyframes wallet-workspace-pane-open {
          from {
            opacity: 0;
            transform: translateY(10px) scale(0.985);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes wallet-workspace-pane-close {
          from {
            opacity: 0;
            transform: translateY(-6px) scale(0.992);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes wallet-workspace-pane-switch {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .wallet-workspace-detail-transition {
            animation: none !important;
          }
        }

        @media (max-width: 1024px) {
          .wallet-workspace {
            grid-template-columns:
              32px
              minmax(320px, min(var(--wallet-account-pane-width), 400px))
              8px
              minmax(320px, 1fr);
          }

          .wallet-workspace-review-resize,
          .wallet-workspace-review-pane {
            display: none;
          }

          /* Keep an active approval visible when the grid drops the review
             column — float it as an overlay over the dimmed panes. The pane
             itself is just a transparent positioning shell so the sliding
             review overlay reads as the surface entering from the right. */
          .wallet-workspace[data-review-focused="true"]
            .wallet-workspace-review-pane {
            display: block;
            position: fixed;
            top: 0;
            right: 0;
            bottom: 0;
            width: min(100vw, 420px);
            z-index: 50;
            background: transparent;
          }

          .wallet-workspace[data-review-focused="true"]
            .wallet-workspace-review-pane
            > :not(.wallet-workspace-earn-review-overlay) {
            visibility: hidden;
          }

          .wallet-workspace-earn-review-overlay {
            box-shadow: -8px 0 24px rgba(0, 0, 0, 0.12);
          }

          .wallet-workspace[data-signed-in="false"] {
            grid-template-columns: 32px minmax(0, 1fr);
          }

          .wallet-workspace[data-signed-in="false"]
            .wallet-workspace-detail-pane {
            grid-column: 2;
          }

          .wallet-workspace[data-rate-limited="true"] {
            grid-template-columns: 32px minmax(320px, 1fr);
          }

          .wallet-workspace[data-rate-limited="true"]
            .wallet-workspace-detail-pane {
            grid-column: 2;
            border-right: 0;
          }
        }

        @media (max-width: 760px) {
          :global(.header-wallet) {
            display: none !important;
          }

          .wallet-workspace-logout:not([data-mobile-pane="accounts"]) {
            display: none;
          }

          .wallet-workspace {
            grid-template-columns: minmax(0, 1fr);
            grid-template-rows: minmax(0, 1fr);
            overflow: hidden;
          }

          .wallet-workspace[data-mobile-pane="detail"],
          .wallet-workspace[data-mobile-pane="activity"] {
            grid-template-rows: auto minmax(0, 1fr);
          }

          .wallet-workspace[data-anonymous-mobile-preview="true"][data-mobile-pane="detail"] {
            grid-template-rows: minmax(0, 1fr);
          }

          .wallet-workspace-mobile-header {
            grid-column: 1;
            grid-row: 1;
            display: grid;
            grid-template-columns: 40px minmax(0, 1fr) auto;
            align-items: center;
            gap: 8px;
            min-width: 0;
            padding: 12px 16px 8px;
            background: #fff;
          }

          .wallet-workspace-account-resize,
          .wallet-workspace-review-resize {
            display: none;
          }

          .wallet-workspace-account-pane,
          .wallet-workspace-detail-pane,
          .wallet-workspace-review-pane {
            display: none;
            grid-column: 1;
            grid-row: 2;
            border-right: 0;
          }

          .wallet-workspace-account-pane {
            padding-top: 8px;
          }

          .wallet-workspace-detail-pane,
          .wallet-workspace-review-pane {
            padding: 0;
          }

          .wallet-workspace[data-mobile-pane="accounts"]
            .wallet-workspace-account-pane {
            grid-row: 1 / -1;
            display: flex;
          }

          .wallet-workspace[data-mobile-pane="detail"]
            .wallet-workspace-detail-pane {
            display: flex;
          }

          .wallet-workspace[data-anonymous-mobile-preview="true"][data-mobile-pane="detail"]
            .wallet-workspace-detail-pane {
            grid-row: 1 / -1;
          }

          .wallet-workspace[data-mobile-pane="activity"]
            .wallet-workspace-review-pane {
            display: flex;
          }

          .wallet-workspace[data-mobile-pane="activity"]
            .wallet-workspace-earn-review-overlay {
            padding: 0;
          }

          .wallet-workspace[data-review-focused="true"]
            .wallet-workspace-review-pane {
            display: block;
            position: fixed;
            inset: 0;
            width: 100vw;
            z-index: 50;
          }

          .wallet-workspace[data-rate-limited="true"]
            .wallet-workspace-detail-pane {
            display: flex;
            grid-column: 1;
            grid-row: 1 / -1;
          }

          .wallet-workspace[data-signed-in="false"]
            .wallet-workspace-detail-pane {
            display: flex;
            grid-column: 1;
            grid-row: 1 / -1;
          }

          .wallet-workspace-auth-detail {
            padding: 32px 24px;
          }

          .wallet-workspace-auth-cta {
            height: 56px;
            padding: 0 32px;
            font-size: 17px;
          }
        }
      `}</style>
    </main>
  );
}
