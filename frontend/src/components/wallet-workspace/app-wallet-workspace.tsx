"use client";

import { ChartNoAxesColumn, FileSliders, Wallet } from "lucide-react";
import { SOL_SPENDING_LIMIT_MINT } from "@loyal-labs/smart-account-vaults";
import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DogWithMood } from "@/components/chat-input";
import { AgentPageView } from "@/components/wallet-sidebar/agent-page-view";
import { ConnectRequestContent } from "@/components/wallet-sidebar/connect-request-content";
import { PortfolioContent } from "@/components/wallet-sidebar/portfolio-content";
import { StashDetailView } from "@/components/wallet-sidebar/stash-detail-view";
import { WalletDetailView } from "@/components/wallet-sidebar/wallet-detail-view";
import type {
  SmartAccountApprovalItem,
  SmartAccountSignerEntry,
} from "@/hooks/use-smart-account-sidebar-data";
import { useSmartAccountSidebarData } from "@/hooks/use-smart-account-sidebar-data";
import { useWalletDesktopData } from "@/hooks/use-wallet-desktop-data";
import { useAuthSession } from "@/contexts/auth-session-context";
import { useSignInModal } from "@/contexts/sign-in-modal-context";
import { useAuthCapability } from "@/lib/auth/capability";
import { AddSignerPane } from "./add-signer-pane";

type WorkspaceAction = "receive" | "send" | "swap" | "shield";
type DetailSelection = "action" | "addSigner" | "agent" | "approval" | "connect" | "overview" | "vault" | "wallet";
type ResizeTarget = "account" | "review";

const PANE_WIDTH_STORAGE_KEY = "loyal-wallet-workspace-pane-widths";
const ACCOUNT_PANE_MIN_WIDTH = 360;
const ACCOUNT_PANE_MAX_WIDTH = 520;
const ACCOUNT_PANE_DEFAULT_WIDTH = 400;
const REVIEW_PANE_MIN_WIDTH = 320;
const REVIEW_PANE_MAX_WIDTH = 520;
const REVIEW_PANE_DEFAULT_WIDTH = 400;

function clampWidth(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

const AGENT_ICON_COUNT = 26;

function hashAddress(address: string): number {
  let hash = 0;

  for (let index = 0; index < address.length; index += 1) {
    hash = (hash * 31 + address.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function getWalletIcon(address: string | null): string {
  if (!address) {
    return "/agents/Agent-01.svg";
  }

  const iconIndex = (hashAddress(address) % AGENT_ICON_COUNT) + 1;
  return `/agents/Agent-${String(iconIndex).padStart(2, "0")}.svg`;
}

const actionLabels: Record<WorkspaceAction, string> = {
  receive: "Receive",
  send: "Send",
  shield: "Shield",
  swap: "Swap",
};

function RailNavButton({
  icon,
  isActive = false,
  label,
  isPlaceholder = false,
}: {
  icon: React.ReactNode;
  isActive?: boolean;
  label: string;
  isPlaceholder?: boolean;
}) {
  return (
    <button
      aria-current={isActive ? "page" : undefined}
      aria-disabled={isPlaceholder}
      aria-label={label}
      className="wallet-workspace-rail-nav-button"
      data-active={isActive}
      data-placeholder={isPlaceholder}
      onClick={(event) => {
        if (isPlaceholder) {
          event.preventDefault();
        }
      }}
      title={isPlaceholder ? `${label} coming soon` : label}
      type="button"
    >
      {icon}
    </button>
  );
}

function WalletRail({
  dogCry,
  dogNice,
  isBalanceHidden,
  isWalletLoading,
}: {
  dogCry: boolean;
  dogNice: boolean;
  isBalanceHidden: boolean;
  isWalletLoading: boolean;
}) {
  return (
    <aside className="wallet-workspace-rail" aria-label="Workspace navigation">
      <div className="wallet-workspace-rail-top">
        <div className="wallet-workspace-mascot" aria-hidden="true">
          <DogWithMood
            cry={dogCry}
            nice={dogNice}
            squint={isBalanceHidden}
          />
          <span
            className="wallet-workspace-mascot-spinner"
            data-visible={isWalletLoading}
          />
        </div>

        <nav className="wallet-workspace-rail-nav">
          <RailNavButton
            icon={<Wallet size={24} strokeWidth={1.8} />}
            isActive
            label="Wallet"
          />
          <RailNavButton
            icon={<FileSliders size={24} strokeWidth={1.8} />}
            isPlaceholder
            label="Policies"
          />
          <RailNavButton
            icon={<ChartNoAxesColumn size={24} strokeWidth={1.8} />}
            isPlaceholder
            label="Charts"
          />
        </nav>
      </div>

      <div className="wallet-workspace-avatar" aria-hidden="true" />
    </aside>
  );
}

export function AppWalletWorkspace() {
  const walletDesktopData = useWalletDesktopData();
  const smartAccountData = useSmartAccountSidebarData();
  const { disconnect } = useWallet();
  const { logout } = useAuthSession();
  const { isSignedIn } = useAuthCapability();
  const { open: openSignIn } = useSignInModal();
  const [isBalanceHidden, setIsBalanceHidden] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState<string>("Wallet overview");
  const [detailSelection, setDetailSelection] =
    useState<DetailSelection>("vault");
  const [selectedSignerId, setSelectedSignerId] = useState<string | null>(null);
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
  const resizeStateRef = useRef<{
    startWidth: number;
    startX: number;
    target: ResizeTarget;
  } | null>(null);
  const wasWalletLoadingRef = useRef(walletDesktopData.isLoading);
  const selectedVault = smartAccountData.selectedVault;
  const selectedAgent =
    selectedVault?.entry.signers.find((signer) => signer.id === selectedSignerId) ??
    null;
  const selectedVaultAccountIndex = selectedVault?.entry.accountIndex ?? 0;
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
    `delete:${selectedVaultAccountIndex}:${walletDesktopData.walletAddress ?? ""}`,
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

  useEffect(() => {
    setConnectAgentAddress(new URLSearchParams(window.location.search).get("connect"));
  }, []);

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
          clampWidth(parsed.review, REVIEW_PANE_MIN_WIDTH, REVIEW_PANE_MAX_WIDTH)
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

    if (!isSignedIn) {
      openSignIn();
    }
  }, [connectAgentAddress, isSignedIn, openSignIn]);

  const handleDisconnect = useCallback(() => {
    setDogCry(true);
    setTimeout(() => setDogCry(false), 3000);
    void logout();
    void disconnect();
  }, [disconnect, logout]);

  const handleRailAction = useCallback((action: WorkspaceAction) => {
    setDetailSelection("action");
    setSelectedSignerId(null);
    setSelectedDetail(actionLabels[action]);
  }, []);

  const handleOpenWallet = useCallback(() => {
    setDetailSelection("wallet");
    setSelectedSignerId(null);
    setSelectedDetail("My Wallet");
  }, []);

  const handleOpenVault = useCallback(
    (accountIndex: number) => {
      smartAccountData.setSelectedVaultIndex(accountIndex);
      setDetailSelection("vault");
      setSelectedSignerId(null);
      setSelectedDetail(`Vault ${accountIndex}`);
    },
    [smartAccountData]
  );

  const handleOpenAgent = useCallback(
    (agent: SmartAccountSignerEntry) => {
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
    [walletDesktopData.walletAddress]
  );

  const handleOpenAddSigner = useCallback((accountIndex: number) => {
    setDetailSelection("addSigner");
    setSelectedSignerId(null);
    smartAccountData.setSelectedVaultIndex(accountIndex);
    setSelectedDetail(`Add signer to Vault ${accountIndex}`);
  }, [smartAccountData]);

  const handleReviewApproval = useCallback((approval: SmartAccountApprovalItem) => {
    setDetailSelection("approval");
    setSelectedSignerId(null);
    setSelectedDetail(approval.title);
  }, []);

  const handleResizeStart = useCallback(
    (target: ResizeTarget, event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      resizeStateRef.current = {
        startWidth:
          target === "account" ? accountPaneWidth : reviewPaneWidth,
        startX: event.clientX,
        target,
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [accountPaneWidth, reviewPaneWidth]
  );

  return (
    <main
      className="wallet-workspace"
      style={
        {
          "--wallet-account-pane-width": `${accountPaneWidth}px`,
          "--wallet-review-pane-width": `${reviewPaneWidth}px`,
        } as React.CSSProperties
      }
    >
      <WalletRail
        dogCry={dogCry}
        dogNice={dogNice}
        isBalanceHidden={isBalanceHidden}
        isWalletLoading={
          walletDesktopData.isLoading || smartAccountData.isLoading
        }
      />

      <section className="wallet-workspace-pane wallet-workspace-account-pane">
        {isSignedIn ? (
          <PortfolioContent
            approvals={smartAccountData.approvals}
            balanceFraction={walletDesktopData.balanceFraction}
            balanceWhole={walletDesktopData.balanceWhole}
            hasVaultAccount={smartAccountData.vaultEntries.length > 0}
            isBalanceHidden={isBalanceHidden}
            isLoading={walletDesktopData.isLoading || smartAccountData.isLoading}
            onBalanceHiddenChange={setIsBalanceHidden}
            onClose={() => undefined}
            onDisconnect={handleDisconnect}
            onOpenAgent={handleOpenAgent}
            onOpenAddSigner={handleOpenAddSigner}
            onOpenReceive={() => handleRailAction("receive")}
            onOpenSend={() => handleRailAction("send")}
            onOpenShield={() => handleRailAction("shield")}
            onOpenSwap={() => handleRailAction("swap")}
            onOpenWallet={handleOpenWallet}
            onOpenVault={handleOpenVault}
            onReviewApproval={handleReviewApproval}
            onSeeAllApprovals={() => {
              setDetailSelection("approval");
              setSelectedDetail("Approvals");
            }}
            selectedSignerId={selectedSignerId}
            selectedVaultIndex={smartAccountData.selectedVaultIndex}
            isWalletSelected={detailSelection === "wallet" && selectedSignerId === null}
            showActionButtons={false}
            showApprovals={false}
            showHeaderControls={false}
            smartAccountError={smartAccountData.error}
            vaultEntries={smartAccountData.vaultEntries}
            walletAddress={walletDesktopData.walletAddress}
            walletLabel={walletDesktopData.walletLabel}
          />
        ) : (
          <div className="wallet-workspace-signin">
            <div>
              <p className="wallet-workspace-signin-title">My Wallet</p>
              <p className="wallet-workspace-signin-copy">
                Connect your wallet to load vaults and agent permissions.
              </p>
            </div>
            <button onClick={openSignIn} type="button">
              Sign in
            </button>
          </div>
        )}
      </section>

      <button
        aria-label="Resize account pane"
        className="wallet-workspace-resize-handle wallet-workspace-account-resize"
        onPointerDown={(event) => handleResizeStart("account", event)}
        type="button"
      />

      <section className="wallet-workspace-pane wallet-workspace-detail-pane">
        {detailSelection === "connect" && connectAgentAddress ? (
          <ConnectRequestContent
            agentAddress={connectAgentAddress}
            onApprove={async () => {
              await smartAccountData.addInitiateSigner({
                signerAddress: connectAgentAddress,
              });
            }}
            onClose={() => setDetailSelection("vault")}
            onDecline={() => setDetailSelection("vault")}
            onDone={() => setDetailSelection("vault")}
          />
        ) : detailSelection === "wallet" ? (
          <WalletDetailView
            address={walletDesktopData.walletAddress}
            activityRows={walletDesktopData.allActivityRows}
            balanceFraction={walletDesktopData.balanceFraction}
            balanceWhole={walletDesktopData.balanceWhole}
            icon={getWalletIcon(walletDesktopData.walletAddress)}
            isBalanceHidden={isBalanceHidden}
            label={selectedSignerId ? "User" : "My Wallet"}
            onNavigate={(view) => {
              setDetailSelection("action");
              setSelectedDetail(typeof view === "string" ? view : view.type);
            }}
            onOpenReceive={() => handleRailAction("receive")}
            onOpenSend={() => handleRailAction("send")}
            onOpenShield={() => handleRailAction("shield")}
            onOpenSwap={() => handleRailAction("swap")}
            tokenRows={walletDesktopData.allTokenRows}
            transactionDetails={walletDesktopData.transactionDetails}
          />
        ) : detailSelection === "agent" && selectedAgent && selectedVault ? (
          <AgentPageView
            agentIcon={selectedAgent.icon}
            balanceFraction={selectedAgent.balanceFraction}
            balanceWhole={selectedAgent.balanceWhole}
            canDeleteSigner={selectedAgent.scope === "policy"}
            initialAccessLevel={selectedAgent.accessLevel}
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
            onBack={() => setSelectedSignerId(null)}
            onBalanceHiddenChange={setIsBalanceHidden}
            onDeleteSigner={(deleteArgs) =>
              smartAccountData.deleteSigner({
                ...deleteArgs,
                policyAddress: selectedAgent.policyAddress ?? null,
              })
            }
            onDeleteSpendingLimit={smartAccountData.deleteSignerSpendingLimit}
            onNavigate={(view) => {
              setSelectedDetail(typeof view === "string" ? view : view.type);
            }}
            onSetSpendingLimit={smartAccountData.setSignerSpendingLimitUsd}
            onTopUpWithSpendingLimit={
              smartAccountData.topUpSignerWithSpendingLimitUsd
            }
            signerAddress={selectedAgent.address}
            spendingLimit={selectedAgent.spendingLimit}
            tokenRows={selectedVault.tokenRows}
            transactionDetails={selectedVault.transactionDetails}
            activityRows={selectedVault.activityRows}
            vaultAccountIndex={selectedVaultAccountIndex}
            variant="workspace"
          />
        ) : detailSelection === "vault" && selectedVault ? (
          <StashDetailView
            accountIndex={selectedVault.entry.accountIndex}
            address={selectedVault.entry.address}
            activityRows={selectedVault.activityRows}
            balanceFraction={selectedVault.entry.balanceFraction}
            balanceWhole={selectedVault.entry.balanceWhole}
            isBalanceHidden={isBalanceHidden}
            label={selectedVault.entry.label}
            onNavigate={(view) => {
              setDetailSelection("action");
              setSelectedDetail(typeof view === "string" ? view : view.type);
            }}
            onOpenReceive={() => handleRailAction("receive")}
            onOpenSend={() => handleRailAction("send")}
            spendingLimit={selectedVaultSpendingLimit}
            isSpendingLimitPending={
              smartAccountData.pendingSpendingLimitActionKey !== null &&
              walletSpendingLimitActionKeys.has(
                smartAccountData.pendingSpendingLimitActionKey
              )
            }
            onSetSpendingLimit={async (amountUsd) => {
              if (!walletDesktopData.walletAddress) {
                throw new Error("Connect a wallet before setting a spending limit.");
              }

              await smartAccountData.setSignerSpendingLimitUsd({
                accountIndex: selectedVault.entry.accountIndex,
                amountUsd,
                existingSpendingLimitAddress:
                  selectedVaultSpendingLimit?.address ?? null,
                signerAddress: walletDesktopData.walletAddress,
              });
            }}
            onDeleteSpendingLimit={async (spendingLimit) => {
              if (!walletDesktopData.walletAddress) {
                throw new Error("Connect a wallet before deleting a spending limit.");
              }

              await smartAccountData.deleteSignerSpendingLimit({
                accountIndex: selectedVault.entry.accountIndex,
                spendingLimitAddress: spendingLimit.address,
                signerAddress: walletDesktopData.walletAddress,
              });
            }}
            tokenRows={selectedVault.tokenRows}
            transactionDetails={selectedVault.transactionDetails}
          />
        ) : detailSelection === "addSigner" && selectedVault ? (
          <AddSignerPane
            accountIndex={selectedVault.entry.accountIndex}
            existingSigners={selectedVault.entry.signers}
            onAddSigner={(signerAddress) =>
              smartAccountData.addInitiateSigner({ signerAddress })
            }
            pendingActionKey={smartAccountData.pendingSpendingLimitActionKey}
            vaultAddress={selectedVault.entry.address}
            vaultLabel={selectedVault.entry.label}
          />
        ) : (
          <div className="wallet-workspace-placeholder">
            <span>Selected</span>
            <strong>{selectedDetail}</strong>
          </div>
        )}
      </section>

      <button
        aria-label="Resize approvals pane"
        className="wallet-workspace-resize-handle wallet-workspace-review-resize"
        onPointerDown={(event) => handleResizeStart("review", event)}
        type="button"
      />

      <section className="wallet-workspace-pane wallet-workspace-review-pane">
        <div className="wallet-workspace-placeholder wallet-workspace-placeholder-left">
          <span>Approvals</span>
          <strong>
            {smartAccountData.approvals.length > 0
              ? `${smartAccountData.approvals.length} pending`
              : "No smart-account proposals yet"}
          </strong>
        </div>
      </section>

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
          min-height: 100vh;
          width: 100%;
          overflow: hidden;
          background: #fff;
          color: #000;
          font-family: var(--font-geist-sans), sans-serif;
        }

        .wallet-workspace-rail {
          display: flex;
          width: 60px;
          min-height: 100vh;
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

        .wallet-workspace-rail-nav {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 12px 0;
        }

        .wallet-workspace-rail-nav-button {
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
          transition:
            background 0.15s ease,
            color 0.15s ease,
            transform 0.15s ease;
        }

        .wallet-workspace-rail-nav-button[data-active="true"] {
          background: rgba(249, 54, 60, 0.14);
          color: #f9363c;
        }

        .wallet-workspace-rail-nav-button[data-placeholder="true"] {
          cursor: default;
          opacity: 0.45;
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

        .wallet-workspace-avatar {
          width: 44px;
          height: 44px;
          border-radius: 9999px;
          background:
            linear-gradient(135deg, rgba(0, 0, 0, 0.74), rgba(0, 0, 0, 0.9)),
            #3d3d3d;
        }

        .wallet-workspace-pane {
          min-height: 100vh;
          min-width: 0;
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

        .wallet-workspace-account-pane > div {
          width: 100%;
        }

        .wallet-workspace-detail-pane {
          grid-column: 5;
          padding: 8px;
          border-right: 1px solid rgba(0, 0, 0, 0.06);
        }

        .wallet-workspace-review-pane {
          grid-column: 7;
          padding: 8px 8px 8px 0;
        }

        .wallet-workspace-resize-handle {
          width: 8px;
          min-height: 100vh;
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

        .wallet-workspace-placeholder {
          display: flex;
          height: 100%;
          min-height: calc(100vh - 16px);
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

        .wallet-workspace-placeholder span,
        .wallet-workspace-signin-copy {
          font-size: 13px;
          line-height: 16px;
          color: rgba(60, 60, 67, 0.6);
        }

        .wallet-workspace-placeholder strong,
        .wallet-workspace-signin-title {
          margin: 0;
          font-size: 20px;
          font-weight: 600;
          line-height: 24px;
          color: #000;
        }

        .wallet-workspace-signin {
          display: flex;
          width: 100%;
          height: 100%;
          min-height: 100vh;
          flex-direction: column;
          justify-content: space-between;
          padding: 20px;
        }

        .wallet-workspace-signin button {
          height: 44px;
          border: 0;
          border-radius: 9999px;
          background: #000;
          color: #fff;
          font: inherit;
          font-size: 16px;
          cursor: pointer;
        }

        @keyframes wallet-workspace-spin {
          to {
            transform: rotate(360deg);
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
        }

        @media (max-width: 760px) {
          .wallet-workspace {
            grid-template-columns: 60px 16px minmax(0, 1fr);
            overflow: auto;
          }

          .wallet-workspace-account-resize,
          .wallet-workspace-review-resize,
          .wallet-workspace-detail-pane,
          .wallet-workspace-review-pane {
            display: none;
          }
        }
      `}</style>
    </main>
  );
}
