"use client";

import type { PortfolioPosition } from "@loyal-labs/solana-wallet";
import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SendContent } from "@/components/wallet-sidebar/send-content";
import {
  ShieldContent,
  SwapShieldTabs,
} from "@/components/wallet-sidebar/shield-content";
import { SwapContent } from "@/components/wallet-sidebar/swap-content";
import { TokenSelectView } from "@/components/wallet-sidebar/token-select-view";
import {
  LOYL_TOKEN,
  swapTokens as fallbackSwapTokens,
} from "@/components/wallet-sidebar/types";
import type {
  FormButtonProps,
  SubView,
  SwapMode,
  SwapToken,
  TokenRow,
} from "@/components/wallet-sidebar/types";
import {
  CryptoPane,
  type CryptoPaneVariant,
  type CryptoRowActions,
} from "@/components/wallet-workspace/facelift/crypto-pane";
import {
  MiddlePaneSlide,
  PaneReveal,
} from "@/components/wallet-workspace/facelift/pane-transitions";
import { SheetReveal } from "@/components/wallet-workspace/facelift/sheet-reveal";
import { useAuthCapability } from "@/lib/auth/capability";
import { usePublicEnv } from "@/contexts/public-env-context";
import { usePopularTokens } from "@/hooks/use-popular-tokens";
import {
  splitUsdBalance,
  useWalletDesktopData,
} from "@/hooks/use-wallet-desktop-data";
import {
  getFrontendPrivateClient,
  hasReusableFrontendPrivateClientAuth,
  type FrontendPrivateClientSigner,
} from "@/lib/solana/private-client-cache";
import { getTokenIconUrl } from "@/lib/token-icon";
import {
  getStablecoinMintSetForSolanaEnv,
  isStablecoinMint,
} from "@/lib/wallet/stablecoin-classification";

type ActionView = Exclude<SubView, null>;

function viewType(view: SubView) {
  return typeof view === "object" && view !== null ? view.type : view;
}

function shouldLoadPopularTokensForView(view: ActionView) {
  const type = viewType(view);
  return type === "swapPanel" || type === "tokenSelect";
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

function portfolioPositionToSwapToken(position: PortfolioPosition): SwapToken {
  return {
    balance: position.publicBalance,
    icon: position.asset.imageUrl ?? getTokenIconUrl(position.asset.symbol),
    mint: position.asset.mint,
    price: position.priceUsd ?? 0,
    symbol: position.asset.symbol,
  };
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

// The workspace monolith gates shielded balances behind a MagicBlock auth
// signature; this modal is its ApprovalReview item ("Sign to show balances")
// rebuilt on the facelift sheet.
function ShieldUnlockOverlay({
  error,
  isOpen,
  isUnlocking,
  onClose,
  onSign,
}: {
  error: string | null;
  isOpen: boolean;
  isUnlocking: boolean;
  onClose: () => void;
  onSign: () => void;
}) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <SheetReveal
      isOpen={isOpen}
      onClose={onClose}
      scrimClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4 backdrop-blur-[4px]"
      sheetClassName="flex w-full max-w-[400px] flex-col overflow-clip rounded-3xl bg-white"
    >
      <header className="flex w-full items-center p-2">
        <h2 className="min-w-0 flex-1 truncate py-2.5 pl-4 font-semibold text-[20px] text-black leading-6">
          Shielded balances
        </h2>
        <button
          aria-label="Close"
          className="t-hover flex size-11 shrink-0 items-center justify-center rounded-3xl hover:bg-black/[0.04]"
          onClick={onClose}
          type="button"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            aria-hidden="true"
            className="size-6"
            src="/wallet-workspace/facelift/icon-cross.svg"
          />
        </button>
      </header>
      <p className="px-4 text-[16px] leading-5 text-[rgba(60,60,67,0.6)]">
        Signing proves wallet ownership so Loyal can show shielded balances. No
        funds move and no gas is spent.
      </p>
      {error ? (
        <p className="px-4 pt-2 text-[13px] leading-4 text-[#f9363c]">
          {error}
        </p>
      ) : null}
      <div className="w-full p-4">
        <button
          className="t-hover flex h-12 w-full items-center justify-center rounded-full bg-black font-medium text-[16px] text-white leading-5 hover:bg-[#171717] disabled:bg-[#cccdcd]"
          disabled={isUnlocking}
          onClick={onSign}
          type="button"
        >
          {isUnlocking ? "Waiting for signature…" : "Sign to show balances"}
        </button>
      </div>
    </SheetReveal>
  );
}

// Crypto screen (Figma 4813:338843) and, via page="stables", the Stablecoins
// one (4813:339437): the root token list plus the OG action flows —
// SendContent / SwapContent / ShieldContent and their token-select subviews —
// mounted as the page-slide action screen. All handler logic is ported from
// the workspace monolith's personal-wallet slice; the stables Earn buttons
// jump to the Earn page's deposit screen.
export function CryptoPage({
  onBack,
  onEarn,
  page,
}: {
  onBack: () => void;
  onEarn: () => void;
  page: CryptoPaneVariant;
}) {
  const publicEnv = usePublicEnv();
  const wallet = useWallet();
  const { isHydrated, isSignedIn } = useAuthCapability();

  // --- shielded balances unlock (ported from the monolith) ---
  const connectedWalletAddress = wallet.publicKey?.toBase58() ?? null;
  const unlockKey = connectedWalletAddress
    ? `${connectedWalletAddress}:${publicEnv.solanaEnv}`
    : null;
  const [unlockedForKey, setUnlockedForKey] = useState<string | null>(null);
  const [isUnlockOpen, setIsUnlockOpen] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const pendingUnlockActionRef = useRef<(() => void) | null>(null);
  const hasUnlockedShieldedBalances =
    unlockKey !== null && unlockedForKey === unlockKey;

  useEffect(() => {
    // Reset on wallet/env change; wallets with reusable private-client auth
    // unlock silently (no signature prompt) so shielded rows just appear.
    setUnlockError(null);
    setIsUnlocking(false);
    setIsUnlockOpen(false);
    pendingUnlockActionRef.current = null;
    setUnlockedForKey(
      unlockKey &&
        connectedWalletAddress &&
        hasReusableFrontendPrivateClientAuth({
          publicKey: connectedWalletAddress,
          solanaEnv: publicEnv.solanaEnv,
        })
        ? unlockKey
        : null
    );
  }, [connectedWalletAddress, publicEnv.solanaEnv, unlockKey]);

  const data = useWalletDesktopData({
    includeSecureBalances: hasUnlockedShieldedBalances,
  });

  const stablecoinMints = useMemo(
    () => getStablecoinMintSetForSolanaEnv(publicEnv.solanaEnv),
    [publicEnv.solanaEnv]
  );
  // Same numbers the sidebar rows show: stablecoins summed by mint, crypto =
  // wallet total minus stablecoins.
  const stablecoinsUsd = useMemo(
    () =>
      data.positions.reduce(
        (sum, position) =>
          isStablecoinMint(position.asset.mint, stablecoinMints)
            ? sum + (position.totalValueUsd ?? 0)
            : sum,
        0
      ),
    [data.positions, stablecoinMints]
  );
  const pageBalance = splitUsdBalance(
    page === "stables"
      ? stablecoinsUsd
      : Math.max(data.totalUsd - stablecoinsUsd, 0)
  );
  const isWalletDataRevealed =
    isHydrated &&
    (!isSignedIn || (data.walletAddress !== null && !data.isLoading));

  // --- action flow state (ported from the monolith's personal-wallet slice) ---
  const [viewStack, setViewStack] = useState<ActionView[]>([]);
  const [swapMode, setSwapMode] = useState<SwapMode>("swap");
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
  const [swapFormActive, setSwapFormActive] = useState(false);
  const [shieldFormActive, setShieldFormActive] = useState(false);
  const [swapButtonProps, setSwapButtonProps] =
    useState<FormButtonProps | null>(null);
  const [shieldButtonProps, setShieldButtonProps] =
    useState<FormButtonProps | null>(null);
  const [shouldLoadPopularTokens, setShouldLoadPopularTokens] = useState(false);
  const { tokens: popularTokens, search: searchTokens } = usePopularTokens({
    enabled: shouldLoadPopularTokens,
  });

  const derivedTokens = useMemo<SwapToken[]>(() => {
    const positions = data.positions;

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
  }, [data.positions]);
  const securedTokens = useMemo<SwapToken[]>(
    () =>
      data.positions
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
    [data.positions]
  );
  const shieldSourceTokens = useMemo(
    () => [...derivedTokens, ...securedTokens],
    [derivedTokens, securedTokens]
  );
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
    if (!shieldToken.mint) {
      return 0;
    }

    const position = data.positions.find(
      (entry) => entry.asset.mint === shieldToken.mint
    );

    return position?.securedBalance ?? 0;
  }, [data.positions, shieldToken.mint]);

  // Seed the flow tokens once the wallet's real tokens land.
  const prevHadTokensRef = useRef(false);
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

  const pushView = useCallback((view: ActionView) => {
    if (shouldLoadPopularTokensForView(view)) {
      setShouldLoadPopularTokens(true);
    }
    setViewStack((current) => [...current, view]);
  }, []);

  const popView = useCallback(() => {
    setViewStack((current) => current.slice(0, -1));
  }, []);

  const closeAction = useCallback(() => {
    setViewStack([]);
  }, []);

  const openAction = useCallback((view: ActionView) => {
    if (shouldLoadPopularTokensForView(view)) {
      setShouldLoadPopularTokens(true);
    }
    if (typeof view === "object" && view.type === "swapPanel") {
      setSwapMode(view.mode ?? "swap");
    }
    setViewStack([view]);
  }, []);

  const tryUnlockFromReusableAuth = useCallback(() => {
    if (!(connectedWalletAddress && unlockKey)) {
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

    setUnlockedForKey(unlockKey);
    return true;
  }, [connectedWalletAddress, publicEnv.solanaEnv, unlockKey]);

  const requireShieldedUnlock = useCallback(
    (action: () => void) => {
      if (hasUnlockedShieldedBalances || tryUnlockFromReusableAuth()) {
        action();
        return;
      }
      pendingUnlockActionRef.current = action;
      setUnlockError(null);
      setIsUnlockOpen(true);
    },
    [hasUnlockedShieldedBalances, tryUnlockFromReusableAuth]
  );

  const dismissUnlock = useCallback(() => {
    pendingUnlockActionRef.current = null;
    setUnlockError(null);
    setIsUnlockOpen(false);
  }, []);

  const unlockShieldedBalances = useCallback(async () => {
    const publicKey = wallet.publicKey;
    const signTransaction = wallet.signTransaction;
    const signAllTransactions = wallet.signAllTransactions;
    const signMessage = wallet.signMessage;

    if (
      !(
        wallet.connected &&
        publicKey &&
        signTransaction &&
        signAllTransactions &&
        signMessage &&
        unlockKey
      )
    ) {
      setUnlockError(
        "Connect a wallet that supports message and transaction signing."
      );
      return;
    }

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

    setIsUnlocking(true);
    setUnlockError(null);

    try {
      await getFrontendPrivateClient({
        signer,
        solanaEnv: publicEnv.solanaEnv,
      });
      setUnlockedForKey(unlockKey);
      setIsUnlockOpen(false);
      const pending = pendingUnlockActionRef.current;
      pendingUnlockActionRef.current = null;
      pending?.();
    } catch (error) {
      setUnlockError(
        getShieldedBalancesUnlockErrorMessage(signMessageError ?? error)
      );
    } finally {
      setIsUnlocking(false);
    }
  }, [
    publicEnv.solanaEnv,
    unlockKey,
    wallet.connected,
    wallet.publicKey,
    wallet.signAllTransactions,
    wallet.signMessage,
    wallet.signTransaction,
  ]);

  const handleSwapModeChange = useCallback((mode: SwapMode) => {
    setSwapMode(mode);
  }, []);

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

  // Wrapped so flow callbacks' own arguments never leak into refresh's
  // isCurrent parameter.
  const refreshWalletData = data.refresh;
  const refreshWallet = useCallback(
    () => refreshWalletData(),
    [refreshWalletData]
  );

  const rowActions: CryptoRowActions = {
    // ponytail: the deposit pane picks its own source token, so row-level
    // Earn lands on the same screen as the header button.
    onEarn: () => onEarn(),
    onSend: (row) => {
      setSendToken(tokenRowToSwapToken(row));
      openAction({ type: "sendPanel" });
    },
    onShield: (row) => {
      const token = tokenRowToSwapToken(row);
      requireShieldedUnlock(() => {
        setShieldToken(token);
        setShieldDirection("shield");
        openAction({ type: "swapPanel", mode: "shield" });
      });
    },
    onSwap: (row) => {
      const mint = row.id?.replace(/-secured$/, "");
      const base =
        derivedTokens.find((token) => token.mint === mint) ??
        tokenRowToSwapToken(row);
      setSwapFromToken(base);
      openAction({ type: "swapPanel", mode: "swap" });
    },
    onUnshield: (row) => {
      const token = tokenRowToSwapToken(row);
      requireShieldedUnlock(() => {
        setShieldToken(token);
        setShieldDirection("unshield");
        openAction({ type: "swapPanel", mode: "shield" });
      });
    },
  };

  const handleShield = () =>
    requireShieldedUnlock(() => {
      setShieldDirection("shield");
      openAction({ type: "swapPanel", mode: "shield" });
    });

  const actionView = viewStack[viewStack.length - 1] ?? null;
  const actionType = actionView === null ? null : viewType(actionView);

  const renderActionView = () => {
    if (actionView === null) {
      return null;
    }

    if (typeof actionView === "object" && actionView.type === "tokenSelect") {
      const field = actionView.field;
      return (
        <TokenSelectView
          currentToken={field === "from" ? swapFromToken : swapToToken}
          onBack={popView}
          onClose={closeAction}
          onSearch={field === "to" ? searchTokens : undefined}
          onSelect={handleTokenSelect}
          title={field === "from" ? "You Swap" : "You Receive"}
          tokens={field === "to" ? swapTargetTokens : derivedTokens}
        />
      );
    }

    if (actionType === "sendTokenSelect") {
      return (
        <TokenSelectView
          currentToken={sendToken}
          onBack={popView}
          onClose={closeAction}
          onSelect={setSendToken}
          title="Send"
          tokens={derivedTokens}
        />
      );
    }

    if (actionType === "shieldTokenSelect") {
      return (
        <TokenSelectView
          currentToken={shieldToken}
          isTokenSelected={(token) =>
            token.mint === shieldToken.mint &&
            (token.isSecured
              ? shieldDirection === "unshield"
              : shieldDirection === "shield")
          }
          onBack={popView}
          onClose={closeAction}
          onSelect={(token) => {
            const nextDirection = token.isSecured ? "unshield" : "shield";
            const baseToken =
              derivedTokens.find(
                (nextToken) => nextToken.mint === token.mint
              ) ??
              data.positions
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

    if (actionType === "sendPanel") {
      return (
        <SendContent
          addLocalActivity={data.addLocalActivity}
          allowPrivateSend
          onClose={closeAction}
          onDone={closeAction}
          onNavigate={pushView}
          onSuccess={refreshWallet}
          token={sendToken}
        />
      );
    }

    if (actionType === "swapPanel") {
      // The monolith's swap/shield pair: both stay mounted and slide
      // horizontally while the tabs switch modes.
      const showTabs = swapMode === "swap" ? swapFormActive : shieldFormActive;
      const buttonProps =
        swapMode === "swap" ? swapButtonProps : shieldButtonProps;

      return (
        <div className="flex h-full min-h-0 flex-1 flex-col">
          {showTabs ? (
            <SwapShieldTabs
              mode={swapMode}
              onClose={closeAction}
              onModeChange={handleSwapModeChange}
            />
          ) : null}
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div
              className="absolute inset-0 flex flex-col transition-transform duration-[350ms] ease-[cubic-bezier(0.25,0.1,0.25,1)] will-change-transform"
              style={{
                transform:
                  swapMode === "swap" ? "translateX(0)" : "translateX(-100%)",
              }}
            >
              <SwapContent
                fromToken={swapFromToken}
                hideFormChrome
                onClose={closeAction}
                onDone={closeAction}
                onFormActiveChange={setSwapFormActive}
                onFormButtonChange={setSwapButtonProps}
                onFromTokenChange={setSwapFromToken}
                onNavigate={pushView}
                onSuccess={refreshWallet}
                onSwapModeChange={handleSwapModeChange}
                onToTokenChange={setSwapToToken}
                swapMode={swapMode}
                toToken={swapToToken}
              />
            </div>
            <div
              className="absolute inset-0 flex flex-col transition-transform duration-[350ms] ease-[cubic-bezier(0.25,0.1,0.25,1)] will-change-transform"
              style={{
                transform:
                  swapMode === "shield" ? "translateX(0)" : "translateX(100%)",
              }}
            >
              <ShieldContent
                hideFormChrome
                initialDirection={shieldDirection}
                onClose={closeAction}
                onDone={closeAction}
                onFormActiveChange={setShieldFormActive}
                onFormButtonChange={setShieldButtonProps}
                onNavigate={pushView}
                onSuccess={refreshWallet}
                onSwapModeChange={handleSwapModeChange}
                onTokenChange={setShieldToken}
                securedBalance={shieldSecuredBalance}
                swapMode={swapMode}
                token={shieldToken}
              />
            </div>
          </div>
          {buttonProps ? (
            <div className="px-5 py-4">
              <button
                className="t-hover flex h-12 w-full items-center justify-center rounded-full bg-black font-medium text-[16px] text-white leading-5 hover:bg-[#171717] disabled:bg-[#cccdcd]"
                disabled={buttonProps.disabled}
                onClick={buttonProps.onClick}
                type="button"
              >
                {buttonProps.label}
              </button>
            </div>
          ) : null}
        </div>
      );
    }

    return null;
  };

  return (
    <>
      <div className="flex h-full min-h-0 min-w-0 flex-1 gap-2 p-2 max-[795px]:gap-0 max-[795px]:p-0">
        <MiddlePaneSlide
          actionPane={
            actionView !== null ? (
              <section className="flex h-full w-full min-w-0 flex-1 flex-col overflow-clip rounded-3xl bg-white max-[795px]:rounded-none">
                <div className="mx-auto flex h-full min-h-0 w-full max-w-[480px] flex-col">
                  {renderActionView()}
                </div>
              </section>
            ) : null
          }
        >
          <PaneReveal>
            <CryptoPane
              balanceFraction={pageBalance.balanceFraction}
              balanceWhole={pageBalance.balanceWhole}
              isBalanceRevealed={isWalletDataRevealed}
              onBack={onBack}
              onEarn={onEarn}
              onSend={() => openAction({ type: "sendPanel" })}
              onShield={handleShield}
              onSwap={() => openAction({ type: "swapPanel", mode: "swap" })}
              rowActions={rowActions}
              tokenRows={
                page === "stables"
                  ? data.cashTokenRows
                  : data.investmentTokenRows
              }
              variant={page}
            />
          </PaneReveal>
        </MiddlePaneSlide>
        {actionView === null ? (
          // ponytail: the Figma right pane is a "🛠 Token page" placeholder —
          // the token detail screen ships with a later design.
          <aside className="hidden h-full w-[400px] shrink-0 flex-col items-center justify-center overflow-clip rounded-3xl bg-white min-[1204px]:flex">
            <p className="text-center font-medium text-[#8a8a8e] text-[16px] leading-5">
              <span className="font-bold">{"🛠 "}</span>
              Token page
            </p>
          </aside>
        ) : null}
      </div>
      <ShieldUnlockOverlay
        error={unlockError}
        isOpen={isUnlockOpen}
        isUnlocking={isUnlocking}
        onClose={dismissUnlock}
        onSign={() => void unlockShieldedBalances()}
      />
    </>
  );
}
