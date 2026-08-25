import * as Haptics from "expo-haptics";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ArrowUp, Plus, SlidersHorizontal } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AutodepositHelpSheet } from "@/components/earn/AutodepositHelpSheet";
import { AutodepositInfoSheet } from "@/components/earn/AutodepositInfoSheet";
import {
  AutodepositSetupSheet,
  computeAutodepositSetupSolShortfall,
} from "@/components/earn/AutodepositSetupSheet";
import {
  computeFirstDepositSolShortfall,
  DepositSheet,
} from "@/components/earn/DepositSheet";
import { EarnChartTabs } from "@/components/earn/EarnChartTabs";
import { EarnDog } from "@/components/earn/EarnDog";
import { getLoyalApyBps } from "@/components/earn/earnForecastModel";
import { PositionsSheet } from "@/components/earn/PositionsSheet";
import { WithdrawSheet } from "@/components/earn/WithdrawSheet";
import { nudgeQuestProgressCheck } from "@/components/quests/QuestCompletionWatcher";
import { Skeleton } from "@/components/Skeleton";
import { useActivity } from "@/features/activity/model/ActivityProvider";
import { refreshEarnEarningsCache } from "@/hooks/wallet/useEarnEarnings";
import { useEarnPosition } from "@/hooks/wallet/useEarnPosition";
import { useTokenHoldings } from "@/hooks/wallet/useTokenHoldings";
import { useAppReady } from "@/lib/app-ready";
import {
  NATIVE_SOL_MINT,
  SOLANA_USDC_MINT_DEVNET,
  SOLANA_USDC_MINT_MAINNET,
} from "@/lib/solana/constants";
import {
  executeEarnAutodepositClose,
  executeEarnAutodepositSetup,
  updateEarnAutodepositThreshold,
} from "@/lib/solana/earn/autodeposit";
import {
  toWithdrawPrepareSource,
  type EarnHoldingItem,
  type EarnWithdrawSourceInfo,
} from "@/lib/solana/earn/earn-api";
import { getVisibleEarnScheduledSweeps } from "@/lib/solana/earn/earn-scheduled-sweep";
import { env } from "@/config/env";
import { executeEarnDeposit } from "@/lib/solana/earn/deposit";
import { getEarnProductAssets } from "@/lib/solana/earn/earn-product-mints";
import { executeEarnWithdraw } from "@/lib/solana/earn/withdraw";
import { useEarnAutodeposit } from "@/hooks/wallet/useEarnAutodeposit";
import { useEarnAutodepositToggle } from "@/hooks/wallet/useEarnAutodepositToggle";
import { useEarnForecast } from "@/hooks/wallet/useEarnForecast";
import { useEarnWithdrawSources } from "@/hooks/wallet/useEarnWithdrawSources";
import {
  useWalletAutoRefresh,
  type WalletRefreshReason,
} from "@/hooks/wallet/useWalletAutoRefresh";
import { isWalletUnlocked, useWallet } from "@/lib/wallet/wallet-provider";
import {
  captureMobileAppLoadMetricAfterPaint,
  startMobileLoadingMetric,
} from "@/services/loading-metrics";
import { Pressable, Text, View } from "@/tw";

import AutodepositIcon from "../../assets/images/earn/autodeposit.svg";
import EarnFlash from "../../assets/images/earn/flash.svg";
import EarnQuestionmark from "../../assets/images/earn/questionmark.svg";

// Starter-hero principal ("Turn $6,000 into $X"). The guard rate only fires if
// the forecast API returns a non-positive APY (getLoyalApyBps already falls
// back to its marketing rate while loading).
const HERO_PRINCIPAL_USD = 6_000;
const FALLBACK_APY_PCT = 8.46;

// Earn is a money-sensitive view and the user expects the balance to track the
// chain promptly, so poll faster than the wallet's 60s safety-net interval.
const EARN_REFRESH_INTERVAL_MS = 15_000;

const COLOR_BADGE_GREEN = "#32B67C";
const COLOR_AUTODEPOSIT_RED = "#F9363C";
const COLOR_LABEL_DIM = "rgba(60, 60, 67, 0.6)";
const COLOR_BALANCE_DIM = "rgba(60, 60, 67, 0.4)";
const COLOR_WITHDRAW_BG = "#F5F5F5";
const COLOR_HEADLINE_DIM = "rgba(255, 255, 255, 0.6)";

const TAB_BAR_RESERVED_HEIGHT = 96;

// The dog is authored at 400×506 (full head). It sits full-bleed at the bottom
// of the black hero; its lower jaw (below head-y 410) is clipped by the white
// balance card that meets it. DOG_CLIP is that 96px (506−410) overflow as a
// ratio of width so the clip scales with the screen (Figma 3883:18252).
const DOG_NATURAL_RATIO = 506 / 400;
const DOG_CLIP_RATIO = 96 / 400;
// Sunk start state: the dog drops until only its ears (head above ~y150) peek
// over the card; the reveal rises it back to rest.
const DOG_EARS_HEAD_Y = 150;
const DOG_SINK_RATIO = (410 - DOG_EARS_HEAD_Y) / 400;

const ENTER_EASING = Easing.bezier(0.22, 1, 0.36, 1);
// Overshoot for the APY badge pop (animate-text `spring-scale-in`).
const BADGE_EASING = Easing.bezier(0.34, 1.56, 0.64, 1);

// Reveal choreography: hold on just the ears for a beat, then the dog rises
// while the three headline lines stagger in (animate-text `mask-reveal-up`),
// then the APY badge pops last.
const REVEAL_START_DELAY_MS = 700;
const DOG_RISE_MS = 800;
const LINE_FROM_Y = 24;
const LINE_REVEAL_MS = 850;
const LINE_STAGGER_MS = 650;
const LINES_START_MS = 200;
const BADGE_START_MS = 2050;
const BADGE_MS = 500;

// Cross-fade between the promo hero (shown to everyone while the balance loads)
// and the funded Earn layout, so the swap when the balance arrives reads as a
// dissolve rather than a hard cut. Also drives the bottom card's corner radius.
const STATE_FADE_MS = 480;
const FUNDED_CARD_RADIUS = 26;

// Maps a live on-chain holding to the source shape the positions sheet renders
// (display-only: it reads market/liquidityMint/amountRaw and `id` as the row
// key). The withdraw flow continues to use the real `withdrawSources`.
function earnHoldingToDisplaySource(
  holding: EarnHoldingItem,
): EarnWithdrawSourceInfo {
  return {
    type: holding.kind === "idle" ? "idle" : "reserve",
    id: holding.reserve ?? holding.market ?? holding.liquidityMint,
    label: holding.label,
    amountRaw: holding.amountRaw,
    liquidityMint: holding.liquidityMint,
    market: holding.market,
    reserve: holding.reserve,
    tokenAccount: null,
  };
}

export default function EarnScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const appReady = useAppReady();
  const { publicKey, signer, state } = useWallet();
  // Read-only holdings (no signer) so the Deposit sheet can show the wallet's
  // real USDC balance. Passing a signer here would trigger a Seed Vault
  // hardware prompt on Seeker — balance display must stay passive.
  const walletAddress = isWalletUnlocked(state) ? publicKey : null;
  const {
    tokenHoldings,
    hasLoaded: tokenHoldingsLoaded,
    refreshTokenHoldings,
  } = useTokenHoldings(walletAddress);
  const usdcAvailable = useMemo(() => {
    const holding = tokenHoldings.find(
      (h) =>
        h.mint === SOLANA_USDC_MINT_MAINNET ||
        h.mint === SOLANA_USDC_MINT_DEVNET,
    );
    return holding && Number.isFinite(holding.balance) ? holding.balance : null;
  }, [tokenHoldings]);
  // Per-mint spendable balances for the deposit coin selector (token units ≈
  // dollars — every Earn product stablecoin is 6-decimal).
  const stableBalancesByMint = useMemo(() => {
    const balances: Record<string, number> = {};
    for (const asset of getEarnProductAssets(env.solanaEnv)) {
      const holding = tokenHoldings.find((h) => h.mint === asset.mint);
      if (holding && Number.isFinite(holding.balance)) {
        balances[asset.mint] = holding.balance;
      }
    }
    return balances;
  }, [tokenHoldings]);
  // Real on-chain Earn position (read-only, no signing). Drives the funded
  // state + balance once it loads; the optimistic just-deposited value below
  // bridges the gap until the read-model catches up.
  const {
    position,
    holdings,
    policyMissing: earnPolicyMissing,
    hasLoaded: earnPositionLoaded,
    refreshEarnPosition,
    markEarnMutation,
  } = useEarnPosition(walletAddress);
  // Skeleton the number only until the FIRST read settles. The post-mutation
  // reconciliation lives in useEarnPosition (it trusts the freshly-written
  // read-model right after a deposit/withdraw), so the headline is already
  // correct on the next read — no settling skeleton needed. Routine background
  // refreshes (focus/interval/push) keep the last value on screen and update it
  // in place. Only while a wallet is connected — a locked wallet has no balance.
  const balanceLoading = walletAddress != null && !earnPositionLoaded;
  // Global "loyal" APY forecast — the same source the APY chart (and the web)
  // show as the headline rate, so the badge below matches them instead of the
  // position's raw reserve supply APY.
  const forecastSummary = useEarnForecast();
  // Withdrawal sources (reserves + idle vault USDC) — fetched lazily when the
  // user opens withdraw; drives the source picker.
  const { sources: withdrawSources, refreshSources: refreshWithdrawSources } =
    useEarnWithdrawSources(walletAddress);
  // Per-position breakdown for the positions sheet, derived from the live
  // on-chain holdings (the same read that drives the headline) so it matches the
  // web instead of the stale DB withdraw-sources read. Display-only — the
  // withdraw picker still uses `withdrawSources`. Sub-cent dust is dropped so a
  // negligible idle balance doesn't render as a "$0.00" row.
  const livePositions = useMemo<EarnWithdrawSourceInfo[]>(
    () =>
      holdings
        .filter((holding) => Number(holding.amountRaw) >= 5000)
        .map((holding) => earnHoldingToDisplaySource(holding)),
    [holdings],
  );
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [positionsOpen, setPositionsOpen] = useState(false);
  const [hasDeposit, setHasDeposit] = useState(false);
  // Real on-chain Autodeposit state (read-only, wallet-keyed). The threshold +
  // on/off are derived from it; the create/edit/delete/toggle handlers below
  // drive the on-chain policy and refresh this.
  const {
    autodeposit,
    confirmAutodepositClose,
    confirmAutodepositSetup,
    hasLoaded: autodepositLoaded,
    refreshAutodeposit,
  } = useEarnAutodeposit(walletAddress);
  const {
    active: autodepositEnabled,
    requestToggle: requestAutodepositToggle,
  } = useEarnAutodepositToggle({
    autodeposit,
    signer,
    walletUnlocked: isWalletUnlocked(state),
    refreshAutodeposit,
  });
  const autodepositThresholdUsd = useMemo(() => {
    if (!autodeposit) {
      return null;
    }
    const raw = Number(autodeposit.walletBalanceFloorRaw ?? "0");
    return Number.isFinite(raw) ? raw / 1e6 : 0;
  }, [autodeposit]);
  const [autodepositHelpOpen, setAutodepositHelpOpen] = useState(false);
  const [autodepositSetupOpen, setAutodepositSetupOpen] = useState(false);
  const [autodepositSetupMode, setAutodepositSetupMode] = useState<
    "create" | "edit"
  >("create");
  // "How Autodeposit works" pre-flight interstitial: every path into the
  // setup sheet (create or edit — delete lives inside the edit sheet) opens
  // this first; its Continue proceeds to the setup sheet in the mode captured
  // at initiation.
  const [autodepositInfoOpen, setAutodepositInfoOpen] = useState(false);
  const autodepositInfoModeRef = useRef<"create" | "edit">("create");
  // Principal just deposited, used as the funded Earn Balance until the real
  // on-chain position is wired (see .context/earn-deposit-findings.md, step b).
  const [depositedUsd, setDepositedUsd] = useState<number | null>(null);
  // First-deposit SOL gate: opening a position costs SOL (rent/fees), so with
  // no existing position the wallet must hold FIRST_DEPOSIT_MIN_SOL. SOL
  // balance comes from the same holdings read as the USDC balance; the missing
  // SOL row means holdings haven't loaded, and the gate fails open until they
  // do.
  const firstDepositSolShortfall = useMemo(() => {
    // A balance alone doesn't prove the cheap top-up path applies: a healed
    // position can outlive its route-policy pair (post-full-exit orphans), and
    // a missing pair sends even a top-up down first-time setup with its SOL
    // cost — so gate on the policy read, not just the balance.
    if (!earnPositionLoaded || (hasDeposit && !earnPolicyMissing)) return null;
    const sol = tokenHoldings.find(
      (h) => h.mint === NATIVE_SOL_MINT && !h.isSecured,
    );
    if (!sol) return null;
    return computeFirstDepositSolShortfall(sol.balance);
  }, [earnPositionLoaded, hasDeposit, earnPolicyMissing, tokenHoldings]);
  // Creating an Autodeposit also costs SOL (policy + delegation account rent) —
  // same fail-open gate. The sheet only applies it in "create" mode.
  const autodepositSolShortfall = useMemo(() => {
    const sol = tokenHoldings.find(
      (h) => h.mint === NATIVE_SOL_MINT && !h.isSecured,
    );
    if (!sol) return null;
    return computeAutodepositSetupSolShortfall(sol.balance);
  }, [tokenHoldings]);
  const [isFocused, setIsFocused] = useState(false);
  // Bumped to (re)play the reveal each time the tab becomes visible.
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    if (
      appReady &&
      walletAddress &&
      earnPositionLoaded &&
      tokenHoldingsLoaded &&
      autodepositLoaded
    ) {
      captureMobileAppLoadMetricAfterPaint();
    }
  }, [
    appReady,
    walletAddress,
    earnPositionLoaded,
    tokenHoldingsLoaded,
    autodepositLoaded,
  ]);

  // Quests deep-links here to open a sheet (?open=deposit | autodeposit).
  const router = useRouter();

  // Refundable closed Earn accounts (empty when nothing is refundable).
  // A non-empty scan surfaces a "Refund SOL" button beside Deposit on the
  // empty hero only, routing to the Earn activity feed where the refund rows
  // live. Funded state shows nothing — the rent comes back when the position
  // closes, so there's nothing actionable while a deposit is live.
  // `refreshAutodeposit` is renamed: the Activity feed keeps its own
  // Autodeposit read (it drives the "Scheduled" row), separate from this
  // screen's `useEarnAutodeposit` instance below.
  const {
    earnRefunds,
    expectScheduledSweep,
    refreshAutodeposit: refreshActivityAutodeposit,
  } = useActivity();
  const handleOpenRefunds = useCallback(() => {
    router.navigate({
      pathname: "/(tabs)/activity",
      params: { section: "earn" },
    });
  }, [router]);
  // Single entry point for CREATE mode. Autodeposit sweeps can only route into
  // an ACTIVE Earn position — the routing policy is created by a user-signed
  // deposit, and the sweep worker (delegate) can't make one. Creating an
  // Autodeposit on an empty Earn strands every sweep as a perpetual
  // "Executing…" row (launch-week quest-hunter trap), so an empty position
  // routes through Deposit instead. Fails open while the position is still
  // loading — the backend prepare rejects the truly-empty case as a backstop.
  const openAutodepositCreate = useCallback(() => {
    if (earnPositionLoaded && !hasDeposit) {
      Alert.alert(
        "Deposit first",
        "Autodeposit needs an active Earn account to deposit into. Make a deposit first — anything above your threshold then moves to Earn automatically.",
        [
          { text: "Not now", style: "cancel" },
          { text: "Deposit", onPress: () => setDepositOpen(true) },
        ],
      );
      return;
    }
    // Pull the live wallet USDC + Earn position so both flow balances are
    // current by the time the user continues past the info sheet.
    refreshTokenHoldings(true);
    refreshEarnPosition();
    autodepositInfoModeRef.current = "create";
    setAutodepositInfoOpen(true);
  }, [
    earnPositionLoaded,
    hasDeposit,
    refreshTokenHoldings,
    refreshEarnPosition,
  ]);

  // Info accepted — open the setup sheet in the mode captured at initiation.
  const handleAutodepositInfoContinue = useCallback(() => {
    setAutodepositSetupMode(autodepositInfoModeRef.current);
    setAutodepositSetupOpen(true);
  }, []);

  const openParam = useLocalSearchParams<{ open?: string }>();
  useEffect(() => {
    const open = openParam.open;
    if (!open) return;
    if (open === "deposit") {
      setDepositOpen(true);
    } else if (open === "autodeposit") {
      if (autodepositEnabled) {
        autodepositInfoModeRef.current = "edit";
        setAutodepositInfoOpen(true);
      } else {
        openAutodepositCreate();
      }
    }
    router.setParams({ open: "" });
  }, [openParam.open, autodepositEnabled, openAutodepositCreate, router]);

  const dogHeight = width * DOG_NATURAL_RATIO;

  // Cross-fade drivers between the promo hero and the funded layout. heroFade
  // starts opaque (promo shows first); fundedFade starts hidden and also drives
  // the bottom card's corner radius (0 → 26). `showHero` keeps the promo mounted
  // through its fade-out, then drops it.
  const heroFade = useSharedValue(1);
  const fundedFade = useSharedValue(0);
  const [showHero, setShowHero] = useState(true);

  // Reveal drivers. riseY starts sunk so the first paint already shows just the
  // ears; the line/badge progress values run 0 → 1.
  const riseY = useSharedValue(width * DOG_SINK_RATIO);
  const line0 = useSharedValue(0);
  const line1 = useSharedValue(0);
  const line2 = useSharedValue(0);
  const badge = useSharedValue(0);

  // Keep the Earn position + autodeposit in sync with the chain via the shared
  // refresh coordinator (focus, app-foreground, push-on-transfer, interval). This
  // is what makes the balance update the moment it changes — including a withdraw
  // done on another client (web) while this tab sits open — instead of only on
  // focus. `requestRefresh("mutation")` is reused below for local deposit/withdraw.
  const refreshEarnData = useCallback(
    async (_reason: WalletRefreshReason) => {
      await Promise.allSettled([
        refreshEarnPosition(),
        refreshAutodeposit(),
        // Preload the Earned chart's data at app open and keep its cache warm
        // in the background (TTL-throttled inside). Silent: a mounted chart
        // keeps its snapshot and only reloads on the balance-change push below.
        ...(walletAddress ? [refreshEarnEarningsCache(walletAddress)] : []),
      ]);
    },
    [refreshEarnPosition, refreshAutodeposit, walletAddress],
  );
  const { requestRefresh } = useWalletAutoRefresh({
    walletAddress,
    refresh: refreshEarnData,
    intervalMs: EARN_REFRESH_INTERVAL_MS,
  });

  // Track focus; reset to the pre-deposit, pre-reveal state on leave so the tab
  // always reopens on a clean pitch. (The coordinator above handles the on-focus
  // data refresh.)
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => {
        setIsFocused(false);
        riseY.value = width * DOG_SINK_RATIO;
        line0.value = 0;
        line1.value = 0;
        line2.value = 0;
        badge.value = 0;
      };
    }, [width, riseY, line0, line1, line2, badge]),
  );

  // The reconciled position drives the funded Earn Balance: a non-zero read sets
  // it (overriding the optimistic just-deposited value), an empty read clears it
  // — so a full withdraw, even one done on another client (web), drops the funded
  // state instead of stranding the last balance. useEarnPosition has already
  // chosen the right source (read-model right after a mutation, else live), so we
  // render its value directly — no per-read guessing here.
  useEffect(() => {
    // Wait for the first real fetch so we don't clear during initial load.
    if (!earnPositionLoaded) {
      return;
    }
    const raw = position ? Number(position.currentAmountRaw) : 0;
    const usd = position && Number.isFinite(raw) ? raw / 1e6 : 0;
    if (usd > 0) {
      setDepositedUsd(usd);
      setHasDeposit(true);
    } else {
      setDepositedUsd(null);
      setHasDeposit(false);
    }
  }, [position, earnPositionLoaded]);

  // Push fresh earnings into a mounted Earned chart only when the balance
  // actually moved (deposit/withdraw/sweep, local or another client). Quiet
  // background refreshes never reload a chart that's on screen.
  // ponytail: 1-cent epsilon so live yield accrual between 15s reads doesn't
  // count as a change; only breaks above ~$200k principal.
  const lastChartBalanceRawRef = useRef<number | null>(null);
  useEffect(() => {
    if (!earnPositionLoaded || !walletAddress) {
      lastChartBalanceRawRef.current = null;
      return;
    }
    const raw = position ? Number(position.currentAmountRaw) : 0;
    if (!Number.isFinite(raw)) {
      return;
    }
    const prev = lastChartBalanceRawRef.current;
    lastChartBalanceRawRef.current = raw;
    if (prev !== null && Math.abs(raw - prev) >= 10_000) {
      void refreshEarnEarningsCache(walletAddress, { notify: true });
    }
  }, [position, earnPositionLoaded, walletAddress]);

  // Cross-fade the promo hero ↔ funded layout whenever the funded state flips.
  // Forward (balance loaded) is the common path: funded fades in while the promo
  // fades out and then unmounts. Reverse (a full withdraw) fades the promo back.
  useEffect(() => {
    if (hasDeposit) {
      fundedFade.value = withTiming(1, {
        duration: STATE_FADE_MS,
        easing: ENTER_EASING,
      });
      heroFade.value = withTiming(
        0,
        { duration: STATE_FADE_MS, easing: ENTER_EASING },
        (finished) => {
          if (finished) {
            runOnJS(setShowHero)(false);
          }
        },
      );
    } else {
      setShowHero(true);
      heroFade.value = withTiming(1, {
        duration: STATE_FADE_MS,
        easing: ENTER_EASING,
      });
      fundedFade.value = withTiming(0, {
        duration: STATE_FADE_MS,
        easing: ENTER_EASING,
      });
    }
  }, [hasDeposit, heroFade, fundedFade]);

  // Only (re)play once the tab is focused AND visible (splash/lock cleared), so
  // the reveal never runs hidden during boot.
  useEffect(() => {
    if (isFocused && appReady) {
      setRunId((id) => id + 1);
    }
  }, [isFocused, appReady]);

  // The reveal itself, keyed to runId.
  useEffect(() => {
    if (runId === 0) {
      return;
    }
    const sink = width * DOG_SINK_RATIO;
    cancelAnimation(riseY);
    cancelAnimation(line0);
    cancelAnimation(line1);
    cancelAnimation(line2);
    cancelAnimation(badge);
    riseY.value = sink;
    line0.value = 0;
    line1.value = 0;
    line2.value = 0;
    badge.value = 0;

    riseY.value = withDelay(
      REVEAL_START_DELAY_MS,
      withTiming(0, { duration: DOG_RISE_MS, easing: ENTER_EASING }),
    );
    line0.value = withDelay(
      REVEAL_START_DELAY_MS + LINES_START_MS,
      withTiming(1, { duration: LINE_REVEAL_MS, easing: ENTER_EASING }),
    );
    line1.value = withDelay(
      REVEAL_START_DELAY_MS + LINES_START_MS + LINE_STAGGER_MS,
      withTiming(1, { duration: LINE_REVEAL_MS, easing: ENTER_EASING }),
    );
    line2.value = withDelay(
      REVEAL_START_DELAY_MS + LINES_START_MS + 2 * LINE_STAGGER_MS,
      withTiming(1, { duration: LINE_REVEAL_MS, easing: ENTER_EASING }),
    );
    badge.value = withDelay(
      REVEAL_START_DELAY_MS + BADGE_START_MS,
      withTiming(1, { duration: BADGE_MS, easing: BADGE_EASING }),
    );

    return () => {
      cancelAnimation(riseY);
      cancelAnimation(line0);
      cancelAnimation(line1);
      cancelAnimation(line2);
      cancelAnimation(badge);
    };
  }, [runId, width, riseY, line0, line1, line2, badge]);

  const riseStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: riseY.value }],
  }));
  const line0Style = useAnimatedStyle(() => ({
    opacity: line0.value,
    transform: [{ translateY: (1 - line0.value) * LINE_FROM_Y }],
  }));
  const line1Style = useAnimatedStyle(() => ({
    opacity: line1.value,
    transform: [{ translateY: (1 - line1.value) * LINE_FROM_Y }],
  }));
  const line2Style = useAnimatedStyle(() => ({
    opacity: line2.value,
    transform: [{ translateY: (1 - line2.value) * LINE_FROM_Y }],
  }));
  const badgeStyle = useAnimatedStyle(() => ({
    opacity: badge.value,
    transform: [{ scale: 0.7 + badge.value * 0.3 }],
  }));
  const heroLayerStyle = useAnimatedStyle(() => ({ opacity: heroFade.value }));
  const fundedLayerStyle = useAnimatedStyle(() => ({
    opacity: fundedFade.value,
  }));
  const bottomCardRadiusStyle = useAnimatedStyle(() => ({
    borderTopLeftRadius: fundedFade.value * FUNDED_CARD_RADIUS,
    borderTopRightRadius: fundedFade.value * FUNDED_CARD_RADIUS,
  }));

  const handleOpenDeposit = useCallback(() => {
    void Haptics.selectionAsync();
    // Pull the live wallet USDC so the sheet's available balance is current, not
    // cached from before the latest deposit/sweep (matches the autodeposit/
    // withdraw open handlers).
    refreshTokenHoldings(true);
    setDepositOpen(true);
  }, [refreshTokenHoldings]);

  const handleCloseDeposit = useCallback(() => {
    setDepositOpen(false);
  }, []);

  const handleDepositConfirmed = useCallback(
    async (amountUsd: number, mint: string) => {
      const metric = startMobileLoadingMetric("earn.deposit");
      // Runs inline while the Deposit button shows its loading state — no
      // separate process screen. Throwing surfaces the error in the sheet.
      try {
        if (!signer || !isWalletUnlocked(state)) {
          throw new Error("Unlock your wallet to deposit.");
        }
        await executeEarnDeposit({
          signer,
          amountUsd,
          mint,
          flowId: metric.flowId,
        });
        // Trust the read-model for the next reads — confirmEarnDeposit (inside
        // executeEarnDeposit, just awaited) wrote it with the deposited total, so
        // the next `/state` read is correct immediately while live `/holdings` lags.
        markEarnMutation();
        // The confirm also records quest progress — check now so a completion
        // celebrates immediately instead of on the watcher's next poll tick.
        nudgeQuestProgressCheck();
        // Reveal the funded layout immediately. The optimistic total (prior balance
        // + deposit; correct for top-ups too) bridges the network round-trip until
        // the refresh lands the reconciled read-model value (= the same total).
        const expectedUsd = (depositedUsd ?? 0) + amountUsd;
        setDepositedUsd(expectedUsd);
        setHasDeposit(true);
        try {
          // Mutation metrics require the reads that drive the visible Earn state.
          // Ambient refresh remains best-effort, but this path must distinguish a
          // real UI reconciliation from a swallowed read failure.
          await Promise.all([
            refreshEarnPosition({ throwOnError: true }),
            refreshAutodeposit({ throwOnError: true }),
            refreshTokenHoldings(true, { throwOnError: true }),
          ]);
          metric.completeAfterPaint();
        } catch (refreshError) {
          metric.failAfterPaint();
          console.warn("[earn] deposit refresh failed", refreshError);
          void requestRefresh("mutation");
        }
      } catch (error) {
        metric.failAfterPaint();
        throw error;
      }
    },
    [
      signer,
      state,
      depositedUsd,
      markEarnMutation,
      requestRefresh,
      refreshAutodeposit,
      refreshEarnPosition,
      refreshTokenHoldings,
    ],
  );

  const handleOpenWithdraw = useCallback(() => {
    void Haptics.selectionAsync();
    refreshWithdrawSources();
    setWithdrawOpen(true);
  }, [refreshWithdrawSources]);

  const handleCloseWithdraw = useCallback(() => {
    setWithdrawOpen(false);
  }, []);

  // The footer drag handle opens the positions sheet (same mechanics as
  // Deposit/Withdraw). Pull the per-source breakdown so the list is fresh.
  const handleOpenPositions = useCallback(() => {
    void Haptics.selectionAsync();
    refreshWithdrawSources();
    setPositionsOpen(true);
  }, [refreshWithdrawSources]);

  // Deposit/Withdraw inside the positions sheet hand off to the existing flows:
  // close this sheet, then open the target (mirrors AutodepositHelpSheet → setup).
  const handlePositionsDeposit = useCallback(() => {
    setPositionsOpen(false);
    setDepositOpen(true);
  }, []);

  const handlePositionsWithdraw = useCallback(() => {
    setPositionsOpen(false);
    refreshWithdrawSources();
    setWithdrawOpen(true);
  }, [refreshWithdrawSources]);

  // Swipe up anywhere on the funded footer to open the positions sheet. A Pan
  // (with an upward activation offset) is used rather than a Fling because it
  // tracks reliably and only engages on a deliberate upward drag — taps on the
  // Deposit/Withdraw buttons (no vertical travel) still register as taps. The
  // handle also opens it on tap (below).
  const footerSwipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(hasDeposit)
        .activeOffsetY(-12)
        .runOnJS(true)
        .onStart(() => handleOpenPositions()),
    [hasDeposit, handleOpenPositions],
  );

  const handleWithdrawConfirmed = useCallback(
    async (
      amountUsd: number,
      source: EarnWithdrawSourceInfo | null,
      mode: "full" | "partial",
    ) => {
      const metric = startMobileLoadingMetric("earn.withdrawal");
      try {
        if (!signer || !isWalletUnlocked(state)) {
          throw new Error("Unlock your wallet to withdraw.");
        }
        await executeEarnWithdraw({
          signer,
          amountUsd,
          flowId: metric.flowId,
          mode,
          source: source ? toWithdrawPrepareSource(source) : null,
        });
        // confirmEarnWithdraw wrote the reduced read-model — trust it over the live
        // read, which lags HIGH right after a withdraw (funds still in the obligation
        // mid-redeem). This keeps the balance from briefly bouncing back up.
        markEarnMutation();
        // Optimistic clear only when this empties the whole position (single
        // source); for multi-source the read-model refresh reconciles the rest.
        if (mode === "full" && withdrawSources.length <= 1) {
          setHasDeposit(false);
          setDepositedUsd(null);
        }
        try {
          await Promise.all([
            refreshEarnPosition({ throwOnError: true }),
            refreshAutodeposit({ throwOnError: true }),
            refreshWithdrawSources({ throwOnError: true }),
          ]);
          metric.completeAfterPaint();
        } catch (refreshError) {
          metric.failAfterPaint();
          console.warn("[earn] withdrawal refresh failed", refreshError);
          void requestRefresh("mutation");
        }
      } catch (error) {
        metric.failAfterPaint();
        throw error;
      }
    },
    [
      signer,
      state,
      withdrawSources,
      markEarnMutation,
      requestRefresh,
      refreshAutodeposit,
      refreshEarnPosition,
      refreshWithdrawSources,
    ],
  );

  const handleAutodepositSetup = useCallback(() => {
    void Haptics.selectionAsync();
    openAutodepositCreate();
  }, [openAutodepositCreate]);

  const handleAutodepositEdit = useCallback(() => {
    void Haptics.selectionAsync();
    refreshTokenHoldings(true);
    refreshEarnPosition();
    autodepositInfoModeRef.current = "edit";
    setAutodepositInfoOpen(true);
  }, [refreshTokenHoldings, refreshEarnPosition]);

  const handleAutodepositHelp = useCallback(() => {
    void Haptics.selectionAsync();
    setAutodepositHelpOpen(true);
  }, []);

  // Help sheet "Set up autodeposit" → close help, open the create flow.
  const handleAutodepositHelpSetUp = useCallback(() => {
    setAutodepositHelpOpen(false);
    openAutodepositCreate();
  }, [openAutodepositCreate]);

  const handleAutodepositToggle = useCallback(async () => {
    const request = requestAutodepositToggle();
    if (!request) {
      return;
    }
    void Haptics.selectionAsync();
    try {
      await request;
    } catch (error) {
      console.warn("[autodeposit] toggle failed", error);
    }
  }, [requestAutodepositToggle]);

  // Returns a Promise so the setup sheet can show its loading state. Create
  // stands up the on-chain policy; edit changes the threshold (DB-only). The
  // sheet dismisses itself on success.
  const handleAutodepositConfirm = useCallback(
    async (thresholdUsd: number) => {
      const metric = startMobileLoadingMetric(
        autodepositSetupMode === "edit"
          ? "earn.autodeposit.floor_update"
          : "earn.autodeposit.setup",
      );
      try {
        if (!signer || !isWalletUnlocked(state)) {
          throw new Error("Unlock your wallet to continue.");
        }
        if (autodepositSetupMode === "edit") {
          if (!autodeposit?.recurringDelegation) {
            throw new Error("Autodeposit isn't set up.");
          }
          await updateEarnAutodepositThreshold({
            signer,
            thresholdUsd,
            policyAccount: autodeposit.policyAccount,
            recurringDelegation: autodeposit.recurringDelegation,
            vaultIndex: autodeposit.vaultIndex,
            flowId: metric.flowId,
          });
        } else {
          const confirmedSetup = await executeEarnAutodepositSetup({
            signer,
            thresholdUsd,
            flowId: metric.flowId,
          });
          confirmAutodepositSetup(confirmedSetup);
        }
        try {
          const fresh = await refreshAutodeposit({ throwOnError: true });
          if (!fresh) {
            throw new Error(
              "Autodeposit mutation completed but its state was not available.",
            );
          }
          // Criteria met for immediate execution → the backend scheduled a bootstrap
          // sweep. Take the user straight to Activity so the pending transaction (and
          // its "Execute now" shortcut) is visible, instead of leaving them guessing.
          // The Activity feed reads Autodeposit state through its own hook instance,
          // which hasn't seen the new sweep yet: flag the expectation (the feed shows
          // a skeleton "Scheduled" row immediately) and warm its read in the
          // background so the real row lands without waiting for a manual refresh.
          if (getVisibleEarnScheduledSweeps(fresh.scheduledSweeps).length > 0) {
            expectScheduledSweep();
            void refreshActivityAutodeposit();
            router.navigate({
              pathname: "/(tabs)/activity",
              params: { section: "earn" },
            });
          }
          metric.completeAfterPaint();
        } catch (refreshError) {
          metric.failAfterPaint();
          console.warn("[autodeposit] mutation refresh failed", refreshError);
          void refreshAutodeposit();
        }
      } catch (error) {
        metric.failAfterPaint();
        throw error;
      }
    },
    [
      signer,
      state,
      autodepositSetupMode,
      autodeposit,
      refreshAutodeposit,
      confirmAutodepositSetup,
      expectScheduledSweep,
      refreshActivityAutodeposit,
      router,
    ],
  );

  const handleAutodepositDelete = useCallback(async () => {
    const metric = startMobileLoadingMetric("earn.autodeposit.close");
    try {
      if (!signer || !isWalletUnlocked(state)) {
        throw new Error("Unlock your wallet to continue.");
      }
      if (!autodeposit?.recurringDelegation) {
        throw new Error("Autodeposit isn't set up.");
      }
      const confirmedClose = await executeEarnAutodepositClose({
        signer,
        policy: autodeposit.policyAccount,
        recurringDelegation: autodeposit.recurringDelegation,
        flowId: metric.flowId,
      });
      confirmAutodepositClose(confirmedClose);
      try {
        await refreshAutodeposit({ throwOnError: true });
        metric.completeAfterPaint();
      } catch (refreshError) {
        metric.failAfterPaint();
        console.warn("[autodeposit] close refresh failed", refreshError);
        void refreshAutodeposit();
      }
    } catch (error) {
      metric.failAfterPaint();
      throw error;
    }
  }, [signer, state, autodeposit, confirmAutodepositClose, refreshAutodeposit]);

  // Loyal APY for the hero + funded header badges — same source as the APY
  // chart and the web (forecast/loyal rate), not the position's raw reserve
  // supply APY (which reads lower). The starter hero's "into $X" projects the
  // $6,000 principal at the same rate so the headline always matches the badge.
  const { apyLabel, heroTargetLabel } = useMemo(() => {
    const raw = getLoyalApyBps(forecastSummary) / 100;
    const pct = Number.isFinite(raw) && raw > 0 ? raw : FALLBACK_APY_PCT;
    const target = Math.round(HERO_PRINCIPAL_USD * (1 + pct / 100));
    return {
      apyLabel: `${pct.toFixed(2)}% APY`,
      heroTargetLabel: `$${target.toLocaleString("en-US")}`,
    };
  }, [forecastSummary]);

  // Autodeposit threshold subtitle, shown once it's been set up (Figma 74:20722).
  // A pending target (setup abandoned before its delegation stage) can't be
  // toggled or edited — the server rejects both. Treat it as not set up so the
  // row offers "Set up" again; the backend resumes the recorded policy/nonce,
  // so only the missing final stage needs signing.
  const isAutodepositSetUp =
    autodepositThresholdUsd != null && autodeposit?.status !== "pending";
  const autodepositSubtitle = useMemo(() => {
    if (autodepositThresholdUsd == null) {
      return null;
    }
    return `Anything above $${autodepositThresholdUsd.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }, [autodepositThresholdUsd]);

  // Funded Earn Balance, split so the cents render dimmed (Figma 74:19926).
  // Round to integer cents BEFORE splitting: Kamino's floor-division values a
  // fresh $4 deposit at 3.999999, and trunc-then-round-cents rendered that as
  // whole "3" + cents "100" — "$3.100" on screen, read as a drop to "3.1".
  const balanceParts = useMemo(() => {
    const usd = hasDeposit && depositedUsd != null ? depositedUsd : 0;
    const totalCents = Math.round(usd * 100);
    const whole = Math.trunc(totalCents / 100);
    const cents = totalCents - whole * 100;
    return {
      whole: `$${whole.toLocaleString("en-US")}`,
      cents: `.${cents.toString().padStart(2, "0")}`,
    };
  }, [hasDeposit, depositedUsd]);

  return (
    <View style={styles.root}>
      <View style={[styles.topArea, { paddingTop: insets.top + 8 }]}>
        {hasDeposit ? (
          <Animated.View style={[styles.fundedLayer, fundedLayerStyle]}>
            <View style={styles.header}>
              <Text style={styles.title}>Earn</Text>
              <View style={styles.badge}>
                <EarnFlash width={12} height={16} />
                <Text style={styles.badgeText}>{apyLabel}</Text>
              </View>
            </View>
            <EarnChartTabs
              principalUsd={depositedUsd}
              walletAddress={walletAddress}
            />
            <View style={styles.autodepositSection}>
              <View style={styles.autodepositCell}>
                <View style={styles.autodepositIcon}>
                  <AutodepositIcon width={48} height={48} />
                </View>
                <View style={styles.autodepositMiddle}>
                  <Text style={styles.autodepositTitle}>Autodeposit</Text>
                  {autodepositSubtitle ? (
                    <Text style={styles.autodepositSubtitle}>
                      {autodepositSubtitle}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.autodepositRight}>
                  {isAutodepositSetUp ? (
                    <>
                      <Pressable
                        onPress={handleAutodepositEdit}
                        accessibilityRole="button"
                        accessibilityLabel="Edit Autodeposit"
                        hitSlop={8}
                        style={({ pressed }) => [
                          styles.autodepositHelp,
                          { opacity: pressed ? 0.7 : 1 },
                        ]}
                      >
                        <SlidersHorizontal
                          size={24}
                          color="#FFF"
                          strokeWidth={2}
                        />
                      </Pressable>
                      <Pressable
                        onPress={handleAutodepositToggle}
                        accessibilityRole="switch"
                        accessibilityState={{ checked: autodepositEnabled }}
                        accessibilityLabel="Toggle Autodeposit"
                        hitSlop={8}
                        style={[
                          styles.toggleTrack,
                          autodepositEnabled
                            ? styles.toggleTrackOn
                            : styles.toggleTrackOff,
                        ]}
                      >
                        <View style={styles.toggleHandle} />
                      </Pressable>
                    </>
                  ) : (
                    <>
                      <Pressable
                        onPress={handleAutodepositHelp}
                        accessibilityRole="button"
                        accessibilityLabel="Autodeposit help"
                        hitSlop={8}
                        style={({ pressed }) => [
                          styles.autodepositHelp,
                          { opacity: pressed ? 0.7 : 1 },
                        ]}
                      >
                        <EarnQuestionmark width={24} height={24} />
                      </Pressable>
                      <Pressable
                        onPress={handleAutodepositSetup}
                        accessibilityRole="button"
                        accessibilityLabel="Set up Autodeposit"
                        style={({ pressed }) => [
                          styles.setUpButton,
                          { opacity: pressed ? 0.85 : 1 },
                        ]}
                      >
                        <Text style={styles.setUpLabel}>Set up</Text>
                      </Pressable>
                    </>
                  )}
                </View>
              </View>
            </View>
          </Animated.View>
        ) : null}
        {showHero ? (
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { paddingTop: insets.top + 8 },
              heroLayerStyle,
            ]}
          >
            {/* Behind the copy so the headline + badge always sit on top. */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.dogWrap,
                { bottom: -(width * DOG_CLIP_RATIO) },
                riseStyle,
              ]}
            >
              <EarnDog
                runId={runId}
                startDelay={REVEAL_START_DELAY_MS}
                width={width}
                height={dogHeight}
              />
            </Animated.View>

            <View style={styles.hero}>
              <Animated.View style={line0Style}>
                <Text style={styles.headline}>
                  <Text style={styles.headlineDim}>Turn </Text>
                  <Text style={styles.headlineBright}>
                    ${HERO_PRINCIPAL_USD.toLocaleString("en-US")}
                  </Text>
                </Text>
              </Animated.View>
              <Animated.View style={line1Style}>
                <Text style={styles.headline}>
                  <Text style={styles.headlineDim}>into </Text>
                  <Text style={styles.headlineBright}>{heroTargetLabel} </Text>
                  <Text style={styles.headlineDim}>in</Text>
                </Text>
              </Animated.View>
              <Animated.View style={line2Style}>
                <Text style={styles.headline}>
                  <Text style={styles.headlineDim}>a year with</Text>
                </Text>
              </Animated.View>
              <Animated.View style={[styles.badgeReveal, badgeStyle]}>
                <View style={styles.heroBadge}>
                  <EarnFlash width={21} height={28} />
                  <Text style={styles.heroBadgeText}>{apyLabel}</Text>
                </View>
              </Animated.View>
            </View>
          </Animated.View>
        ) : null}
      </View>

      <Animated.View
        style={[
          styles.bottomCard,
          bottomCardRadiusStyle,
          { paddingBottom: TAB_BAR_RESERVED_HEIGHT + insets.bottom },
        ]}
      >
        <GestureDetector gesture={footerSwipeGesture}>
          <Animated.View style={styles.footerInner}>
            {hasDeposit ? (
              <Pressable
                onPress={handleOpenPositions}
                accessibilityRole="button"
                accessibilityLabel="View current positions"
                hitSlop={8}
                style={styles.handleHit}
              >
                <View style={styles.dragHandle} />
              </Pressable>
            ) : null}

            <View style={styles.balanceRow}>
              <Text style={styles.balanceLabel}>Earn Balance</Text>
              {balanceLoading ? (
                <Skeleton style={styles.balanceSkeleton} />
              ) : (
                <Text style={styles.balanceValue}>
                  <Text style={styles.balanceValueStrong}>
                    {balanceParts.whole}
                  </Text>
                  <Text style={styles.balanceValueDim}>
                    {balanceParts.cents}
                  </Text>
                </Text>
              )}
            </View>

            <View style={styles.actionRow}>
              <Pressable
                onPress={handleOpenDeposit}
                accessibilityRole="button"
                accessibilityLabel="Deposit"
                style={({ pressed }) => [
                  styles.depositButton,
                  // Full-width on the empty hero (split half-and-half with
                  // Refund SOL when refunds exist); stays content-width beside
                  // Withdraw once a deposit exists (per Figma 3883:18293).
                  hasDeposit ? null : styles.depositButtonFull,
                  { opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <View style={styles.iconWrap}>
                  <Plus size={20} color="#FFF" strokeWidth={2.2} />
                </View>
                <Text style={styles.depositLabel}>Deposit</Text>
              </Pressable>
              {!hasDeposit && earnRefunds.length > 0 ? (
                <Pressable
                  onPress={handleOpenRefunds}
                  accessibilityRole="button"
                  accessibilityLabel="View refundable accounts"
                  style={({ pressed }) => [
                    styles.refundActionButton,
                    { opacity: pressed ? 0.8 : 1 },
                  ]}
                >
                  <Text style={styles.withdrawLabel}>Refund SOL</Text>
                </Pressable>
              ) : null}
              {hasDeposit ? (
                <Pressable
                  onPress={handleOpenWithdraw}
                  accessibilityRole="button"
                  accessibilityLabel="Withdraw"
                  style={({ pressed }) => [
                    styles.withdrawButton,
                    { opacity: pressed ? 0.8 : 1 },
                  ]}
                >
                  <View style={styles.iconWrap}>
                    <ArrowUp
                      size={20}
                      color="#000"
                      strokeWidth={2.2}
                      opacity={0.6}
                    />
                  </View>
                  <Text style={styles.withdrawLabel}>Withdraw</Text>
                </Pressable>
              ) : null}
            </View>
          </Animated.View>
        </GestureDetector>
      </Animated.View>

      <DepositSheet
        open={depositOpen}
        onClose={handleCloseDeposit}
        onDeposit={handleDepositConfirmed}
        stableBalancesByMint={stableBalancesByMint}
        firstDepositSolShortfall={firstDepositSolShortfall}
        isFirstDeposit={
          earnPositionLoaded && (!hasDeposit || earnPolicyMissing)
        }
      />

      <WithdrawSheet
        open={withdrawOpen}
        onClose={handleCloseWithdraw}
        onWithdraw={handleWithdrawConfirmed}
        availableUsdc={depositedUsd}
        sources={withdrawSources}
      />

      <PositionsSheet
        open={positionsOpen}
        onClose={() => setPositionsOpen(false)}
        balanceWhole={balanceParts.whole}
        balanceCents={balanceParts.cents}
        sources={livePositions}
        onDeposit={handlePositionsDeposit}
        onWithdraw={handlePositionsWithdraw}
      />

      <AutodepositHelpSheet
        open={autodepositHelpOpen}
        onClose={() => setAutodepositHelpOpen(false)}
        onSetUp={handleAutodepositHelpSetUp}
      />

      <AutodepositSetupSheet
        open={autodepositSetupOpen}
        onClose={() => setAutodepositSetupOpen(false)}
        onConfirm={handleAutodepositConfirm}
        onDelete={handleAutodepositDelete}
        mode={autodepositSetupMode}
        initialThresholdUsd={autodepositThresholdUsd}
        availableUsdc={usdcAvailable}
        earnBalanceUsd={depositedUsd}
        walletAddress={walletAddress}
        setupSolShortfall={autodepositSolShortfall}
      />
      <AutodepositInfoSheet
        open={autodepositInfoOpen}
        onClose={() => setAutodepositInfoOpen(false)}
        onContinue={handleAutodepositInfoContinue}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
  },
  topArea: {
    flex: 1,
    position: "relative",
    overflow: "hidden",
  },
  // Funded layout, cross-faded in over the promo hero. flex:1 so it fills the
  // top area the same way the bare funded children used to (EarnChartTabs pins
  // the autodeposit row to the bottom).
  fundedLayer: {
    flex: 1,
  },
  // Pre-deposit hero (Figma 3883:18252).
  hero: {
    marginTop: 52,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  headline: {
    fontFamily: "Geist_900Black",
    fontSize: 40,
    lineHeight: 40,
    letterSpacing: -0.4,
    textAlign: "center",
    textTransform: "uppercase",
  },
  // The @/tw Text wrapper forces a fontFamily onto every Text (defaulting to
  // Geist_400Regular), so nested spans must restate the weight or they drop
  // back to regular instead of inheriting the parent's Black.
  headlineDim: {
    fontFamily: "Geist_900Black",
    color: COLOR_HEADLINE_DIM,
  },
  headlineBright: {
    fontFamily: "Geist_900Black",
    color: "#FFF",
  },
  badgeReveal: {
    marginTop: 8,
  },
  heroBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingHorizontal: 12,
    // The 48pt line box below already carries the vertical breathing room;
    // pill height stays ~the same as the old 40+3+3.
    paddingVertical: 0,
    borderRadius: 48,
    backgroundColor: COLOR_BADGE_GREEN,
  },
  heroBadgeText: {
    fontFamily: "Geist_900Black",
    fontSize: 40,
    // iOS renders Geist Black's caps above a line box pinned to the font
    // size, so the text overflowed the pill's top while the pill hugged the
    // box ("green bg misplaced towards the lower"). 48pt centers the glyphs
    // on both platforms; do not pin this back to the font size.
    lineHeight: 48,
    letterSpacing: -0.4,
    color: "#FFF",
  },
  dogWrap: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  // Header shown in the deposited state (Figma 3883:18253 header).
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
    paddingHorizontal: 16,
  },
  title: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 28,
    lineHeight: 32,
    color: "#FFF",
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    backgroundColor: COLOR_BADGE_GREEN,
  },
  badgeText: {
    fontFamily: "Geist_400Regular",
    fontSize: 15,
    lineHeight: 20,
    color: "#FFF",
    letterSpacing: 0.06,
  },
  // Autodeposit cell — sits in the dark area below the chart, above the white
  // balance card (Figma 74:19891). EarnChart's flex:1 pins it to the bottom.
  autodepositSection: {
    width: "100%",
    paddingVertical: 8,
  },
  autodepositCell: {
    flexDirection: "row",
    alignItems: "center",
    height: 60,
    paddingHorizontal: 16,
  },
  autodepositIcon: {
    paddingRight: 12,
    paddingVertical: 6,
  },
  autodepositMiddle: {
    flex: 1,
    paddingVertical: 9,
  },
  autodepositTitle: {
    fontFamily: "Geist_500Medium",
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.187,
    color: "#FFF",
  },
  autodepositSubtitle: {
    fontFamily: "Geist_400Regular",
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: -0.165,
    color: COLOR_HEADLINE_DIM,
  },
  // On/off switch shown once Autodeposit is set up (Figma 74:20731).
  toggleTrack: {
    width: 52,
    height: 32,
    borderRadius: 100,
    padding: 4,
    flexDirection: "row",
    alignItems: "center",
  },
  toggleTrackOn: {
    backgroundColor: COLOR_AUTODEPOSIT_RED,
    justifyContent: "flex-end",
  },
  toggleTrackOff: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "flex-start",
  },
  toggleHandle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#FFF",
  },
  autodepositRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 12,
  },
  autodepositHelp: {
    padding: 6,
    borderRadius: 9999,
    alignItems: "center",
    justifyContent: "center",
  },
  setUpButton: {
    backgroundColor: COLOR_AUTODEPOSIT_RED,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 9999,
    alignItems: "center",
    justifyContent: "center",
  },
  setUpLabel: {
    fontFamily: "Geist_500Medium",
    fontSize: 14,
    lineHeight: 20,
    color: "#FFF",
    textAlign: "center",
  },
  bottomCard: {
    backgroundColor: "#FFF",
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  // Footer content wrapped by the swipe-to-open gesture; keeps the original
  // 8px rhythm between handle, balance, and action buttons.
  footerInner: {
    gap: 8,
  },
  // Top drag handle on the funded footer — taps open the positions sheet
  // (Figma 74:20241 / 75:33852).
  handleHit: {
    alignItems: "center",
    justifyContent: "center",
    // Generous strip so the handle is easy to tap or swipe up, even though the
    // visible pill stays small.
    paddingTop: 8,
    paddingBottom: 10,
  },
  dragHandle: {
    width: 32,
    height: 4,
    borderRadius: 4,
    backgroundColor: "rgba(0, 0, 0, 0.24)",
  },
  balanceRow: {
    flexDirection: "column",
    gap: 2,
  },
  balanceLabel: {
    fontFamily: "Geist_400Regular",
    fontSize: 15,
    lineHeight: 20,
    color: COLOR_LABEL_DIM,
  },
  balanceValue: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 36,
    lineHeight: 48,
    letterSpacing: -0.4,
  },
  balanceValueStrong: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 36,
    lineHeight: 48,
    color: "#000",
  },
  balanceValueDim: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 36,
    lineHeight: 48,
    color: COLOR_BALANCE_DIM,
  },
  // Stand-in for the balance number while it loads. Sized to the 48px line box
  // (36 + 6 + 6) so swapping in the real figure doesn't shift the layout. Tint
  // comes from Skeleton's light-surface default (this card is white).
  balanceSkeleton: {
    height: 36,
    width: 150,
    marginVertical: 6,
    borderRadius: 10,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  depositButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    height: 44,
    paddingLeft: 12,
    paddingRight: 20,
    borderRadius: 78,
    backgroundColor: "#000",
    overflow: "hidden",
  },
  depositButtonFull: {
    flex: 1,
  },
  withdrawButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    height: 44,
    paddingLeft: 12,
    paddingRight: 20,
    borderRadius: 78,
    backgroundColor: COLOR_WITHDRAW_BG,
    overflow: "hidden",
  },
  // Refund SOL beside Deposit on the empty hero — Withdraw's pill without the
  // icon, splitting the action row half-and-half.
  refundActionButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    height: 44,
    borderRadius: 78,
    backgroundColor: COLOR_WITHDRAW_BG,
  },
  iconWrap: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  depositLabel: {
    fontFamily: "Geist_400Regular",
    fontSize: 17,
    lineHeight: 22,
    color: "#FFF",
  },
  withdrawLabel: {
    fontFamily: "Geist_400Regular",
    fontSize: 17,
    lineHeight: 22,
    color: "#000",
  },
});
