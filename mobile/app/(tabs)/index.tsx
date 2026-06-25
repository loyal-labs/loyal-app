import * as Haptics from "expo-haptics";
import { useFocusEffect } from "expo-router";
import { ArrowUp, Plus, SlidersHorizontal } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AutodepositHelpSheet } from "@/components/earn/AutodepositHelpSheet";
import { AutodepositSetupSheet } from "@/components/earn/AutodepositSetupSheet";
import { DepositSheet } from "@/components/earn/DepositSheet";
import { EarnChartTabs } from "@/components/earn/EarnChartTabs";
import { EarnDog } from "@/components/earn/EarnDog";
import { getLoyalApyBps } from "@/components/earn/earnForecastModel";
import { PositionsSheet } from "@/components/earn/PositionsSheet";
import { WithdrawSheet } from "@/components/earn/WithdrawSheet";
import { useEarnPosition } from "@/hooks/wallet/useEarnPosition";
import { useTokenHoldings } from "@/hooks/wallet/useTokenHoldings";
import { useAppReady } from "@/lib/app-ready";
import {
  SOLANA_USDC_MINT_DEVNET,
  SOLANA_USDC_MINT_MAINNET,
} from "@/lib/solana/constants";
import {
  executeEarnAutodepositClose,
  executeEarnAutodepositSetup,
  setEarnAutodepositActive,
  updateEarnAutodepositThreshold,
} from "@/lib/solana/earn/autodeposit";
import {
  toWithdrawPrepareSource,
  type EarnHoldingItem,
  type EarnWithdrawSourceInfo,
} from "@/lib/solana/earn/earn-api";
import { executeEarnDeposit } from "@/lib/solana/earn/deposit";
import { executeEarnWithdraw } from "@/lib/solana/earn/withdraw";
import { useEarnAutodeposit } from "@/hooks/wallet/useEarnAutodeposit";
import { useEarnForecast } from "@/hooks/wallet/useEarnForecast";
import { useEarnWithdrawSources } from "@/hooks/wallet/useEarnWithdrawSources";
import { isWalletUnlocked, useWallet } from "@/lib/wallet/wallet-provider";
import { Pressable, Text, View } from "@/tw";

import AutodepositIcon from "../../assets/images/earn/autodeposit.svg";
import EarnFlash from "../../assets/images/earn/flash.svg";
import EarnQuestionmark from "../../assets/images/earn/questionmark.svg";

const APY_LABEL = "8.46% APY";

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
  const { tokenHoldings } = useTokenHoldings(walletAddress);
  const usdcAvailable = useMemo(() => {
    const holding = tokenHoldings.find(
      (h) =>
        h.mint === SOLANA_USDC_MINT_MAINNET ||
        h.mint === SOLANA_USDC_MINT_DEVNET,
    );
    return holding && Number.isFinite(holding.balance) ? holding.balance : null;
  }, [tokenHoldings]);
  // Real on-chain Earn position (read-only, no signing). Drives the funded
  // state + balance once it loads; the optimistic just-deposited value below
  // bridges the gap until the read-model catches up.
  const { position, holdings, refreshEarnPosition } =
    useEarnPosition(walletAddress);
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
  const { autodeposit, refreshAutodeposit } = useEarnAutodeposit(walletAddress);
  const autodepositThresholdUsd = useMemo(() => {
    if (!autodeposit) {
      return null;
    }
    const raw = Number(autodeposit.walletBalanceFloorRaw ?? "0");
    return Number.isFinite(raw) ? raw / 1e6 : 0;
  }, [autodeposit]);
  const autodepositEnabled = autodeposit?.active ?? false;
  const [autodepositHelpOpen, setAutodepositHelpOpen] = useState(false);
  const [autodepositSetupOpen, setAutodepositSetupOpen] = useState(false);
  const [autodepositSetupMode, setAutodepositSetupMode] = useState<
    "create" | "edit"
  >("create");
  // Principal just deposited, used as the funded Earn Balance until the real
  // on-chain position is wired (see .context/earn-deposit-findings.md, step b).
  const [depositedUsd, setDepositedUsd] = useState<number | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  // Bumped to (re)play the reveal each time the tab becomes visible.
  const [runId, setRunId] = useState(0);

  const dogHeight = width * DOG_NATURAL_RATIO;

  // Reveal drivers. riseY starts sunk so the first paint already shows just the
  // ears; the line/badge progress values run 0 → 1.
  const riseY = useSharedValue(width * DOG_SINK_RATIO);
  const line0 = useSharedValue(0);
  const line1 = useSharedValue(0);
  const line2 = useSharedValue(0);
  const badge = useSharedValue(0);

  // Track focus; reset to the pre-deposit, pre-reveal state on leave so the tab
  // always reopens on a clean pitch.
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      // Pull the real read-models whenever the tab gains focus.
      refreshEarnPosition();
      refreshAutodeposit();
      return () => {
        setIsFocused(false);
        riseY.value = width * DOG_SINK_RATIO;
        line0.value = 0;
        line1.value = 0;
        line2.value = 0;
        badge.value = 0;
      };
    }, [
      width,
      riseY,
      line0,
      line1,
      line2,
      badge,
      refreshEarnPosition,
      refreshAutodeposit,
    ]),
  );

  // Real read-model is the source of truth: once a position with a balance
  // loads, it sets the funded Earn Balance (overriding the optimistic value).
  useEffect(() => {
    if (!position) {
      return;
    }
    const raw = Number(position.currentAmountRaw);
    const usd = Number.isFinite(raw) ? raw / 1e6 : 0;
    if (usd > 0) {
      setDepositedUsd(usd);
      setHasDeposit(true);
    }
  }, [position]);

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

  const handleOpenDeposit = useCallback(() => {
    void Haptics.selectionAsync();
    setDepositOpen(true);
  }, []);

  const handleCloseDeposit = useCallback(() => {
    setDepositOpen(false);
  }, []);

  const handleDepositConfirmed = useCallback(
    async (amountUsd: number) => {
      // Runs inline while the Deposit button shows its loading state — no
      // separate process screen. Throwing surfaces the error in the sheet.
      if (!signer || !isWalletUnlocked(state)) {
        throw new Error("Unlock your wallet to deposit.");
      }
      await executeEarnDeposit({ signer, amountUsd });
      // Show the funded state immediately; the read-model reconciles the exact
      // balance on the next refresh.
      setDepositedUsd(amountUsd);
      setHasDeposit(true);
      refreshEarnPosition();
    },
    [signer, state, refreshEarnPosition],
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
    async (amountUsd: number, source: EarnWithdrawSourceInfo | null) => {
      if (!signer || !isWalletUnlocked(state)) {
        throw new Error("Unlock your wallet to withdraw.");
      }
      // Mode is relative to the selected source: emptying that source is a full
      // withdrawal (backend uses the exact on-chain amount), otherwise partial.
      const sourceBalance = source
        ? Number(source.amountRaw) / 1e6
        : (depositedUsd ?? 0);
      const mode: "full" | "partial" =
        amountUsd >= sourceBalance - 0.005 ? "full" : "partial";
      await executeEarnWithdraw({
        signer,
        amountUsd,
        mode,
        source: source ? toWithdrawPrepareSource(source) : null,
      });
      // Optimistic clear only when this empties the whole position (single
      // source); for multi-source the read-model refresh reconciles the rest.
      if (mode === "full" && withdrawSources.length <= 1) {
        setHasDeposit(false);
        setDepositedUsd(null);
      }
      refreshEarnPosition();
      refreshWithdrawSources();
    },
    [
      signer,
      state,
      depositedUsd,
      withdrawSources,
      refreshEarnPosition,
      refreshWithdrawSources,
    ],
  );

  const handleAutodepositSetup = useCallback(() => {
    void Haptics.selectionAsync();
    setAutodepositSetupMode("create");
    setAutodepositSetupOpen(true);
  }, []);

  const handleAutodepositEdit = useCallback(() => {
    void Haptics.selectionAsync();
    setAutodepositSetupMode("edit");
    setAutodepositSetupOpen(true);
  }, []);

  const handleAutodepositHelp = useCallback(() => {
    void Haptics.selectionAsync();
    setAutodepositHelpOpen(true);
  }, []);

  // Help sheet "Set up autodeposit" → close help, open the create flow.
  const handleAutodepositHelpSetUp = useCallback(() => {
    setAutodepositHelpOpen(false);
    setAutodepositSetupMode("create");
    setAutodepositSetupOpen(true);
  }, []);

  const handleAutodepositToggle = useCallback(async () => {
    if (
      !autodeposit?.recurringDelegation ||
      !signer ||
      !isWalletUnlocked(state)
    ) {
      return;
    }
    void Haptics.selectionAsync();
    try {
      await setEarnAutodepositActive({
        signer,
        active: !autodeposit.active,
        policyAccount: autodeposit.policyAccount,
        recurringDelegation: autodeposit.recurringDelegation,
        vaultIndex: autodeposit.vaultIndex,
      });
    } catch (error) {
      console.warn("[autodeposit] toggle failed", error);
    } finally {
      refreshAutodeposit();
    }
  }, [autodeposit, signer, state, refreshAutodeposit]);

  // Returns a Promise so the setup sheet can show its loading state. Create
  // stands up the on-chain policy; edit changes the threshold (DB-only). The
  // sheet dismisses itself on success.
  const handleAutodepositConfirm = useCallback(
    async (thresholdUsd: number) => {
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
        });
      } else {
        await executeEarnAutodepositSetup({ signer, thresholdUsd });
      }
      refreshAutodeposit();
    },
    [signer, state, autodepositSetupMode, autodeposit, refreshAutodeposit],
  );

  const handleAutodepositDelete = useCallback(async () => {
    if (!signer || !isWalletUnlocked(state)) {
      throw new Error("Unlock your wallet to continue.");
    }
    if (!autodeposit?.recurringDelegation) {
      throw new Error("Autodeposit isn't set up.");
    }
    await executeEarnAutodepositClose({
      signer,
      policy: autodeposit.policyAccount,
      recurringDelegation: autodeposit.recurringDelegation,
    });
    refreshAutodeposit();
  }, [signer, state, autodeposit, refreshAutodeposit]);

  // Loyal APY for the funded header badge — same source as the APY chart and the
  // web (forecast/loyal rate), not the position's raw reserve supply APY (which
  // reads lower). getLoyalApyBps falls back to its marketing rate while loading.
  const apyLabel = useMemo(() => {
    const pct = getLoyalApyBps(forecastSummary) / 100;
    if (Number.isFinite(pct) && pct > 0) {
      return `${pct.toFixed(2)}% APY`;
    }
    return APY_LABEL;
  }, [forecastSummary]);

  // Autodeposit threshold subtitle, shown once it's been set up (Figma 74:20722).
  const isAutodepositSetUp = autodepositThresholdUsd != null;
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
  const balanceParts = useMemo(() => {
    const usd = hasDeposit && depositedUsd != null ? depositedUsd : 0;
    const whole = Math.trunc(usd);
    const cents = Math.round((usd - whole) * 100);
    return {
      whole: `$${whole.toLocaleString("en-US")}`,
      cents: `.${cents.toString().padStart(2, "0")}`,
    };
  }, [hasDeposit, depositedUsd]);

  return (
    <View style={styles.root}>
      <View style={[styles.topArea, { paddingTop: insets.top + 8 }]}>
        {hasDeposit ? (
          <>
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
          </>
        ) : (
          <>
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
                  <Text style={styles.headlineBright}>$6,000</Text>
                </Text>
              </Animated.View>
              <Animated.View style={line1Style}>
                <Text style={styles.headline}>
                  <Text style={styles.headlineDim}>into </Text>
                  <Text style={styles.headlineBright}>$6,507 </Text>
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
                  <Text style={styles.heroBadgeText}>{APY_LABEL}</Text>
                </View>
              </Animated.View>
            </View>
          </>
        )}
      </View>

      <View
        style={[
          styles.bottomCard,
          hasDeposit ? styles.bottomCardRounded : null,
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
              <Text style={styles.balanceValue}>
                <Text style={styles.balanceValueStrong}>
                  {balanceParts.whole}
                </Text>
                <Text style={styles.balanceValueDim}>{balanceParts.cents}</Text>
              </Text>
            </View>

            <View style={styles.actionRow}>
              <Pressable
                onPress={handleOpenDeposit}
                accessibilityRole="button"
                accessibilityLabel="Deposit"
                style={({ pressed }) => [
                  styles.depositButton,
                  // Full-width on the empty hero; stays content-width beside
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
      </View>

      <DepositSheet
        open={depositOpen}
        onClose={handleCloseDeposit}
        onDeposit={handleDepositConfirmed}
        availableUsdc={usdcAvailable}
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
        walletAddress={walletAddress}
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
    paddingVertical: 3,
    borderRadius: 48,
    backgroundColor: COLOR_BADGE_GREEN,
  },
  heroBadgeText: {
    fontFamily: "Geist_900Black",
    fontSize: 40,
    lineHeight: 40,
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
  // Rounded top only in the deposited state; the empty hero meets the dog with
  // a flush, square edge (Figma 3883:18287).
  bottomCardRounded: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
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
