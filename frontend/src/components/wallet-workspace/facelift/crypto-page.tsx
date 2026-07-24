"use client";

import type { PortfolioPosition } from "@loyal-labs/solana-wallet";
import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SendContent } from "@/components/wallet-sidebar/send-content";
import { TokenSelectView } from "@/components/wallet-sidebar/token-select-view";
import {
  LOYL_TOKEN,
  swapTokens as fallbackSwapTokens,
} from "@/components/wallet-sidebar/types";
import type {
  SubView,
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
import {
  InlineSheetReveal,
  SheetReveal,
} from "@/components/wallet-workspace/facelift/sheet-reveal";
import {
  ShieldAssetPane,
  ShieldInfoOverlay,
  ShieldPane,
} from "@/components/wallet-workspace/facelift/shield-pane";
import {
  SwapPane,
  SwapTokenSelectPane,
} from "@/components/wallet-workspace/facelift/swap-pane";
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
// one (4813:339437): the root token list plus the action flows — the
// redesigned Swap and Shield screens, and the OG SendContent with its
// token-select subview — mounted as the page-slide action screen. All handler
// logic is ported from the workspace monolith's personal-wallet slice; the
// stables Earn buttons jump to the Earn page's deposit screen.
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
  const [sendToken, setSendToken] = useState<SwapToken>(fallbackSwapTokens[0]);
  const [swapFromToken, setSwapFromToken] = useState<SwapToken>(
    fallbackSwapTokens[0]
  );
  const [swapToToken, setSwapToToken] = useState<SwapToken>(LOYL_TOKEN);
  const [shieldToken, setShieldToken] = useState<SwapToken>(
    fallbackSwapTokens[0]
  );
  const [shouldLoadPopularTokens, setShouldLoadPopularTokens] = useState(false);
  const { tokens: popularTokens, search: searchTokens } = usePopularTokens({
    enabled: shouldLoadPopularTokens,
  });

  // --- redesigned Swap screen (Figma 4819:414629) ---
  const [isSwapOpen, setIsSwapOpen] = useState(false);
  const [swapSelectSide, setSwapSelectSide] = useState<"from" | "to" | null>(
    null
  );
  // Keeps the selector content rendered through the overlay's close slide.
  const swapSelectSideRef = useRef<"from" | "to">("to");
  if (swapSelectSide) {
    swapSelectSideRef.current = swapSelectSide;
  }
  const overlaySelectSide = swapSelectSide ?? swapSelectSideRef.current;

  // --- redesigned Shield screen (Figma 4822:416013) ---
  const [isShieldOpen, setIsShieldOpen] = useState(false);
  // <1204 only: the asset selector as an overlay (the aside is hidden there).
  const [isShieldSelectOpen, setIsShieldSelectOpen] = useState(false);
  const [isShieldInfoOpen, setIsShieldInfoOpen] = useState(false);
  // Mirrors ShieldPane's step: the selector panes hide once a submit starts
  // and stay hidden on the result screens.
  const [isShieldFormActive, setIsShieldFormActive] = useState(true);
  const handleShieldFormActiveChange = useCallback((isFormActive: boolean) => {
    setIsShieldFormActive(isFormActive);
    if (!isFormActive) {
      setIsShieldSelectOpen(false);
    }
  }, []);

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
  // Shielded variants sit right under their public sibling (grouped per
  // token), not in a bucket at the end; orphans without a public row follow.
  const shieldSourceTokens = useMemo(() => {
    const securedByMint = new Map(
      securedTokens.map((token) => [token.mint, token])
    );
    const grouped: SwapToken[] = [];
    for (const token of derivedTokens) {
      grouped.push(token);
      const secured = token.mint ? securedByMint.get(token.mint) : undefined;
      if (secured) {
        grouped.push(secured);
        securedByMint.delete(token.mint);
      }
    }
    grouped.push(...securedByMint.values());
    return grouped;
  }, [derivedTokens, securedTokens]);
  const swapTargetTokens = useMemo<SwapToken[]>(() => {
    const heldMints = new Set(
      derivedTokens.map((token) => token.mint).filter(Boolean)
    );
    const extras = popularTokens.filter(
      (token) => token.mint && !heldMints.has(token.mint)
    );

    return [...derivedTokens, ...extras];
  }, [derivedTokens, popularTokens]);

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
    setViewStack((current) => [...current, view]);
  }, []);

  const popView = useCallback(() => {
    setViewStack((current) => current.slice(0, -1));
  }, []);

  const closeAction = useCallback(() => {
    setViewStack([]);
  }, []);

  const openAction = useCallback((view: ActionView) => {
    setViewStack([view]);
  }, []);

  // Ref mirrors so the swap open/select callbacks read the latest pair
  // without re-creating per selection.
  const swapFromTokenRef = useRef(swapFromToken);
  swapFromTokenRef.current = swapFromToken;
  const swapToTokenRef = useRef(swapToToken);
  swapToTokenRef.current = swapToToken;

  const openSwap = useCallback((from?: SwapToken) => {
    setShouldLoadPopularTokens(true);
    if (from) {
      setSwapFromToken(from);
      // Opening from a row that already sits on the receive side would pair
      // a token with itself — hand the receive side the previous from.
      setSwapToToken((current) =>
        current.symbol === from.symbol ? swapFromTokenRef.current : current
      );
    }
    setViewStack([]);
    setSwapSelectSide(null);
    setIsShieldOpen(false);
    setIsShieldSelectOpen(false);
    setIsSwapOpen(true);
  }, []);

  const closeSwap = useCallback(() => {
    setIsSwapOpen(false);
    setSwapSelectSide(null);
  }, []);

  const closeShield = useCallback(() => {
    setIsShieldOpen(false);
    setIsShieldSelectOpen(false);
    setIsShieldInfoOpen(false);
  }, []);

  // OG handleTokenSelect collision rule: picking the token already on the
  // other side swaps the pair instead of duplicating it.
  const handleSwapTokenSelect = useCallback(
    (side: "from" | "to", token: SwapToken) => {
      if (side === "from") {
        setSwapToToken((currentTo) =>
          currentTo.symbol === token.symbol
            ? swapFromTokenRef.current
            : currentTo
        );
        setSwapFromToken(token);
      } else {
        setSwapFromToken((currentFrom) =>
          currentFrom.symbol === token.symbol
            ? swapToTokenRef.current
            : currentFrom
        );
        setSwapToToken(token);
      }
      setSwapSelectSide(null);
    },
    []
  );

  // Portfolio names for the selector rows — SwapToken itself only carries a
  // symbol; popular/searched tokens fall back to the ticker.
  const tokenNameByMint = useMemo(() => {
    const map: Record<string, string> = {};
    for (const position of data.positions) {
      map[position.asset.mint] = position.asset.name;
    }
    return map;
  }, [data.positions]);

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

  // Direction is derived from the selected asset (shielded → unshield), so
  // opening just needs the unlock gate + the source token.
  const openShield = useCallback(
    (token?: SwapToken) => {
      requireShieldedUnlock(() => {
        if (token) {
          setShieldToken(token);
        }
        setViewStack([]);
        setIsSwapOpen(false);
        setSwapSelectSide(null);
        setIsShieldFormActive(true);
        setIsShieldOpen(true);
      });
    },
    [requireShieldedUnlock]
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
    // Shield and Unshield land on the same screen — the row token's secured
    // flag picks the direction.
    onShield: (row) => openShield(tokenRowToSwapToken(row)),
    onSwap: (row) => {
      const mint = row.id?.replace(/-secured$/, "");
      const base =
        derivedTokens.find((token) => token.mint === mint) ??
        tokenRowToSwapToken(row);
      openSwap(base);
    },
    onUnshield: (row) => openShield(tokenRowToSwapToken(row)),
  };

  const handleShield = () => openShield();

  const actionView = viewStack[viewStack.length - 1] ?? null;
  const actionType = actionView === null ? null : viewType(actionView);

  const renderActionView = () => {
    if (actionView === null) {
      return null;
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
            ) : isSwapOpen ? (
              <SwapPane
                activeSelectSide={swapSelectSide}
                fromToken={swapFromToken}
                onBack={closeSwap}
                onDone={closeSwap}
                onFlipTokens={() => {
                  setSwapFromToken(swapToToken);
                  setSwapToToken(swapFromToken);
                }}
                onRequestSelect={(side) =>
                  setSwapSelectSide((current) =>
                    current === side ? null : side
                  )
                }
                onSuccess={refreshWallet}
                toToken={swapToToken}
              />
            ) : isShieldOpen ? (
              <ShieldPane
                onBack={closeShield}
                onDone={closeShield}
                onFormActiveChange={handleShieldFormActiveChange}
                onOpenInfo={() => setIsShieldInfoOpen(true)}
                onOpenSelect={() => setIsShieldSelectOpen(true)}
                onSuccess={refreshWallet}
                token={shieldToken}
              />
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
              onSwap={() => openSwap()}
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
        {actionView !== null ? null : isSwapOpen ? (
          // Swap's right pane: a reserved 400px slot (Figma 4813:403499
          // keeps it empty) the selector panel-reveals into and out of;
          // switching sides replays the content reveal on the open panel.
          <div className="hidden h-full w-[400px] shrink-0 min-[1204px]:block">
            <InlineSheetReveal
              className="flex h-full w-full min-w-0 flex-col overflow-clip rounded-3xl bg-white"
              isOpen={swapSelectSide !== null}
            >
              <PaneReveal key={overlaySelectSide}>
                <SwapTokenSelectPane
                  nameByMint={tokenNameByMint}
                  onClose={() => setSwapSelectSide(null)}
                  onSearch={
                    overlaySelectSide === "to" ? searchTokens : undefined
                  }
                  onSelect={(token) =>
                    handleSwapTokenSelect(overlaySelectSide, token)
                  }
                  side={overlaySelectSide}
                  tokens={
                    overlaySelectSide === "from"
                      ? derivedTokens
                      : swapTargetTokens
                  }
                />
              </PaneReveal>
            </InlineSheetReveal>
          </div>
        ) : isShieldOpen ? (
          // Shield's right pane (Figma 4822:417305): the asset selector rides
          // the form — it slides out while a submit runs and on the result
          // screens (the 400px slot stays reserved so the middle never jumps).
          <div className="hidden h-full w-[400px] shrink-0 min-[1204px]:block">
            <InlineSheetReveal
              className="flex h-full w-full min-w-0 flex-col overflow-clip rounded-3xl bg-white"
              isOpen={isShieldFormActive}
            >
              <PaneReveal>
                <ShieldAssetPane
                  nameByMint={tokenNameByMint}
                  onSelect={setShieldToken}
                  selectedToken={shieldToken}
                  tokens={shieldSourceTokens}
                />
              </PaneReveal>
            </InlineSheetReveal>
          </div>
        ) : (
          // ponytail: the Figma right pane is a "🛠 Token page" placeholder —
          // the token detail screen ships with a later design.
          <aside className="hidden h-full w-[400px] shrink-0 flex-col items-center justify-center overflow-clip rounded-3xl bg-white min-[1204px]:flex">
            <p className="text-center font-medium text-[#8a8a8e] text-[16px] leading-5">
              <span className="font-bold">{"🛠 "}</span>
              Token page
            </p>
          </aside>
        )}
      </div>
      {/* Below 1204px the selector opens as the right-pinned card over the
          dark scrim (Figma 4819:413827) — the chart-enlarge geometry; on
          desktop the scrim is display:none while the aside shows it. */}
      <SheetReveal
        isOpen={isSwapOpen && swapSelectSide !== null}
        onClose={() => setSwapSelectSide(null)}
        scrimClassName="fixed inset-0 z-50 flex bg-black/20 p-2 backdrop-blur-[4px] max-[795px]:bg-white/60 max-[795px]:p-0 max-[795px]:pt-8 min-[1204px]:hidden"
        sheetClassName="ml-auto flex h-full w-[392px] min-w-0 max-w-full flex-col overflow-clip rounded-3xl bg-white max-[795px]:w-full max-[795px]:rounded-b-none max-[795px]:shadow-[0px_-10px_40px_-10px_rgba(0,0,0,0.2)]"
      >
        <PaneReveal key={overlaySelectSide}>
          <SwapTokenSelectPane
            nameByMint={tokenNameByMint}
            onClose={() => setSwapSelectSide(null)}
            onSearch={overlaySelectSide === "to" ? searchTokens : undefined}
            onSelect={(token) =>
              handleSwapTokenSelect(overlaySelectSide, token)
            }
            side={overlaySelectSide}
            tokens={
              overlaySelectSide === "from" ? derivedTokens : swapTargetTokens
            }
          />
        </PaneReveal>
      </SheetReveal>
      {/* Shield's <1204 selector: same geometry, opened from the source
          asset cell (the aside is hidden below 1204). */}
      <SheetReveal
        isOpen={isShieldOpen && isShieldSelectOpen}
        onClose={() => setIsShieldSelectOpen(false)}
        scrimClassName="fixed inset-0 z-50 flex bg-black/20 p-2 backdrop-blur-[4px] max-[795px]:bg-white/60 max-[795px]:p-0 max-[795px]:pt-8 min-[1204px]:hidden"
        sheetClassName="ml-auto flex h-full w-[392px] min-w-0 max-w-full flex-col overflow-clip rounded-3xl bg-white max-[795px]:w-full max-[795px]:rounded-b-none max-[795px]:shadow-[0px_-10px_40px_-10px_rgba(0,0,0,0.2)]"
      >
        <ShieldAssetPane
          nameByMint={tokenNameByMint}
          onClose={() => setIsShieldSelectOpen(false)}
          onSelect={(token) => {
            setShieldToken(token);
            setIsShieldSelectOpen(false);
          }}
          selectedToken={shieldToken}
          tokens={shieldSourceTokens}
        />
      </SheetReveal>
      <ShieldInfoOverlay
        isOpen={isShieldInfoOpen}
        onClose={() => setIsShieldInfoOpen(false)}
      />
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
