"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  Copy,
  Eye,
  EyeOff,
  File as FileIcon,
  KeyRound,
  LayoutTemplate,
  LogOut,
  Plus,
  RefreshCw,
  Repeat2,
  Shield as ShieldIcon,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { PortfolioPosition } from "@loyal-labs/solana-wallet";
import {
  SOL_SPENDING_LIMIT_MINT,
  type SmartAccountOverview,
  type SmartAccountPreparedEarnUsdcAutodepositClose,
  type SmartAccountPreparedEarnUsdcAutodepositSetup,
  type SmartAccountPreparedEarnUsdcDeposit,
} from "@loyal-labs/smart-account-vaults";
import { useWallet } from "@solana/wallet-adapter-react";
import { AnimatePresence, motion } from "motion/react";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";

import { WalletSignIn } from "@/components/auth/wallet-sign-in";
import { DogWithMood } from "@/components/chat-input";
import { AgentPageView } from "@/components/wallet-sidebar/agent-page-view";
import { ApprovalReviewContent } from "@/components/wallet-sidebar/approval-review-content";
import { ConnectRequestContent } from "@/components/wallet-sidebar/connect-request-content";
import { PortfolioContent } from "@/components/wallet-sidebar/portfolio-content";
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
import {
  fetchEarnEarningsRangeSet,
  invalidateEarnEarningsCache,
} from "@/hooks/use-earn-earnings";
import { useActiveEarnPosition } from "@/hooks/use-active-earn-position";
import {
  prepareEarnDepositOnServer,
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
import { trackWalletShieldPressed } from "@/lib/core/analytics";
import { formatEarnApyPercent } from "@/lib/kamino/earn-forecast.shared";
import { resolveTrackedKaminoUsdcMint } from "@/lib/kamino/kamino-usdc-position";
import { getTokenIconUrl } from "@/lib/token-icon";
import { AddSignerPane } from "./add-signer-pane";
import { ApprovalsPane } from "./approvals-pane";
import { BuilderBlocksPane } from "./builder-blocks-pane";
import {
  advanceEarnDepositReviewAfterPolicySetup,
  applyEarnDepositFormDraftChange,
  buildEarnDepositReviewItem,
  buildEarnAutodepositCloseReviewItem,
  buildEarnAutodepositSetupReviewItem,
  buildEarnWithdrawReviewItem,
  createSubmittedEarnDepositReviewState,
  setEarnDepositReviewPreparedDeposit,
  type EarnAutodepositSetupReviewStage,
  type EarnDepositReviewStage,
} from "./earn-deposit-review";
import { EarnTransactionsPane } from "./earn-transactions-pane";
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
type EarnAutodepositConfig = {
  amount: string;
  keepAmount: string;
  policyAccount: string;
  recurringDelegation: string;
  nonce: string;
  state: "created" | "closing" | "creating";
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

function clampWidth(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getWalletIcon(): string {
  return "/agents/Agent-01.svg";
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

function rawTokenAmountToNumber(amountRaw: string, decimals: number): number {
  if (!/^\d+$/.test(amountRaw)) {
    return 0;
  }

  const raw = BigInt(amountRaw);
  const scale = BigInt(10) ** BigInt(decimals);
  return Number(raw / scale) + Number(raw % scale) / 10 ** decimals;
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

function RailNavButton({
  icon,
  isActive = false,
  label,
  isPlaceholder = false,
  onClick,
  tooltip,
}: {
  icon: React.ReactNode;
  isActive?: boolean;
  label: string;
  isPlaceholder?: boolean;
  onClick?: () => void;
  tooltip?: string;
}) {
  return (
    <button
      aria-current={isActive ? "page" : undefined}
      aria-disabled={isPlaceholder}
      aria-label={label}
      className="wallet-workspace-rail-nav-button"
      data-active={isActive}
      data-placeholder={isPlaceholder}
      data-tooltip={tooltip}
      onClick={(event) => {
        if (isPlaceholder) {
          event.preventDefault();
          return;
        }

        onClick?.();
      }}
      title={tooltip ? undefined : label}
      type="button"
    >
      {icon}
    </button>
  );
}

const MASCOT_BUBBLE_PHRASES = [
  {
    id: "shield-usdc",
    ariaLabel: "Shield USDC to get passive income.",
    linkText: "Shield USDC",
    restText: " to get passive income.",
  },
  {
    id: "monday-features",
    ariaLabel: "New features are coming on Monday",
    text: "New features are coming on Monday",
  },
  {
    id: "loyal-x",
    ariaLabel: "Follow me on X. I don't bite.",
    href: "https://x.com/loyal_hq",
    linkText: "Follow",
    restText: " me on X. I don't bite.",
  },
] as const;

function WalletRail({
  activeSection,
  dogCry,
  dogNice,
  isBalanceHidden,
  isSignedIn,
  isWalletLoading,
  onDisconnect,
  onShieldUsdc,
  onSectionChange,
}: {
  activeSection: WorkspaceSection;
  dogCry: boolean;
  dogNice: boolean;
  isBalanceHidden: boolean;
  isSignedIn: boolean;
  isWalletLoading: boolean;
  onDisconnect: () => void;
  onShieldUsdc: () => void;
  onSectionChange: (section: WorkspaceSection) => void;
}) {
  const [bubblePhraseIndex, setBubblePhraseIndex] = useState(0);
  const bubblePhrase =
    MASCOT_BUBBLE_PHRASES[bubblePhraseIndex] ?? MASCOT_BUBBLE_PHRASES[0];
  const showMascotBubble = isSignedIn && !isWalletLoading;

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setBubblePhraseIndex(
        (current) => (current + 1) % MASCOT_BUBBLE_PHRASES.length
      );
    }, 15_000);

    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <aside className="wallet-workspace-rail" aria-label="Workspace navigation">
      <div className="wallet-workspace-rail-top">
        <div className="wallet-workspace-mascot">
          <DogWithMood cry={dogCry} nice={dogNice} squint={isBalanceHidden} />
          <span
            className="wallet-workspace-mascot-spinner"
            data-visible={isWalletLoading}
          />
          {showMascotBubble ? (
            <span
              aria-label={bubblePhrase.ariaLabel}
              className="wallet-workspace-mascot-bubble"
              key={bubblePhrase.id}
            >
              <span className="wallet-workspace-mascot-bubble-content">
                {"href" in bubblePhrase ? (
                  <>
                    <a
                      className="wallet-workspace-mascot-bubble-link"
                      href={bubblePhrase.href}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {bubblePhrase.linkText}
                    </a>
                    <span>&nbsp;{bubblePhrase.restText.trimStart()}</span>
                  </>
                ) : "linkText" in bubblePhrase ? (
                  <>
                    <button
                      className="wallet-workspace-mascot-bubble-link"
                      onClick={onShieldUsdc}
                      type="button"
                    >
                      {bubblePhrase.linkText}
                    </button>
                    <span>&nbsp;{bubblePhrase.restText.trimStart()}</span>
                  </>
                ) : (
                  bubblePhrase.text
                )}
              </span>
            </span>
          ) : null}
        </div>

        <nav className="wallet-workspace-rail-nav">
          <RailNavButton
            icon={
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt=""
                src="/agents/StashLink.svg"
                style={{ width: 24, height: 24 }}
              />
            }
            isActive={activeSection === "wallet"}
            label="Wallet"
            onClick={() => onSectionChange("wallet")}
          />
          {/* <RailNavButton
            icon={<Layers2 size={24} strokeWidth={1.8} />}
            isActive={activeSection === "policies"}
            label="Policies"
            onClick={() => onSectionChange("policies")}
          />
          <RailNavButton
            icon={<ChartNoAxesColumn size={24} strokeWidth={1.8} />}
            isPlaceholder
            label="Charts"
            tooltip="Charts will live here"
          />
          <RailNavButton
            icon={<Settings size={24} strokeWidth={1.8} />}
            isActive={activeSection === "settings"}
            label="Settings"
            onClick={() => onSectionChange("settings")}
          /> */}
        </nav>
      </div>

      <div className="wallet-workspace-rail-bottom">
        <button
          aria-disabled={!isSignedIn}
          aria-label="Disconnect wallet"
          className="wallet-workspace-logout"
          data-disabled={!isSignedIn}
          disabled={!isSignedIn}
          onClick={onDisconnect}
          title={isSignedIn ? "Disconnect wallet" : "Connect a wallet first"}
          type="button"
        >
          <LogOut size={20} strokeWidth={1.8} />
        </button>
      </div>
    </aside>
  );
}

function SignInValueRow({
  desc,
  icon,
  title,
}: {
  desc: string;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="wallet-signin-value">
      <span aria-hidden="true" className="wallet-signin-value-icon">
        {icon}
      </span>
      <div className="wallet-signin-value-copy">
        <strong>{title}</strong>
        <small>{desc}</small>
      </div>
    </div>
  );
}

function SignedOutDetailPane() {
  return (
    <div className="wallet-signin-screen">
      <div className="wallet-signin-card">
        <div className="wallet-signin-brand">
          <div aria-hidden="true" className="wallet-signin-mascot">
            <DogWithMood />
          </div>
          <div className="wallet-signin-headline">
            <h2>Put your money on autopilot</h2>
            <p>
              Open a self-custodial smart account in seconds — it earns,
              shields, and runs on your rules.
            </p>
          </div>
          <div className="wallet-signin-values">
            <SignInValueRow
              desc="Yield on SOL, USDC and USDT without locking up funds"
              icon={<TrendingUp size={18} strokeWidth={1.9} />}
              title="Earn in the background"
            />
            <SignInValueRow
              desc="Shielded balances and secure transactions"
              icon={<ShieldIcon size={18} strokeWidth={1.9} />}
              title="Private by default"
            />
            <SignInValueRow
              desc="Granular permissions for every agent"
              icon={<SlidersHorizontal size={18} strokeWidth={1.9} />}
              title="You set the rules"
            />
          </div>
        </div>

        <div className="wallet-signin-form">
          <div className="wallet-signin-form-head">
            <h3>Sign in</h3>
            <p>Connect your Solana wallet to continue.</p>
          </div>
          <WalletSignIn />
          <p className="wallet-signin-form-foot">
            <KeyRound size={13} strokeWidth={1.9} />
            Self-custodial — your keys never leave your device.
          </p>
        </div>
      </div>
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

export function AppWalletWorkspace({
  initialSection = "wallet",
}: {
  initialSection?: WorkspaceSection;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const walletDesktopData = useWalletDesktopData();
  const smartAccountData = useSmartAccountSidebarData({
    authenticatedUserTotalUsd: walletDesktopData.totalUsd,
    onAfterTx: walletDesktopData.refresh,
  });
  const { disconnect } = useWallet();
  const { logout, user } = useAuthSession();
  const publicEnv = usePublicEnv();
  const trackedKaminoUsdcMint = useMemo(
    () => resolveTrackedKaminoUsdcMint(publicEnv.solanaEnv),
    [publicEnv.solanaEnv]
  );
  const { isHydrated: isAuthHydrated, isSignedIn } = useAuthCapability();
  const { open: openSignIn, close: closeSignIn } = useSignInModal();
  const {
    position: activeEarnPosition,
    refresh: refreshActiveEarnPosition,
    setPosition: setActiveEarnPosition,
  } = useActiveEarnPosition({
    enabled: isAuthHydrated && isSignedIn,
    settingsPda: smartAccountData.overview?.settingsPda,
    solanaEnv: publicEnv.solanaEnv,
    walletAddress: walletDesktopData.walletAddress,
  });
  const activeEarnPositionApyBps = activeEarnPosition?.currentSupplyApyBps;
  const activeEarnPositionApyLabel =
    activeEarnPositionApyBps !== null && activeEarnPositionApyBps !== undefined
      ? `${formatEarnApyPercent(Number(activeEarnPositionApyBps))} 30d APY`
      : undefined;
  const signInOpenedForConnectRef = useRef(false);
  const { tokens: popularTokens, search: searchTokens } = usePopularTokens();
  const routeSection: WorkspaceSection =
    pathname === "/app/policies"
      ? "policies"
      : pathname === "/app/settings"
      ? "settings"
      : initialSection;
  const [activeSection, setActiveSection] =
    useState<WorkspaceSection>(routeSection);
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
  const hasRestoredSelectionRef = useRef(false);
  const hasLocalDetailSelectionRef = useRef(false);
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
  const [accountPaneWidth, setAccountPaneWidth] = useState(
    ACCOUNT_PANE_DEFAULT_WIDTH
  );
  const [reviewPaneWidth, setReviewPaneWidth] = useState(
    REVIEW_PANE_DEFAULT_WIDTH
  );
  const [dogCry, setDogCry] = useState(false);
  const [dogNice, setDogNice] = useState(false);
  const [connectAgentAddress, setConnectAgentAddress] = useState<string | null>(
    null
  );
  const [pendingOpenSignerAddress, setPendingOpenSignerAddress] = useState<
    string | null
  >(null);
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
  const [pendingEarnWithdrawDraft, setPendingEarnWithdrawDraft] =
    useState<EarnWithdrawDraft | null>(null);
  const [pendingEarnAutodepositDraft, setPendingEarnAutodepositDraft] =
    useState<EarnAutodepositDraft | null>(null);
  const [
    pendingEarnAutodepositSetupPrepared,
    setPendingEarnAutodepositSetupPrepared,
  ] = useState<SmartAccountPreparedEarnUsdcAutodepositSetup | null>(null);
  const [
    earnAutodepositSetupReviewStage,
    setEarnAutodepositSetupReviewStage,
  ] = useState<EarnAutodepositSetupReviewStage>("policy");
  const [
    pendingEarnAutodepositClosePrepared,
    setPendingEarnAutodepositClosePrepared,
  ] = useState<SmartAccountPreparedEarnUsdcAutodepositClose | null>(null);
  const [isEarnAutodepositCloseReview, setIsEarnAutodepositCloseReview] =
    useState(false);
  // Local until Yield Neon persistence is added; includes enough on-chain
  // metadata to close the exact policy/delegation created by this session.
  const [autodepositConfig, setAutodepositConfig] =
    useState<EarnAutodepositConfig | null>(null);
  const autodepositAmountLabel = autodepositConfig
    ? `$${Number(autodepositConfig.amount || 0).toLocaleString("en-US")}.00`
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

  const handleSectionChange = useCallback(
    (section: WorkspaceSection) => {
      setActiveSection(section);
      const targetPath =
        section === "policies"
          ? "/app/policies"
          : section === "settings"
          ? "/app/settings"
          : "/app";
      router.push(targetPath);
    },
    [router]
  );

  useEffect(() => {
    setActiveSection(routeSection);
  }, [routeSection]);
  const wasWalletLoadingRef = useRef(walletDesktopData.isLoading);
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
  const hasWalletShell = Boolean(walletDesktopData.walletAddress);
  const isWorkspaceLoading =
    isSignedIn &&
    walletDesktopData.isLoading &&
    !hasWalletShell &&
    !hasSmartAccountShell;
  // Keep the portfolio pane in its loading skeleton until the smart-account
  // overview is established. The wallet shell loads faster than the overview
  // (base + vaults), and the settings PDA can arrive a beat after auth, so
  // without this the pane briefly flashes "No vaults found" before the Main
  // Account appears.
  const isSmartAccountShellLoading =
    isSignedIn &&
    !hasSmartAccountShell &&
    (smartAccountData.isLoading || !user?.settingsPda);
  const isSmartAccountRateLimited =
    isSignedIn && isRateLimitedSmartAccountError(smartAccountData.error);
  const showWorkspaceShell =
    isAuthHydrated &&
    (isSignedIn ||
      activeSection === "policies" ||
      activeSection === "settings");
  const selectedAgent =
    selectedVault?.entry.signers.find(
      (signer) => signer.id === selectedSignerId
    ) ?? null;
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
    const addr = walletDesktopData.walletAddress;
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
  }, [
    selectedVault,
    walletDesktopData.walletAddress,
    walletDesktopData.walletLabel,
  ]);
  const selectedApproval = useMemo(
    () =>
      smartAccountData.approvals.find(
        (approval) => approval.id === selectedApprovalId
      ) ?? null,
    [selectedApprovalId, smartAccountData.approvals]
  );
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
    `set:${selectedVaultAccountIndex}:${walletDesktopData.walletAddress ?? ""}`,
    `delete:${selectedVaultAccountIndex}:${
      walletDesktopData.walletAddress ?? ""
    }`,
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
    const positions = walletDesktopData.positions;

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
  }, [walletDesktopData.positions]);
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
      walletDesktopData.positions
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
    [walletDesktopData.positions]
  );
  const shieldSourceTokens = useMemo(
    () => [...derivedTokens, ...securedTokens],
    [derivedTokens, securedTokens]
  );
  const earnDepositSources = useMemo<EarnDepositSourceOption[]>(() => {
    const sources: EarnDepositSourceOption[] = [];
    const mainUsdcPosition = findEarnUsdcPosition(
      walletDesktopData.positions,
      trackedKaminoUsdcMint
    );
    const mainBalance = splitUsdcSourceBalance(
      mainUsdcPosition?.publicBalance ?? 0
    );

    sources.push({
      addressLabel: formatAddressForEarnSource(walletDesktopData.walletAddress),
      balance: mainUsdcPosition?.publicBalance ?? 0,
      balanceFraction: mainBalance.fraction,
      balanceWhole: mainBalance.whole,
      decimals: mainUsdcPosition?.asset.decimals ?? 6,
      icon: getWalletIcon(),
      id: "main",
      label: "Main",
      mint: mainUsdcPosition?.asset.mint ?? trackedKaminoUsdcMint,
    });

    return sources;
  }, [
    trackedKaminoUsdcMint,
    walletDesktopData.positions,
    walletDesktopData.walletAddress,
  ]);
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
  const hasEarnPosition =
    activeEarnPosition?.status === "active" &&
    BigInt(activeEarnPosition.principalAmountRaw) > BigInt(0);
  const isEarnDepositDetailActive =
    detailSelection === "earnDeposit" ||
    (detailSelection === "earn" && !hasEarnPosition);
  const earnDepositReviewItem = useMemo(
    () =>
      pendingEarnDepositDraft && isEarnDepositDetailActive
        ? buildEarnDepositReviewItem({
            draft: pendingEarnDepositDraft,
            isPolicySetupFlow: isEarnDepositPolicySetupFlow,
            preparedDeposit: pendingEarnDepositPrepared,
            stage: earnDepositReviewStage,
          })
        : null,
    [
      earnDepositReviewStage,
      isEarnDepositDetailActive,
      isEarnDepositPolicySetupFlow,
      pendingEarnDepositDraft,
      pendingEarnDepositPrepared,
    ]
  );
  const earnWithdrawReviewItem = useMemo(
    () =>
      pendingEarnWithdrawDraft && detailSelection === "earnWithdraw"
        ? buildEarnWithdrawReviewItem({
            draft: pendingEarnWithdrawDraft,
          })
        : null,
    [detailSelection, pendingEarnWithdrawDraft]
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
  // An Earn deposit/withdraw approval is being reviewed in the right pane.
  const isReviewApprovalFocused = Boolean(
    earnDepositReviewItem ||
      earnWithdrawReviewItem ||
      earnAutodepositSetupReviewItem ||
      earnAutodepositCloseReviewItem
  );
  const earnWithdrawMaxAmount = activeEarnPosition
    ? rawTokenAmountToNumber(activeEarnPosition.principalAmountRaw, 6)
    : 0;
  const totalBalance = useMemo(
    () =>
      splitUsdBalance(
        walletDesktopData.totalUsd +
          smartAccountData.totalUsd +
          earnWithdrawMaxAmount
      ),
    [
      earnWithdrawMaxAmount,
      walletDesktopData.totalUsd,
      smartAccountData.totalUsd,
    ]
  );
  const earnEarningsCacheKey = [
    publicEnv.solanaEnv,
    walletDesktopData.walletAddress ?? "anonymous",
    smartAccountData.overview?.settingsPda ?? "no-settings",
    activeEarnPosition?.principalAmountRaw ?? "0",
  ].join(":");
  useEffect(() => {
    if (!isAuthHydrated || !isSignedIn || !hasEarnPosition) {
      return;
    }

    void fetchEarnEarningsRangeSet(earnEarningsCacheKey, {
      expectedPrincipalAmountRaw: activeEarnPosition?.principalAmountRaw,
      settingsPda: smartAccountData.overview?.settingsPda,
      solanaEnv: publicEnv.solanaEnv,
      walletAddress: walletDesktopData.walletAddress,
    }).catch((error) => {
      console.warn("[earnings] failed to preload Earn earnings", error);
    });
  }, [
    earnEarningsCacheKey,
    hasEarnPosition,
    isAuthHydrated,
    isSignedIn,
    publicEnv.solanaEnv,
    activeEarnPosition?.principalAmountRaw,
    smartAccountData.overview?.settingsPda,
    walletDesktopData.walletAddress,
  ]);
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

    const position = walletDesktopData.positions.find(
      (entry) => entry.asset.mint === shieldToken.mint
    );

    return position?.securedBalance ?? 0;
  }, [shieldToken.mint, walletDesktopData.positions]);

  useEffect(() => {
    if (!isAuthHydrated) {
      return;
    }

    if (!isSignedIn) {
      invalidateEarnEarningsCache();
    }
  }, [isAuthHydrated, isSignedIn]);

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
    const justFinished =
      wasWalletLoadingRef.current && !walletDesktopData.isLoading;
    wasWalletLoadingRef.current = walletDesktopData.isLoading;

    if (justFinished && walletDesktopData.isConnected) {
      setDogNice(true);
      const timeout = setTimeout(() => setDogNice(false), 3000);
      return () => clearTimeout(timeout);
    }
  }, [walletDesktopData.isConnected, walletDesktopData.isLoading]);

  useEffect(() => {
    if (!connectAgentAddress) return;

    setSelectedSignerId(null);
    setDetailSelection("connect");
    setSelectedDetail("Connection request");

    if (isSignedIn) {
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
    isSignedIn,
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
    if (!isSignedIn) {
      hasRestoredSelectionRef.current = false;
      hasLocalDetailSelectionRef.current = false;
      setIsSelectionRestored(false);
    }
  }, [isSignedIn]);

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
      !isSignedIn ||
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
    isSignedIn,
    smartAccountData,
    smartAccountData.overview,
    setDetailSelection,
    smartAccountData.isBaseLoading,
    smartAccountData.vaultEntries,
    walletDesktopData.isLoading,
  ]);

  useEffect(() => {
    if (!hasRestoredSelectionRef.current || !isSignedIn) return;

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
    isSignedIn,
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
    [openActionView]
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
    setDogCry(true);
    setTimeout(() => setDogCry(false), 3000);
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
      const actionView =
        action === "receive"
          ? ({ type: "receivePanel" } as const)
          : action === "send"
          ? ({ type: "sendPanel" } as const)
          : action === "swap"
          ? ({ type: "swapPanel", mode: "swap" } as const)
          : ({ type: "swapPanel", mode: "shield" } as const);

      if (action === "shield") {
        setShieldDirection("shield");
      }

      openActionView(actionView, actionLabels[action]);
    },
    [openActionView]
  );

  const handleCommandCopyWalletAddress = useCallback(() => {
    if (!walletDesktopData.walletAddress) return;

    void navigator.clipboard?.writeText(walletDesktopData.walletAddress);
    setDogNice(true);
    setTimeout(() => setDogNice(false), 1600);
  }, [walletDesktopData.walletAddress]);

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
    setShieldDirection("shield");
    openActionView(
      { type: "swapPanel", mode: "shield" },
      "Shield",
      "",
      "wallet"
    );
  }, [openActionView]);

  const handleCommandShieldUsdc = useCallback(() => {
    const usdcToken = findTrackedUsdcToken(
      derivedTokens,
      trackedKaminoUsdcMint
    );

    if (!usdcToken) return;

    setShieldToken(usdcToken);
    setShieldDirection("shield");
    openActionView(
      { type: "swapPanel", mode: "shield" },
      "Shield",
      "",
      "wallet"
    );
  }, [derivedTokens, openActionView, trackedKaminoUsdcMint]);

  const handleOpenEarn = useCallback(() => {
    markDetailPaneTransition("switch");
    setPendingEarnDepositDraft(null);
    setPendingEarnDepositPrepared(null);
    setEarnDepositReviewStage("deposit");
    setIsEarnDepositPolicySetupFlow(false);
    setEarnDepositPrepareError(null);
    setPendingEarnWithdrawDraft(null);
    setSelectedSignerId(null);
    setDetailSelection("earn");
    setSelectedDetail("Earn");
  }, [markDetailPaneTransition, setDetailSelection]);

  const handleOpenEarnDeposit = useCallback(() => {
    markDetailPaneTransition("forward");
    setPendingEarnDepositDraft(null);
    setPendingEarnDepositPrepared(null);
    setEarnDepositReviewStage("deposit");
    setIsEarnDepositPolicySetupFlow(false);
    setEarnDepositPrepareError(null);
    setPendingEarnWithdrawDraft(null);
    setSelectedSignerId(null);
    setDetailSelection("earnDeposit");
    setSelectedDetail("Deposit");
  }, [markDetailPaneTransition, setDetailSelection]);

  const handleOpenEarnWithdraw = useCallback(() => {
    markDetailPaneTransition("forward");
    setPendingEarnDepositDraft(null);
    setPendingEarnDepositPrepared(null);
    setEarnDepositReviewStage("deposit");
    setIsEarnDepositPolicySetupFlow(false);
    setEarnDepositPrepareError(null);
    setPendingEarnWithdrawDraft(null);
    setSelectedSignerId(null);
    setDetailSelection("earnWithdraw");
    setSelectedDetail("Withdraw");
  }, [markDetailPaneTransition, setDetailSelection]);

  const handleBackFromEarnWithdraw = useCallback(() => {
    markDetailPaneTransition("back");
    setPendingEarnWithdrawDraft(null);
    setSelectedSignerId(null);
    setDetailSelection("earn");
    setSelectedDetail("Earn");
  }, [markDetailPaneTransition, setDetailSelection]);

  const handleOpenAutodeposit = useCallback(() => {
    markDetailPaneTransition("forward");
    setEarnAutodepositSetupReviewStage("policy");
    setSelectedSignerId(null);
    setDetailSelection("earnAutodeposit");
    setSelectedDetail("Autodeposit");
  }, [markDetailPaneTransition, setDetailSelection]);

  const handleBackFromAutodeposit = useCallback(() => {
    markDetailPaneTransition("back");
    setPendingEarnAutodepositDraft(null);
    setPendingEarnAutodepositSetupPrepared(null);
    setPendingEarnAutodepositClosePrepared(null);
    setEarnAutodepositSetupReviewStage("policy");
    setIsEarnAutodepositCloseReview(false);
    setSelectedSignerId(null);
    setDetailSelection("earn");
    setSelectedDetail("Earn");
  }, [markDetailPaneTransition, setDetailSelection]);

  const handleSaveAutodeposit = useCallback(
    (amount: string, keepAmount: string) => {
      const source = earnDepositSources.find((entry) => entry.id === "main");
      if (!source) {
        setProposalActionError("Main Account USDC source is not loaded yet.");
        return;
      }

      const normalizedAmount = Number(amount || 0);
      const normalizedKeepAmount = Number(keepAmount || 0);
      if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
        setProposalActionError("Enter an autodeposit amount.");
        return;
      }

      setProposalActionError(null);
      setPendingEarnAutodepositSetupPrepared(null);
      setPendingEarnAutodepositClosePrepared(null);
      setEarnAutodepositSetupReviewStage("policy");
      setIsEarnAutodepositCloseReview(false);
      setPendingEarnAutodepositDraft({
        amount: normalizedAmount,
        amountLabel: amount,
        keepAmount: normalizedKeepAmount,
        keepAmountLabel: keepAmount,
        nonce: BigInt(Date.now()),
        source,
        symbol: "USDC",
        tokenDecimals: source.decimals,
      });
    },
    [earnDepositSources]
  );

  const handleDismissEarnAutodepositPreview = useCallback(() => {
    setPendingEarnAutodepositDraft(null);
    setPendingEarnAutodepositSetupPrepared(null);
    setPendingEarnAutodepositClosePrepared(null);
    setEarnAutodepositSetupReviewStage("policy");
    setAutodepositConfig((current) =>
      current?.state === "closing"
        ? { ...current, state: "created" }
        : current?.state === "creating"
        ? null
        : current
    );
    setIsEarnAutodepositCloseReview(false);
    setProposalActionError(null);
  }, []);

  const handleOpenAutodepositCloseReview = useCallback(() => {
    if (!autodepositConfig) {
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
  }, [
    autodepositConfig,
    markDetailPaneTransition,
    setDetailSelection,
  ]);

  const handleDisableAutodeposit = useCallback(() => {
    handleOpenAutodepositCloseReview();
  }, [handleOpenAutodepositCloseReview]);

  const handleDeleteAutodeposit = useCallback(() => {
    handleOpenAutodepositCloseReview();
  }, [handleOpenAutodepositCloseReview]);

  const handleDismissEarnDepositPreview = useCallback(() => {
    console.log("[earn-deposit] preview dismissed");
    setPendingEarnDepositDraft(null);
    setPendingEarnDepositPrepared(null);
    setEarnDepositReviewStage("deposit");
    setIsEarnDepositPolicySetupFlow(false);
    setEarnDepositPrepareError(null);
  }, []);

  const handleDismissEarnWithdrawPreview = useCallback(() => {
    console.log("[earn-withdraw] preview dismissed");
    setPendingEarnWithdrawDraft(null);
  }, []);

  const handleDismissFocusedEarnPreview = useCallback(() => {
    if (pendingEarnDepositDraft && isEarnDepositDetailActive) {
      handleDismissEarnDepositPreview();
      return;
    }

    if (pendingEarnWithdrawDraft && detailSelection === "earnWithdraw") {
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
    handleDismissEarnAutodepositPreview,
    handleDismissEarnDepositPreview,
    handleDismissEarnWithdrawPreview,
    isEarnDepositDetailActive,
    isEarnAutodepositCloseReview,
    pendingEarnAutodepositDraft,
    pendingEarnDepositDraft,
    pendingEarnWithdrawDraft,
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
      console.log("[earn-deposit] deposit button submitted preview draft", {
        amountLabel: draft.amountLabel,
        requiresPolicySetup: smartAccountData.requiresEarnPolicySetupForDeposit,
        sourceId: draft.source.id,
        sourceLabel: draft.source.label,
        tokenDecimals: draft.tokenDecimals,
        tokenMint: draft.tokenMint,
      });
      const requiresPolicySetup =
        smartAccountData.requiresEarnPolicySetupForDeposit;
      setProposalActionError(null);
      setEarnDepositPrepareError(null);
      setPendingEarnDepositPrepared(null);

      try {
        const preparedDeposit = requiresPolicySetup
          ? null
          : await (async () => {
              setIsEarnDepositPreparePending(true);
              const amountRaw = parseTokenAmountLabelToRaw(
                draft.amountLabel,
                draft.tokenDecimals
              );
              return prepareEarnDepositOnServer({ amountRaw });
            })();
        const nextReview = createSubmittedEarnDepositReviewState({
          draft,
          preparedDeposit,
          requiresPolicySetup,
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
        setIsEarnDepositPreparePending(false);
      }
    },
    [smartAccountData.requiresEarnPolicySetupForDeposit]
  );

  const handleSubmitEarnWithdrawDraft = useCallback(
    (draft: EarnWithdrawDraft) => {
      console.log("[earn-withdraw] withdraw button submitted preview draft", {
        amountLabel: draft.amountLabel,
        destinationId: draft.destination.id,
        destinationLabel: draft.destination.label,
        mode: draft.mode,
        tokenDecimals: draft.tokenDecimals,
      });
      setPendingEarnWithdrawDraft(draft);
    },
    []
  );

  const handleCompleteEarnPolicySetup = useCallback(async () => {
    if (!pendingEarnDepositDraft) {
      setProposalActionError("Enter a deposit amount before continuing.");
      return;
    }

    setProposalActionError(null);
    try {
      const result = await smartAccountData.executeEarnPolicySetup();
      if (!result.success) {
        throw new Error(result.error ?? "Earn policy setup failed.");
      }

      setIsEarnDepositPreparePending(true);
      const amountRaw = parseTokenAmountLabelToRaw(
        pendingEarnDepositDraft.amountLabel,
        pendingEarnDepositDraft.tokenDecimals
      );
      const nextReview = advanceEarnDepositReviewAfterPolicySetup(
        setEarnDepositReviewPreparedDeposit(
          {
            draft: pendingEarnDepositDraft,
            isPolicySetupFlow: isEarnDepositPolicySetupFlow,
            preparedDeposit: null,
            stage: earnDepositReviewStage,
          },
          await prepareEarnDepositOnServer({ amountRaw })
        )
      );
      setPendingEarnDepositDraft(nextReview.draft);
      setPendingEarnDepositPrepared(nextReview.preparedDeposit);
      setIsEarnDepositPolicySetupFlow(nextReview.isPolicySetupFlow);
      setEarnDepositReviewStage(nextReview.stage);
      setDetailSelection("earnDeposit");
      setSelectedDetail("Deposit");
    } catch (error) {
      const raw =
        error instanceof Error ? error.message : "Earn policy setup failed.";
      console.log("[earn-deposit] policy setup failed", {
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: raw,
      });
      setProposalActionError(raw);
      setEarnDepositPrepareError(raw);
    } finally {
      setIsEarnDepositPreparePending(false);
    }
  }, [
    earnDepositReviewStage,
    isEarnDepositPolicySetupFlow,
    pendingEarnDepositDraft,
    setDetailSelection,
    smartAccountData,
  ]);

  const handleCompleteEarnDeposit = useCallback(async () => {
    console.log("[earn-deposit] approve clicked", {
      hasDraft: Boolean(pendingEarnDepositDraft),
      isActionPending: smartAccountData.isActionPending,
    });

    if (!pendingEarnDepositDraft) {
      console.log("[earn-deposit] approve aborted: no pending draft");
      setProposalActionError("Enter a deposit amount before continuing.");
      return;
    }

    setProposalActionError(null);
    try {
      const amountRaw = parseTokenAmountLabelToRaw(
        pendingEarnDepositDraft.amountLabel,
        pendingEarnDepositDraft.tokenDecimals
      );
      console.log("[earn-deposit] parsed approve amount", {
        amountLabel: pendingEarnDepositDraft.amountLabel,
        amountRaw: amountRaw.toString(),
        tokenDecimals: pendingEarnDepositDraft.tokenDecimals,
      });
      if (!pendingEarnDepositPrepared) {
        throw new Error(
          "Prepare the Earn deposit again before signing this transaction."
        );
      }

      const result = await smartAccountData.executeEarnDeposit({
        amountRaw,
        preparedDeposit: pendingEarnDepositPrepared,
      });
      console.log("[earn-deposit] executeEarnDeposit result", {
        error: result.error,
        status: result.status,
        success: result.success,
      });

      if (!result.success) {
        throw new Error(result.error ?? "Earn deposit failed.");
      }

      markDetailPaneTransition("back");
      setPendingEarnDepositDraft(null);
      setPendingEarnDepositPrepared(null);
      setEarnDepositReviewStage("deposit");
      setIsEarnDepositPolicySetupFlow(false);
      setEarnDepositPrepareError(null);
      invalidateEarnEarningsCache();
      setActiveEarnPosition((current) => {
        const nowIso = new Date().toISOString();
        const tokenMint = pendingEarnDepositDraft.tokenMint ?? "";
        const next = {
          display: current?.display ?? {
            label: "Main Market · USDC",
            marketName: "Main Market",
            mintSymbol: "USDC",
          },
          initialHolding: current?.initialHolding ?? {
            liquidityMint: tokenMint,
            market: null,
            reserve: "",
            supplyApyBps: null,
          },
          currentHolding: current?.currentHolding
            ? {
                ...current.currentHolding,
                amountRaw: (
                  BigInt(current.currentHolding.amountRaw) + amountRaw
                ).toString(),
              }
            : {
                amountRaw: amountRaw.toString(),
                liquidityMint: tokenMint,
                market: null,
                observedAt: nowIso,
                observedSlot: "0",
                provenance: {
                  lastHoldingEventId: null,
                  lastRebalanceDecisionId: null,
                },
                reserve: "",
              },
          principalAmountRaw: (
            BigInt(current?.principalAmountRaw ?? "0") + amountRaw
          ).toString(),
          status: "active" as const,
          currentSupplyApyBps: current?.currentSupplyApyBps ?? null,
        };
        console.log("[earn-position] optimistic post-deposit update", {
          current,
          depositAmountRaw: amountRaw.toString(),
          next,
        });
        return next;
      });
      setSelectedSignerId(null);
      setDetailSelection("earn");
      setSelectedDetail("Earn");
      void refreshActiveEarnPosition().catch((error) => {
        console.warn("[earn-position] post-deposit refresh failed", error);
      });
    } catch (error) {
      const raw =
        error instanceof Error ? error.message : "Earn deposit failed.";
      console.log("[earn-deposit] approve failed", {
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: raw,
      });
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
  }, [
    markDetailPaneTransition,
    pendingEarnDepositDraft,
    pendingEarnDepositPrepared,
    refreshActiveEarnPosition,
    setActiveEarnPosition,
    setDetailSelection,
    smartAccountData,
  ]);

  const handleContinueEarnDepositReview = useCallback(() => {
    if (earnDepositReviewStage === "policy") {
      void handleCompleteEarnPolicySetup();
      return;
    }

    void handleCompleteEarnDeposit();
  }, [
    earnDepositReviewStage,
    handleCompleteEarnDeposit,
    handleCompleteEarnPolicySetup,
  ]);

  const handleCompleteEarnWithdraw = useCallback(
    async (withdrawal?: { amount: number; mode: "partial" | "full" }) => {
      const withdrawalDraft = withdrawal ?? pendingEarnWithdrawDraft;
      if (!withdrawalDraft) {
        setProposalActionError("Enter a withdrawal amount before continuing.");
        return;
      }

      setProposalActionError(null);
      try {
        const amountRaw = parseTokenAmountLabelToRaw(
          withdrawalDraft.amount.toString(),
          6
        );
        const result = await smartAccountData.executeEarnWithdraw({
          amountRaw,
          mode: withdrawalDraft.mode,
        });

        if (!result.success) {
          throw new Error(result.error ?? "Earn withdrawal failed.");
        }

        markDetailPaneTransition("back");
        invalidateEarnEarningsCache();
        setPendingEarnWithdrawDraft(null);
        setActiveEarnPosition((current) => {
          if (!current) {
            return current;
          }

          if (withdrawalDraft.mode === "full") {
            return null;
          }

          const nextPrincipal = BigInt(current.principalAmountRaw) - amountRaw;
          return nextPrincipal > BigInt(0)
            ? {
                ...current,
                principalAmountRaw: nextPrincipal.toString(),
                status: "active",
              }
            : null;
        });
        setSelectedSignerId(null);
        setDetailSelection("earn");
        setSelectedDetail("Earn");
        void refreshActiveEarnPosition().catch((error) => {
          console.warn("[earn-position] post-withdraw refresh failed", error);
        });
      } catch (error) {
        setProposalActionError(
          error instanceof Error ? error.message : "Earn withdrawal failed."
        );
      }
    },
    [
      markDetailPaneTransition,
      pendingEarnWithdrawDraft,
      refreshActiveEarnPosition,
      setActiveEarnPosition,
      setDetailSelection,
      smartAccountData,
    ]
  );

  const handleCompleteEarnAutodepositSetup = useCallback(async () => {
    if (!pendingEarnAutodepositDraft) {
      setProposalActionError("Enter an autodeposit amount before continuing.");
      return;
    }

    setProposalActionError(null);
    setAutodepositConfig((current) =>
      current
        ? { ...current, state: "creating" }
        : {
            amount: pendingEarnAutodepositDraft.amountLabel,
            keepAmount: pendingEarnAutodepositDraft.keepAmountLabel,
            nonce: pendingEarnAutodepositDraft.nonce.toString(),
            policyAccount: "",
            recurringDelegation: "",
            state: "creating",
          }
    );

    try {
      const amountRaw = parseTokenAmountLabelToRaw(
        pendingEarnAutodepositDraft.amountLabel,
        pendingEarnAutodepositDraft.tokenDecimals
      );
      const result = await smartAccountData.executeEarnAutodepositSetup({
        amountRaw,
        nonce: pendingEarnAutodepositDraft.nonce,
        preparedSetup: pendingEarnAutodepositSetupPrepared,
      });

      if (!result.success || !result.preparedSetup) {
        throw new Error(result.error ?? "Autodeposit setup failed.");
      }

      if (result.preparedSetup.stage !== "create_recurring_delegation") {
        if (!result.nextPreparedSetup) {
          throw new Error("Failed to prepare recurring delegation approval.");
        }

        setPendingEarnAutodepositSetupPrepared(result.nextPreparedSetup);
        setEarnAutodepositSetupReviewStage("delegation");
        setAutodepositConfig((current) =>
          current?.state === "creating" ? current : null
        );
        return;
      }

      const policyAccount = result.preparedSetup.persistence.policyAccount;
      if (!policyAccount) {
        throw new Error("Autodeposit policy account was not returned.");
      }

      setAutodepositConfig({
        amount: pendingEarnAutodepositDraft.amountLabel,
        keepAmount: pendingEarnAutodepositDraft.keepAmountLabel,
        nonce: result.preparedSetup.persistence.nonce,
        policyAccount,
        recurringDelegation:
          result.preparedSetup.persistence.recurringDelegation,
        state: "created",
      });
      setPendingEarnAutodepositDraft(null);
      setPendingEarnAutodepositSetupPrepared(null);
      setEarnAutodepositSetupReviewStage("policy");
      setIsEarnAutodepositCloseReview(false);
      markDetailPaneTransition("back");
      setSelectedSignerId(null);
      setDetailSelection("earn");
      setSelectedDetail("Earn");
    } catch (error) {
      setAutodepositConfig((current) =>
        current?.state === "creating" ? null : current
      );
      setProposalActionError(
        error instanceof Error ? error.message : "Autodeposit setup failed."
      );
    }
  }, [
    markDetailPaneTransition,
    pendingEarnAutodepositDraft,
    pendingEarnAutodepositSetupPrepared,
    setDetailSelection,
    smartAccountData,
  ]);

  const handleCompleteEarnAutodepositClose = useCallback(async () => {
    if (!autodepositConfig) {
      setProposalActionError("No autodeposit is configured.");
      return;
    }

    if (
      autodepositConfig.policyAccount.length === 0 ||
      autodepositConfig.recurringDelegation.length === 0
    ) {
      setProposalActionError("Autodeposit account metadata is missing.");
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
      markDetailPaneTransition("back");
      setSelectedSignerId(null);
      setDetailSelection("earn");
      setSelectedDetail("Earn");
    } catch (error) {
      setAutodepositConfig({ ...autodepositConfig, state: "created" });
      setProposalActionError(
        error instanceof Error ? error.message : "Autodeposit close failed."
      );
    }
  }, [
    autodepositConfig,
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
    },
    [markDetailPaneTransition, setDetailSelection, smartAccountData]
  );

  const handleOpenAgent = useCallback(
    (agent: SmartAccountSignerEntry) => {
      markDetailPaneTransition("switch");
      setDetailInitialTab("tokens");
      setSelectedSignerId(agent.id);

      if (
        walletDesktopData.walletAddress &&
        agent.address === walletDesktopData.walletAddress
      ) {
        setDetailSelection("wallet");
        setSelectedDetail(`${agent.label} · ${agent.shortAddress}`);
        return;
      }

      setDetailSelection("agent");
      setSelectedDetail(`${agent.label} · ${agent.shortAddress}`);
    },
    [
      markDetailPaneTransition,
      setDetailSelection,
      walletDesktopData.walletAddress,
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
      markDetailPaneTransition("forward");
      setDetailSelection("addSigner");
      setSelectedSignerId(null);
      smartAccountData.setSelectedVaultIndex(accountIndex);
      setSelectedDetail(`Add signer to Stash ${accountIndex}`);
    },
    [markDetailPaneTransition, setDetailSelection, smartAccountData]
  );

  const handleCommandAddSigner = useCallback(() => {
    if (!selectedVault) return;

    handleOpenAddSigner(selectedVault.entry.accountIndex);
  }, [handleOpenAddSigner, selectedVault]);

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

  const [proposalActionError, setProposalActionError] = useState<string | null>(
    null
  );

  const handleReviewApproval = useCallback(
    (approval: SmartAccountApprovalItem) => {
      setSelectedApprovalId(approval.id);
      setProposalActionError(null);
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
  }, [draftProposal, smartAccountData]);

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
  }, [permissionDraft, smartAccountData]);

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
  }, [spendingLimitDraft, smartAccountData]);

  const runProposalAction = useCallback(async (action: () => Promise<void>) => {
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
  }, []);

  const commandGroups = useMemo<WalletCommandGroup[]>(() => {
    const isWalletActive = activeDetailSelection === "wallet";
    const isVaultActive = activeDetailSelection === "vault";
    const usdcToken = findTrackedUsdcToken(
      derivedTokens,
      trackedKaminoUsdcMint
    );
    const tokenCommands = walletDesktopData.allTokenRows.map((token, index) => {
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
        {
          description: selectedVault
            ? `Add signer to ${selectedVault.entry.label}`
            : undefined,
          disabled: !isSignedIn || !selectedVault,
          icon: <Plus size={20} strokeWidth={1.8} />,
          id: "action:add-signer",
          label: "Add signer",
          onSelect: () => runOnWallet(handleCommandAddSigner),
        },
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
            description: shortCommandAddress(walletDesktopData.walletAddress),
            disabled: !walletDesktopData.walletAddress,
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
    isBalanceHidden,
    isSignedIn,
    latestPendingApproval,
    openSignIn,
    runOnWallet,
    runProposalAction,
    selectedSignerId,
    selectedVault,
    smartAccountData,
    trackedKaminoUsdcMint,
    walletDesktopData.allTokenRows,
    walletDesktopData.walletAddress,
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

      if (detailSelection === "action" && viewStack.length > 0) {
        event.preventDefault();
        handleActionBack();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [
    detailSelection,
    handleActionBack,
    handleDismissFocusedEarnPreview,
    isCommandMenuOpen,
    isReviewApprovalFocused,
    viewStack.length,
  ]);

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

    if (!isSignedIn) {
      return <SignedOutDetailPane />;
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
    // (known from the session before `overview` loads) so users with no smart
    // account — whose data load no-ops and never restores — don't hang here,
    // and placed after the error check so a load failure still surfaces.
    if (isSignedIn && Boolean(user?.settingsPda) && !isSelectionRestored) {
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
            await smartAccountData.addInitiateSigner({
              signerAddress: connectAgentAddress,
            });
          }}
          onClose={() => {
            markDetailPaneTransition("close");
            setDetailSelection("vault");
          }}
          onDecline={() => {
            markDetailPaneTransition("close");
            setDetailSelection("vault");
          }}
          onDone={() => {
            markDetailPaneTransition("close");
            setDetailSelection("vault");
          }}
        />
      );
    }

    if (isEarnDepositDetailActive) {
      return (
        <EarnDepositView
          isSubmitting={
            smartAccountData.isActionPending || isEarnDepositPreparePending
          }
          onDraftChange={handleEarnDepositFormDraftChange}
          onClose={handleOpenEarn}
          onDraftSubmit={handleSubmitEarnDepositDraft}
          sources={earnDepositSources}
          submitError={earnDepositPrepareError}
        />
      );
    }

    if (detailSelection === "earn") {
      return (
        <EarnDetailView
          autodepositAmountLabel={autodepositAmountLabel}
          autodepositState={autodepositConfig?.state ?? "idle"}
          currentPositionApyLabel={activeEarnPositionApyLabel}
          currentPositionLabel={activeEarnPosition?.display?.label}
          earningsCacheKey={earnEarningsCacheKey}
          earningsCacheScope={{
            expectedPrincipalAmountRaw: activeEarnPosition?.principalAmountRaw,
            settingsPda: smartAccountData.overview?.settingsPda,
            solanaEnv: publicEnv.solanaEnv,
            walletAddress: walletDesktopData.walletAddress,
          }}
          hasCurrentPosition={hasEarnPosition}
          isAutodepositConfigured={Boolean(autodepositConfig)}
          isBalanceHidden={isBalanceHidden}
          onDeposit={handleOpenEarnDeposit}
          onDisableAutodeposit={handleDisableAutodeposit}
          onOpenAutodeposit={handleOpenAutodeposit}
          onWithdraw={handleOpenEarnWithdraw}
          principalAmount={earnWithdrawMaxAmount}
        />
      );
    }

    if (detailSelection === "earnAutodeposit") {
      return (
        <AutodepositSetupView
          earnBalance={earnWithdrawMaxAmount}
          earnVaultAddressLabel={earnVaultAddressLabel}
          initialAmount={autodepositConfig?.amount ?? "100"}
          initialKeepAmount={autodepositConfig?.keepAmount ?? "500"}
          isEditing={Boolean(autodepositConfig)}
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
          destinations={earnWithdrawDestinations}
          isSubmitting={smartAccountData.isActionPending}
          maxWithdrawAmount={earnWithdrawMaxAmount}
          onDraftChange={setPendingEarnWithdrawDraft}
          onDraftSubmit={handleSubmitEarnWithdrawDraft}
          onClose={handleBackFromEarnWithdraw}
          onComplete={handleCompleteEarnWithdraw}
        />
      );
    }

    if (detailSelection === "wallet") {
      return (
        <WalletDetailView
          address={walletDesktopData.walletAddress}
          activityRows={walletDesktopData.allActivityRows}
          balanceFraction={walletDesktopData.balanceFraction}
          balanceWhole={walletDesktopData.balanceWhole}
          icon={getWalletIcon()}
          initialTab={detailInitialTab}
          isBalanceHidden={isBalanceHidden}
          label={selectedSignerId ? "Main Account" : "My Wallet"}
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
          onOpenSend={() =>
            openActionView({ type: "sendPanel" }, "Send", "", "wallet")
          }
          onOpenShield={() => {
            setShieldDirection("shield");
            openActionView(
              { type: "swapPanel", mode: "shield" },
              "Shield",
              "",
              "wallet"
            );
          }}
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
            void walletDesktopData.loadActivity();
          }}
          onTokenDetail={handleTokenDetail}
          tokenRows={walletDesktopData.allTokenRows}
          transactionDetails={walletDesktopData.transactionDetails}
          receiveLabel="Receive"
          spendingLimit={
            selectedSignerId ? selectedVaultSpendingLimit : undefined
          }
          isSpendingLimitPending={
            selectedSignerId
              ? smartAccountData.pendingSpendingLimitActionKey !== null &&
                walletSpendingLimitActionKeys.has(
                  smartAccountData.pendingSpendingLimitActionKey
                )
              : false
          }
          onSetSpendingLimit={
            selectedSignerId
              ? async (amountUsd) => {
                  if (!walletDesktopData.walletAddress) {
                    throw new Error(
                      "Connect a wallet before setting a spending limit."
                    );
                  }

                  handleCreateSpendingLimitDraft({
                    kind: "set",
                    signerAddress: walletDesktopData.walletAddress,
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
            selectedSignerId
              ? async (spendingLimit) => {
                  if (!walletDesktopData.walletAddress) {
                    throw new Error(
                      "Connect a wallet before deleting a spending limit."
                    );
                  }

                  handleCreateSpendingLimitDraft({
                    kind: "delete",
                    signerAddress: walletDesktopData.walletAddress,
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

    if (detailSelection === "addSigner" && selectedVault) {
      return (
        <AddSignerPane
          accountIndex={selectedVault.entry.accountIndex}
          existingSigners={selectedVault.entry.signers}
          onAddSigner={({ signerAddress, accessLevel }) =>
            smartAccountData.addInitiateSigner({
              signerAddress,
              permissions:
                accessLevel === "suggest"
                  ? ["initiate"]
                  : accessLevel === "sign"
                  ? ["initiate", "vote"]
                  : ["initiate", "vote", "execute"],
            })
          }
          onAdded={({ signerAddress }) =>
            setPendingOpenSignerAddress(signerAddress)
          }
          pendingActionKey={smartAccountData.pendingSpendingLimitActionKey}
          vaultAddress={selectedVault.entry.address}
          vaultLabel={selectedVault.entry.label}
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
              walletDesktopData.positions
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
            executeTransfer: smartAccountData.executeVaultTransfer,
            tokenMint: effectiveSendToken.mint,
            tokenDecimals: lookupVaultMintDecimals(
              smartAccountData.overview,
              selectedVaultAccountIndex,
              effectiveSendToken.mint
            ),
            onCreateDraft: handleCreateDraftProposal,
          })
        : undefined;
      const ownAddress = walletDesktopData.walletAddress ?? null;
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
          ? selectedVault?.entry.address ?? walletDesktopData.walletAddress
          : walletDesktopData.walletAddress;

      return (
        <ReceiveContent
          onClose={closeActionView}
          walletAddress={receiveAddress}
        />
      );
    }

    if (type === "swapPanel") {
      const isVaultSwap = actionReturnSelection === "vault";
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

  return (
    <main
      className="wallet-workspace"
      data-policy-view={activeSection === "policies" ? policyView : undefined}
      data-rate-limited={isSmartAccountRateLimited}
      data-review-focused={isReviewApprovalFocused}
      data-signed-in={showWorkspaceShell}
      data-workspace-section={activeSection}
      style={
        {
          "--wallet-account-pane-width": `${accountPaneWidth}px`,
          "--wallet-review-pane-width": `${reviewPaneWidth}px`,
        } as React.CSSProperties
      }
    >
      <WalletRail
        activeSection={activeSection}
        dogCry={dogCry}
        dogNice={dogNice}
        isBalanceHidden={isBalanceHidden}
        isSignedIn={isSignedIn}
        isWalletLoading={isWorkspaceLoading}
        onDisconnect={handleDisconnect}
        onShieldUsdc={() => runOnWallet(handleCommandShieldUsdc)}
        onSectionChange={handleSectionChange}
      />

      <WalletCommandMenu
        groups={commandGroups}
        onOpenChange={setIsCommandMenuOpen}
        open={isCommandMenuOpen}
      />

      {isReviewApprovalFocused ? (
        <button
          aria-label="Close Earn preview"
          className="wallet-workspace-review-backdrop"
          onPointerDown={handleEarnPreviewBackdropPointerDown}
          type="button"
        />
      ) : null}

      {showWorkspaceShell &&
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
                earnBalance={earnWithdrawMaxAmount}
                hasEarnPosition={hasEarnPosition}
                hasVaultAccount={smartAccountData.vaultEntries.length > 0}
                isBalanceHidden={isBalanceHidden}
                isLoading={isWorkspaceLoading || isSmartAccountShellLoading}
                onBalanceHiddenChange={setIsBalanceHidden}
                onClose={() => undefined}
                onDisconnect={handleDisconnect}
                onOpenAgent={handleOpenAgent}
                onOpenAddSigner={handleOpenAddSigner}
                onOpenCommandMenu={() => setIsCommandMenuOpen(true)}
                onOpenReceive={() => handleRailAction("receive")}
                onOpenSend={() => handleRailAction("send")}
                onOpenShield={() => handleRailAction("shield")}
                onOpenSwap={() => handleRailAction("swap")}
                onOpenEarnDeposit={handleOpenEarnDeposit}
                onOpenEarn={
                  hasEarnPosition ? handleOpenEarn : handleOpenEarnDeposit
                }
                onOpenAutodeposit={handleOpenAutodeposit}
                isAutodepositConfigured={Boolean(autodepositConfig)}
                onOpenVault={handleOpenVault}
                onSmartAccountRetry={() => {
                  void smartAccountData.refresh();
                }}
                onReviewApproval={handleReviewApproval}
                onSeeAllApprovals={() => {
                  markDetailPaneTransition("switch");
                  setDetailSelection("approval");
                  setSelectedDetail("Approvals");
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
                portfolioChange24h={walletDesktopData.portfolioChange24h}
                earningsSummary={walletDesktopData.earningsSummary}
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

      {showWorkspaceShell &&
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
            ) : earnDepositReviewItem ? (
              <ApprovalReviewContent
                actionError={proposalActionError}
                approval={earnDepositReviewItem}
                isSubmitting={smartAccountData.isActionPending}
                onApprove={handleContinueEarnDepositReview}
                onBack={handleOpenEarn}
                onClose={handleOpenEarn}
                onDecline={handleDismissEarnDepositPreview}
                onExecute={handleContinueEarnDepositReview}
                showBack={false}
                showClose={false}
              />
            ) : earnWithdrawReviewItem ? (
              <ApprovalReviewContent
                actionError={proposalActionError}
                approval={earnWithdrawReviewItem}
                isSubmitting={smartAccountData.isActionPending}
                onApprove={() => void handleCompleteEarnWithdraw()}
                onBack={handleBackFromEarnWithdraw}
                onClose={handleBackFromEarnWithdraw}
                onDecline={handleDismissEarnWithdrawPreview}
                onExecute={() => void handleCompleteEarnWithdraw()}
                showBack={false}
                showClose={false}
              />
            ) : earnAutodepositSetupReviewItem ? (
              <ApprovalReviewContent
                actionError={proposalActionError}
                approval={earnAutodepositSetupReviewItem}
                isSubmitting={smartAccountData.isActionPending}
                onApprove={() => void handleCompleteEarnAutodepositSetup()}
                onBack={handleBackFromAutodeposit}
                onClose={handleBackFromAutodeposit}
                onDecline={handleDismissEarnAutodepositPreview}
                onExecute={() => void handleCompleteEarnAutodepositSetup()}
                showBack={false}
                showClose={false}
              />
            ) : earnAutodepositCloseReviewItem ? (
              <ApprovalReviewContent
                actionError={proposalActionError}
                approval={earnAutodepositCloseReviewItem}
                isSubmitting={smartAccountData.isActionPending}
                onApprove={() => void handleCompleteEarnAutodepositClose()}
                onBack={handleBackFromAutodeposit}
                onClose={handleBackFromAutodeposit}
                onDecline={handleDismissEarnAutodepositPreview}
                onExecute={() => void handleCompleteEarnAutodepositClose()}
                showBack={false}
                showClose={false}
              />
            ) : isEarnReviewContext ? (
              <EarnTransactionsPane
                isBalanceHidden={isBalanceHidden}
                onSelectTransaction={(detail) => {
                  openActionView(
                    { type: "transaction", detail, from: "portfolio" },
                    "Transaction",
                    "",
                    "earn"
                  );
                }}
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
          </section>
        </>
      ) : null}

      {/* Footer intentionally hidden during the wallet workspace redesign. */}

      <style jsx global>{`
        .wallet-workspace {
          display: grid;
          grid-template-columns:
            60px 32px
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
          grid-template-columns: 60px 32px minmax(0, 1fr);
        }

        .wallet-workspace[data-rate-limited="true"] {
          grid-template-columns: 60px 32px minmax(420px, 1fr);
        }

        .wallet-workspace[data-workspace-section="policies"] {
          grid-template-columns:
            60px 32px minmax(360px, var(--wallet-account-pane-width)) 8px
            minmax(420px, 1fr) 8px
            minmax(320px, var(--wallet-review-pane-width));
        }

        .wallet-workspace-rail {
          display: flex;
          width: 60px;
          height: 100%;
          min-height: 0;
          flex-direction: column;
          justify-content: space-between;
          padding: 16px 0 16px 16px;
        }

        .wallet-workspace-rail-top {
          display: flex;
          flex-direction: column;
          gap: 8px;
          width: 44px;
        }

        .wallet-workspace-mascot {
          position: relative;
          width: 44px;
          height: 44px;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          overflow: visible;
        }

        .wallet-workspace-mascot svg {
          width: 44px;
          height: 35px;
          flex: 0 0 auto;
        }

        .wallet-workspace-mascot-spinner {
          position: absolute;
          top: 11px;
          right: 1px;
          width: 10px;
          height: 10px;
          border-radius: 999px;
          border: 2px solid rgba(0, 0, 0, 0.14);
          border-top-color: rgba(0, 0, 0, 0.62);
          opacity: 0;
          transform: scale(0.5);
          transition: opacity 0.2s ease, transform 0.2s ease;
        }

        .wallet-workspace-mascot-spinner[data-visible="true"] {
          opacity: 1;
          transform: scale(1);
          animation: wallet-workspace-spin 0.8s linear infinite;
        }

        .wallet-workspace-mascot-bubble {
          position: absolute;
          top: 2px;
          left: 42px;
          z-index: 35;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: max-content;
          min-width: max-content;
          max-width: none;
          height: 30px;
          padding: 0 14px;
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 9999px;
          background: #fff;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.08),
            0 2px 6px rgba(0, 0, 0, 0.04);
          color: rgba(0, 0, 0, 0.86);
          font-family: var(--font-geist-sans), sans-serif;
          font-size: 13px;
          font-weight: 500;
          line-height: 16px;
          white-space: nowrap;
          pointer-events: auto;
          transform-origin: 0 50%;
          animation: wallet-workspace-mascot-bubble-unravel 0.62s
            cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        .wallet-workspace-mascot-bubble-content {
          position: relative;
          z-index: 2;
          display: inline-flex;
          align-items: center;
          flex: 0 0 auto;
          width: max-content;
          max-width: none;
          overflow: hidden;
          white-space: nowrap;
          animation: wallet-workspace-mascot-bubble-content 0.62s
            cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        .wallet-workspace-mascot-bubble-content > * {
          flex: 0 0 auto;
          white-space: nowrap;
        }

        .wallet-workspace-mascot-bubble-link {
          display: inline-flex;
          border: 0;
          background: transparent;
          color: #f9363c;
          cursor: pointer;
          font: inherit;
          padding: 0;
          text-decoration: none;
        }

        .wallet-workspace-mascot-bubble-link:hover {
          text-decoration: underline;
          text-underline-offset: 2px;
        }

        .wallet-workspace-mascot-bubble::before {
          content: "";
          position: absolute;
          z-index: 1;
          left: -5px;
          top: 11px;
          width: 10px;
          height: 10px;
          border-left: 1px solid rgba(0, 0, 0, 0.08);
          border-bottom: 1px solid rgba(0, 0, 0, 0.08);
          background: #fff;
          transform: rotate(45deg);
          animation: wallet-workspace-mascot-bubble-tail 0.62s
            cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        .wallet-workspace-rail-nav {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 12px 0;
        }

        .wallet-workspace-rail-nav-button {
          position: relative;
          width: 44px;
          height: 44px;
          border: 0;
          border-radius: 9999px;
          background: transparent;
          color: rgba(60, 60, 67, 0.58);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease,
            transform 0.15s ease;
        }

        .wallet-workspace-rail-nav-button[data-active="true"] {
          background: rgba(249, 54, 60, 0.14);
          color: #f9363c;
        }

        .wallet-workspace-rail-nav-button[data-placeholder="true"] {
          color: rgba(60, 60, 67, 0.35);
          cursor: default;
        }

        .wallet-workspace-rail-nav-button[data-tooltip]::before {
          position: absolute;
          top: 50%;
          left: calc(100% + 8px);
          width: 8px;
          height: 8px;
          border-radius: 2px;
          background: rgba(18, 18, 18, 0.94);
          content: "";
          opacity: 0;
          pointer-events: none;
          transform: translate3d(-4px, -50%, 0) rotate(45deg) scale(0.94);
          transition: opacity 0.16s ease, transform 0.16s ease;
          z-index: 20;
        }

        .wallet-workspace-rail-nav-button[data-tooltip]::after {
          position: absolute;
          top: 50%;
          left: calc(100% + 12px);
          min-width: max-content;
          max-width: 220px;
          border-radius: 12px;
          background: rgba(18, 18, 18, 0.94);
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
          color: #fff;
          content: attr(data-tooltip);
          font-family: inherit;
          font-size: 13px;
          font-weight: 500;
          line-height: 16px;
          opacity: 0;
          padding: 8px 10px;
          pointer-events: none;
          transform: translate3d(-4px, -50%, 0) scale(0.98);
          transform-origin: left center;
          transition: opacity 0.16s ease, transform 0.16s ease;
          white-space: nowrap;
          z-index: 21;
        }

        .wallet-workspace-rail-nav-button[data-tooltip]:hover::before,
        .wallet-workspace-rail-nav-button[data-tooltip]:hover::after,
        .wallet-workspace-rail-nav-button[data-tooltip]:focus-visible::before,
        .wallet-workspace-rail-nav-button[data-tooltip]:focus-visible::after {
          opacity: 1;
          transform: translate3d(0, -50%, 0) scale(1);
        }

        .wallet-workspace-rail-nav-button[data-tooltip]:hover::before,
        .wallet-workspace-rail-nav-button[data-tooltip]:focus-visible::before {
          transform: translate3d(0, -50%, 0) rotate(45deg) scale(1);
        }

        .wallet-workspace-rail-nav-button:hover {
          background: rgba(0, 0, 0, 0.06);
          transform: translateY(-1px);
        }

        .wallet-workspace-rail-nav-button[data-active="true"]:hover {
          background: rgba(249, 54, 60, 0.2);
        }

        .wallet-workspace-rail-nav-button[data-placeholder="true"]:hover {
          background: transparent;
          transform: none;
        }

        .wallet-workspace-rail-nav-button:focus-visible {
          outline: 2px solid rgba(249, 54, 60, 0.55);
          outline-offset: 2px;
        }

        .wallet-workspace-logout {
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

        .wallet-workspace-rail-bottom {
          position: relative;
          z-index: 30;
          display: flex;
          align-items: center;
          gap: 8px;
          width: max-content;
        }

        .wallet-workspace-pane {
          height: 100%;
          min-height: 0;
          min-width: 0;
          overflow: hidden;
          background: #fff;
        }

        .wallet-workspace-account-pane {
          grid-column: 3;
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
          grid-column: 5;
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
          grid-column: 5 !important;
        }

        .wallet-workspace[data-signed-in="false"]
          .wallet-workspace-detail-pane {
          grid-column: 3;
          border-right: 0;
        }

        .wallet-workspace[data-rate-limited="true"]
          .wallet-workspace-detail-pane {
          grid-column: 3;
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
          opacity: 1;
          transition: opacity 0.2s ease;
        }

        .wallet-workspace-review-backdrop:focus {
          outline: none;
        }

        .wallet-workspace[data-review-focused="true"]
          .wallet-workspace-review-pane {
          position: relative;
          z-index: 50;
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
          grid-column: 7;
          padding: 8px 8px 8px 0;
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
          grid-column: 4;
        }

        .wallet-workspace-review-resize {
          grid-column: 6;
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

        .wallet-signin-form-foot {
          display: flex;
          align-items: center;
          gap: 7px;
          margin: 0;
          color: rgba(60, 60, 67, 0.45);
          font-size: 12px;
          line-height: 16px;
        }

        .wallet-signin-form-foot svg {
          flex: 0 0 auto;
          color: rgba(60, 60, 67, 0.4);
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

        @keyframes wallet-workspace-spin {
          to {
            transform: rotate(360deg);
          }
        }

        @keyframes wallet-workspace-mascot-bubble-unravel {
          from {
            opacity: 0;
            transform: translateX(-4px) scaleX(0.08);
          }
          to {
            opacity: 1;
            transform: translateX(0) scaleX(1);
          }
        }

        @keyframes wallet-workspace-mascot-bubble-content {
          from {
            clip-path: inset(0 100% 0 0);
          }
          to {
            clip-path: inset(0 0 0 0);
          }
        }

        @keyframes wallet-workspace-mascot-bubble-tail {
          from {
            opacity: 0;
            transform: translateX(-4px) rotate(45deg) scale(0.3);
          }
          to {
            opacity: 1;
            transform: translateX(0) rotate(45deg) scale(1);
          }
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
              60px 32px
              minmax(320px, min(var(--wallet-account-pane-width), 400px))
              8px
              minmax(320px, 1fr);
          }

          .wallet-workspace-review-resize,
          .wallet-workspace-review-pane {
            display: none;
          }

          /* Keep an active approval visible when the grid drops the review
             column — float it as an overlay over the dimmed panes. */
          .wallet-workspace[data-review-focused="true"]
            .wallet-workspace-review-pane {
            display: block;
            position: fixed;
            top: 0;
            right: 0;
            bottom: 0;
            width: min(100vw, 420px);
            z-index: 50;
            box-shadow: -8px 0 24px rgba(0, 0, 0, 0.12);
          }

          .wallet-workspace[data-signed-in="false"] {
            grid-template-columns: 60px 32px minmax(0, 1fr);
          }

          .wallet-workspace[data-signed-in="false"]
            .wallet-workspace-detail-pane {
            grid-column: 3;
          }

          .wallet-workspace[data-rate-limited="true"] {
            grid-template-columns: 60px 32px minmax(320px, 1fr);
          }

          .wallet-workspace[data-rate-limited="true"]
            .wallet-workspace-detail-pane {
            grid-column: 3;
            border-right: 0;
          }
        }

        @media (max-width: 760px) {
          .wallet-workspace {
            grid-template-columns: 60px 16px minmax(0, 1fr);
            overflow: hidden;
          }

          .wallet-workspace-account-resize,
          .wallet-workspace-review-resize,
          .wallet-workspace-detail-pane,
          .wallet-workspace-review-pane {
            display: none;
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
            grid-column: 3;
          }

          .wallet-workspace[data-signed-in="false"]
            .wallet-workspace-detail-pane {
            display: flex;
            grid-column: 3;
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
