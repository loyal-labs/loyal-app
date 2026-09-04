"use client";

import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import { resolveSolanaEnv } from "@loyal-labs/solana-rpc";
import type { PortfolioPosition } from "@loyal-labs/solana-wallet";
import { useUnshield } from "@loyal-labs/wallet-core/hooks";
import type { WalletSigner } from "@loyal-labs/wallet-core/types";
import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import { isEscapeGuardedTarget } from "@/components/wallet-workspace/facelift/keyboard";
import {
  MiddlePaneSlide,
  PaneReveal,
} from "@/components/wallet-workspace/facelift/pane-transitions";
import {
  SendPane,
  SendRecipientPane,
  useSendRecentRecipients,
} from "@/components/wallet-workspace/facelift/send-pane";
import {
  InlineSheetReveal,
  SheetReveal,
} from "@/components/wallet-workspace/facelift/sheet-reveal";
import {
  SwapPane,
  SwapTokenSelectPane,
} from "@/components/wallet-workspace/facelift/swap-pane";
import { TokenDetailPane } from "@/components/wallet-workspace/facelift/token-detail-pane";
import { UnshieldPane } from "@/components/wallet-workspace/facelift/unshield-pane";
import { useAuthCapability } from "@/lib/auth/capability";
import { usePublicEnv } from "@/contexts/public-env-context";
import { usePopularTokens } from "@/hooks/use-popular-tokens";
import {
  splitUsdBalance,
  useWalletDesktopData,
} from "@/hooks/use-wallet-desktop-data";
import { getTokenIconUrl } from "@/lib/token-icon";
import {
  getStablecoinMintSetForSolanaEnv,
  isStablecoinMint,
} from "@/lib/wallet/stablecoin-classification";
import { getEarnProductAssetsForCluster } from "@/lib/yield-optimization/earn-product-mints.shared";

type ActionView = Exclude<SubView, null>;

function viewType(view: SubView) {
  return typeof view === "object" && view !== null ? view.type : view;
}

function tokenRowToSwapToken(token: TokenRow): SwapToken {
  return {
    balance: Number.parseFloat(token.amount.replace(/,/g, "")) || 0,
    icon: token.icon,
    mint: token.id,
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

// Crypto screen (Figma 4813:338843) and, via page="stables", the Stablecoins
// one (4813:339437): the root token list plus the action flows — the
// redesigned Send and Swap screens — mounted as the page-slide action
// screen. All handler logic is ported from the workspace monolith's
// personal-wallet slice; the stables Earn buttons jump to the Earn page's
// deposit screen.
export function CryptoPage({
  navigationNonce,
  onBack,
  onEarn,
  page,
}: {
  /** Bumped by the shell on every sidebar selection — abandons open actions. */
  navigationNonce: number;
  onBack: () => void;
  /** Row-level Earn passes the clicked coin's mint; the header button none. */
  onEarn: (sourceMint?: string | null) => void;
  page: CryptoPaneVariant;
}) {
  const publicEnv = usePublicEnv();
  const { isHydrated, isSignedIn } = useAuthCapability();

  const data = useWalletDesktopData({});

  // --- legacy shielded-balance exit (ASK-2269) ---
  // Only wallets still holding deposits in the sunset private-transfer
  // program see the Unshield entry; reading balances needs no signature.
  const wallet = useWallet();
  const unshieldSigner = useMemo<WalletSigner | null>(
    () =>
      wallet.publicKey && wallet.signTransaction && wallet.signAllTransactions
        ? {
            publicKey: wallet.publicKey,
            signTransaction: wallet.signTransaction,
            signAllTransactions: wallet.signAllTransactions,
            signMessage: wallet.signMessage,
          }
        : null,
    [
      wallet.publicKey,
      wallet.signAllTransactions,
      wallet.signMessage,
      wallet.signTransaction,
    ]
  );
  const { balances: shieldedBalances, executeUnshield } = useUnshield(
    unshieldSigner,
    publicEnv.solanaEnv
  );
  const [isUnshieldOpen, setIsUnshieldOpen] = useState(false);

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
  const [shouldLoadPopularTokens, setShouldLoadPopularTokens] = useState(false);
  const { tokens: popularTokens, search: searchTokens } = usePopularTokens({
    enabled: shouldLoadPopularTokens,
  });

  // --- redesigned Send screen (Figma 4852:38932) ---
  const [sendRecipient, setSendRecipient] = useState<string | null>(null);
  // Which selector occupies Send's right pane; null = the empty reserved slot.
  const [sendSelect, setSendSelect] = useState<"asset" | "recipient" | null>(
    null
  );
  // Keeps the selector content rendered through the pane's close slide.
  const sendSelectRef = useRef<"asset" | "recipient">("recipient");
  if (sendSelect) {
    sendSelectRef.current = sendSelect;
  }
  const overlaySendSelect = sendSelect ?? sendSelectRef.current;
  // Mirrors SendPane's step: selectors hide once a submit starts.
  const [isSendFormActive, setIsSendFormActive] = useState(true);
  const handleSendFormActiveChange = useCallback((isFormActive: boolean) => {
    setIsSendFormActive(isFormActive);
    if (!isFormActive) {
      setSendSelect(null);
    }
  }, []);
  const { recents: sendRecents, recordSend: recordSendRecent } =
    useSendRecentRecipients(data.walletAddress);

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

  // --- token detail right pane (Figma 4826:439625) ---
  // Row click selects (and opens the <1204 sheet); a page switch resets to
  // that page's default token.
  const [detailToken, setDetailToken] = useState<SwapToken | null>(null);
  const [isDetailSheetOpen, setIsDetailSheetOpen] = useState(false);
  useEffect(() => {
    setDetailToken(null);
    setIsDetailSheetOpen(false);
  }, [page]);

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
  // Stables the Earn product currently accepts — badged "Can earn" in the
  // receive selector and ranked right after LOYAL.
  const earnProductAssets = useMemo(
    () =>
      getEarnProductAssetsForCluster(
        resolveLoyalClusterForSolanaEnv(resolveSolanaEnv(publicEnv.solanaEnv))
      ).map((asset) => ({
        mint: asset.mint.toBase58(),
        symbol: asset.symbol,
      })),
    [publicEnv.solanaEnv]
  );
  const earnEligibleMints = useMemo(
    () => new Set(earnProductAssets.map((asset) => asset.mint)),
    [earnProductAssets]
  );
  // Receive-side picker list: held tokens plus Earn stables nothing else lists.
  // Trending tokens are no longer inlined here — the selector renders them as
  // its own "Trending" section and would otherwise list them twice. They still
  // count as listed, so a trending Earn stable is not synthesized below.
  const swapTargetTokens = useMemo<SwapToken[]>(() => {
    const heldMints = new Set(
      derivedTokens.map((token) => token.mint).filter(Boolean)
    );
    // Earn stables missing from held+trending (e.g. CASH) still belong in
    // the receive list: synthesize them from the canonical product assets.
    // The picker price is indicative only (quotes come by mint), so a flat
    // $1 for a USD stable is fine.
    const listedMints = new Set([
      ...heldMints,
      ...popularTokens.map((token) => token.mint),
    ]);
    const missingEarnStables = earnProductAssets
      .filter((asset) => !listedMints.has(asset.mint))
      .map((asset) => ({
        balance: 0,
        icon: getTokenIconUrl(asset.symbol),
        mint: asset.mint,
        price: 1,
        symbol: asset.symbol,
      }));
    // LOYAL first, then the Earn-eligible stables, then everything else —
    // held-first order is preserved within each group (stable sort).
    const rank = (token: SwapToken) =>
      token.mint === LOYL_TOKEN.mint
        ? 0
        : token.mint && earnEligibleMints.has(token.mint)
        ? 1
        : 2;

    return [...derivedTokens, ...missingEarnStables].sort(
      (a, b) => rank(a) - rank(b)
    );
  }, [derivedTokens, earnEligibleMints, earnProductAssets, popularTokens]);

  // Seed the flow tokens once the wallet's real tokens land.
  const prevHadTokensRef = useRef(false);
  useEffect(() => {
    const firstToken = derivedTokens[0];
    const hasTokens = derivedTokens.length > 0 && !!firstToken?.mint;

    if (hasTokens && !prevHadTokensRef.current && firstToken) {
      setSendToken(firstToken);
      setSwapFromToken(firstToken);
      setSwapToToken(
        derivedTokens.find((token) => token.mint === LOYL_TOKEN.mint) ??
          LOYL_TOKEN
      );
    }

    prevHadTokensRef.current = hasTokens;
  }, [derivedTokens]);

  const closeAction = useCallback(() => {
    setViewStack([]);
  }, []);

  const openAction = useCallback((view: ActionView) => {
    setViewStack([view]);
  }, []);

  // Every Send entry lands on a fresh form: no carried-over recipient, the
  // right pane back to its empty reserved slot.
  const openSend = useCallback(
    (token?: SwapToken) => {
      if (token) {
        setSendToken(token);
      }
      setSendRecipient(null);
      setSendSelect(null);
      setIsSendFormActive(true);
      setIsUnshieldOpen(false);
      openAction({ type: "sendPanel" });
    },
    [openAction]
  );

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
    setIsUnshieldOpen(false);
    setIsSwapOpen(true);
  }, []);

  const closeSwap = useCallback(() => {
    setIsSwapOpen(false);
    setSwapSelectSide(null);
  }, []);

  const openUnshield = useCallback(() => {
    setViewStack([]);
    closeSwap();
    setIsUnshieldOpen(true);
  }, [closeSwap]);
  const closeUnshield = useCallback(() => setIsUnshieldOpen(false), []);

  // Sidebar navigation abandons any in-progress action screen — the same rule
  // the shell applies to Earn's deposit/withdraw/autodeposit views.
  useEffect(() => {
    setViewStack([]);
    setSendSelect(null);
    closeSwap();
    closeUnshield();
  }, [closeSwap, closeUnshield, navigationNonce]);

  // Esc backs out of the open Send/Swap flow (the shell owns Esc for
  // Earn's action screens). An open selector pane closes first; the next
  // press leaves the flow. Skipped while an input is focused.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        // Numbers-only amount fields don't swallow Esc — only free text does.
        isEscapeGuardedTarget(event.target) ||
        (viewStack.length === 0 && !isSwapOpen && !isUnshieldOpen)
      ) {
        return;
      }
      // Overlays (info sheets) preventDefault their own Esc; checked after
      // dispatch so listener registration order can't matter.
      queueMicrotask(() => {
        if (event.defaultPrevented) {
          return;
        }
        if (sendSelect !== null) {
          setSendSelect(null);
          return;
        }
        if (swapSelectSide !== null) {
          setSwapSelectSide(null);
          return;
        }
        setViewStack([]);
        closeSwap();
        closeUnshield();
      });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

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

  // Wrapped so flow callbacks' own arguments never leak into refresh's
  // isCurrent parameter.
  const refreshWalletData = data.refresh;
  const refreshWallet = useCallback(
    () => refreshWalletData(),
    [refreshWalletData]
  );

  // Detail pane inputs: the wallet position (when held) supplies the
  // balance and the app-pipeline price the list rows use.
  const pageTokenRows =
    page === "stables" ? data.cashTokenRows : data.investmentTokenRows;
  const firstPageRow = pageTokenRows[0];
  // LOYAL anchors the crypto default, USDC the stables one; the page's first
  // row covers wallets whose derived list is missing those entries.
  const detailDefault =
    (page === "stables"
      ? derivedTokens.find((token) => token.symbol === "USDC")
      : derivedTokens.find((token) => token.mint === LOYL_TOKEN.mint)) ??
    (firstPageRow ? tokenRowToSwapToken(firstPageRow) : null);
  const detailBase = detailToken ?? detailDefault;
  const detailMint = detailBase?.mint ?? null;
  const detailPosition = detailMint
    ? data.positions.find((position) => position.asset.mint === detailMint) ??
      null
    : null;
  const detailPublicBalance =
    detailPosition?.publicBalance ?? detailBase?.balance ?? 0;
  const detailPrice = detailPosition?.priceUsd ?? detailBase?.price ?? 0;
  // Shared by the desktop aside and the <1204 sheet; actions leave the
  // detail context, so they always drop the sheet first.
  const openDetailSwap = () => {
    if (!detailBase) {
      return;
    }
    setIsDetailSheetOpen(false);
    openSwap({ ...detailBase, balance: detailPublicBalance });
  };
  const openDetailSend = () => {
    if (!detailBase) {
      return;
    }
    setIsDetailSheetOpen(false);
    openSend({
      ...detailBase,
      balance: detailPublicBalance,
    });
  };

  // Row actions also select the token (without opening the <1204 detail
  // sheet) so the desktop aside shows its detail once the action closes.
  const selectRowDetail = (row: TokenRow) =>
    setDetailToken(tokenRowToSwapToken(row));

  const rowActions: CryptoRowActions = {
    // Row-level Earn lands on the deposit screen with the clicked coin
    // preselected as the source; the header button keeps the default.
    onEarn: (row) => {
      selectRowDetail(row);
      onEarn(row.id);
    },
    onSelect: (row) => {
      setDetailToken(tokenRowToSwapToken(row));
      setIsDetailSheetOpen(true);
    },
    onSend: (row) => {
      selectRowDetail(row);
      openSend(tokenRowToSwapToken(row));
    },
    onSwap: (row) => {
      selectRowDetail(row);
      const base =
        derivedTokens.find((token) => token.mint === row.id) ??
        tokenRowToSwapToken(row);
      openSwap(base);
    },
  };

  const actionView = viewStack[viewStack.length - 1] ?? null;
  const actionType = actionView === null ? null : viewType(actionView);
  const isSendOpen = actionType === "sendPanel";

  // Shared by the desktop aside and the <1204 sheet — one selector, two
  // geometries (same split as swap's token selector).
  const renderSendSelectPane = () =>
    overlaySendSelect === "asset" ? (
      <SwapTokenSelectPane
        nameByMint={tokenNameByMint}
        onClose={() => setSendSelect(null)}
        onSelect={(token) => {
          setSendToken(token);
          setSendSelect(null);
        }}
        side="from"
        title="Select asset"
        tokens={derivedTokens}
      />
    ) : (
      <SendRecipientPane
        onClose={() => setSendSelect(null)}
        onSelect={(address) => {
          setSendRecipient(address);
          setSendSelect(null);
        }}
        recents={sendRecents}
      />
    );

  return (
    <>
      <div className="flex h-full min-h-0 min-w-0 flex-1 gap-2 p-2 max-[795px]:gap-0 max-[795px]:p-0">
        <MiddlePaneSlide
          actionPane={
            isSendOpen ? (
              <SendPane
                onBack={closeAction}
                onDone={closeAction}
                onFormActiveChange={handleSendFormActiveChange}
                onOpenAssetSelect={() =>
                  setSendSelect((current) =>
                    current === "asset" ? null : "asset"
                  )
                }
                onOpenRecipientSelect={() =>
                  setSendSelect((current) =>
                    current === "recipient" ? null : "recipient"
                  )
                }
                onSuccess={refreshWallet}
                recipient={sendRecipient}
                recordRecent={recordSendRecent}
                token={sendToken}
              />
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
            ) : isUnshieldOpen ? (
              <UnshieldPane
                balances={shieldedBalances}
                executeUnshield={executeUnshield}
                onBack={closeUnshield}
                onDone={closeUnshield}
                onSuccess={refreshWallet}
                positions={data.positions}
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
              onEarn={() => onEarn()}
              onSend={() => openSend()}
              onSwap={() => openSwap()}
              onUnshield={
                shieldedBalances.length > 0 ? openUnshield : undefined
              }
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
        {isSendOpen ? (
          // Send's right pane (Figma 4852:39600 / 4852:39997): the reserved
          // 400px slot hosts either the asset selector or the recipient
          // pane; both slide out while a submit runs and on result screens.
          <div className="hidden h-full w-[400px] shrink-0 min-[1204px]:block">
            <InlineSheetReveal
              className="flex h-full w-full min-w-0 flex-col overflow-clip rounded-3xl bg-card"
              isOpen={sendSelect !== null && isSendFormActive}
            >
              <PaneReveal key={overlaySendSelect}>
                {renderSendSelectPane()}
              </PaneReveal>
            </InlineSheetReveal>
          </div>
        ) : actionView !== null ? null : isUnshieldOpen ? (
          <aside className="hidden h-full w-[400px] shrink-0 rounded-3xl bg-card min-[1204px]:block" />
        ) : isSwapOpen ? (
          // Swap's right pane: a reserved 400px slot (Figma 4813:403499
          // keeps it empty) the selector panel-reveals into and out of;
          // switching sides replays the content reveal on the open panel.
          <div className="hidden h-full w-[400px] shrink-0 min-[1204px]:block">
            <InlineSheetReveal
              className="flex h-full w-full min-w-0 flex-col overflow-clip rounded-3xl bg-card"
              isOpen={swapSelectSide !== null}
            >
              <PaneReveal key={overlaySelectSide}>
                <SwapTokenSelectPane
                  earnEligibleMints={earnEligibleMints}
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
        ) : detailBase && detailMint ? (
          // Token detail pane (Figma 4826:439625); re-keyed per mint so
          // switching tokens replays the panel reveal.
          <aside className="hidden h-full w-[400px] shrink-0 min-[1204px]:block">
            <PaneReveal key={detailMint}>
              <div className="flex h-full w-full min-w-0 flex-col overflow-clip rounded-3xl bg-card">
                <TokenDetailPane
                  hideChart={page === "stables"}
                  icon={detailBase.icon}
                  mint={detailMint}
                  name={detailPosition?.asset.name ?? detailBase.symbol}
                  onSend={openDetailSend}
                  onSwap={openDetailSwap}
                  price={detailPrice}
                  publicBalance={detailPublicBalance}
                  symbol={detailBase.symbol}
                />
              </div>
            </PaneReveal>
          </aside>
        ) : (
          <aside className="hidden h-full w-[400px] shrink-0 rounded-3xl bg-card min-[1204px]:block" />
        )}
      </div>
      {/* Below 1204px the selector opens as the right-pinned card over the
          dark scrim (Figma 4819:413827) — the chart-enlarge geometry; on
          desktop the scrim is display:none while the aside shows it. */}
      <SheetReveal
        isOpen={isSwapOpen && swapSelectSide !== null}
        onClose={() => setSwapSelectSide(null)}
        scrimClassName="fixed inset-0 z-50 flex bg-black/20 p-2 backdrop-blur-[4px] max-[795px]:bg-white/60 max-[795px]:p-0 max-[795px]:pt-8 min-[1204px]:hidden"
        sheetClassName="ml-auto flex h-full w-[392px] min-w-0 max-w-full flex-col overflow-clip rounded-3xl bg-card max-[795px]:w-full max-[795px]:rounded-b-none max-[795px]:shadow-[0px_-10px_40px_-10px_rgba(0,0,0,0.2)]"
      >
        <PaneReveal key={overlaySelectSide}>
          <SwapTokenSelectPane
            earnEligibleMints={earnEligibleMints}
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
      {/* Send's <1204 selector/recipient pane: same geometry as swap's. */}
      <SheetReveal
        isOpen={isSendOpen && sendSelect !== null && isSendFormActive}
        onClose={() => setSendSelect(null)}
        scrimClassName="fixed inset-0 z-50 flex bg-black/20 p-2 backdrop-blur-[4px] max-[795px]:bg-white/60 max-[795px]:p-0 max-[795px]:pt-8 min-[1204px]:hidden"
        sheetClassName="ml-auto flex h-full w-[392px] min-w-0 max-w-full flex-col overflow-clip rounded-3xl bg-card max-[795px]:w-full max-[795px]:rounded-b-none max-[795px]:shadow-[0px_-10px_40px_-10px_rgba(0,0,0,0.2)]"
      >
        <PaneReveal key={overlaySendSelect}>
          {renderSendSelectPane()}
        </PaneReveal>
      </SheetReveal>
      {/* Token detail sheet (Figma 4826:440136) — row taps below 1204px open
          the pane in the token-selector sheet geometry; the desktop aside
          covers ≥1204 so the scrim hides there. */}
      {detailBase && detailMint ? (
        <SheetReveal
          isOpen={isDetailSheetOpen}
          onClose={() => setIsDetailSheetOpen(false)}
          scrimClassName="fixed inset-0 z-50 flex bg-black/20 p-2 backdrop-blur-[4px] max-[795px]:bg-white/60 max-[795px]:p-0 max-[795px]:pt-8 min-[1204px]:hidden"
          sheetClassName="ml-auto flex h-full w-[392px] min-w-0 max-w-full flex-col overflow-clip rounded-3xl bg-card max-[795px]:w-full max-[795px]:rounded-b-none max-[795px]:shadow-[0px_-10px_40px_-10px_rgba(0,0,0,0.2)]"
        >
          <TokenDetailPane
            hideChart={page === "stables"}
            icon={detailBase.icon}
            mint={detailMint}
            name={detailPosition?.asset.name ?? detailBase.symbol}
            onClose={() => setIsDetailSheetOpen(false)}
            onSend={openDetailSend}
            onSwap={openDetailSwap}
            price={detailPrice}
            publicBalance={detailPublicBalance}
            symbol={detailBase.symbol}
          />
        </SheetReveal>
      ) : null}
    </>
  );
}
