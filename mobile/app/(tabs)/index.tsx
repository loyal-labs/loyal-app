import * as Haptics from "expo-haptics";
import { Redirect, useFocusEffect } from "expo-router";
import { ArrowUp, Plus } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, useWindowDimensions } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DepositSheet } from "@/components/earn/DepositSheet";
import { EarnChart } from "@/components/earn/EarnChart";
import { EarnDog } from "@/components/earn/EarnDog";
import { WithdrawSheet } from "@/components/earn/WithdrawSheet";
import { useAppReady } from "@/lib/app-ready";
import { Pressable, Text, View } from "@/tw";

import EarnFlash from "../../assets/images/earn/flash.svg";

const APY_LABEL = "8.46% APY";
const DEPOSITED_BALANCE_WHOLE = "$6,165";
const DEPOSITED_BALANCE_CENTS = ".662512";

const COLOR_BADGE_GREEN = "#32B67C";
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

// Earn hasn't been released yet — "/" lands on the wallet tab and EarnScreen
// stays unreachable until this flips to true.
const EARN_RELEASED = false;

export default function EarnRoute() {
  if (!EARN_RELEASED) {
    return <Redirect href="/wallet" />;
  }
  return <EarnScreen />;
}

function EarnScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const appReady = useAppReady();
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [hasDeposit, setHasDeposit] = useState(false);
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
      return () => {
        setIsFocused(false);
        setHasDeposit(false);
        riseY.value = width * DOG_SINK_RATIO;
        line0.value = 0;
        line1.value = 0;
        line2.value = 0;
        badge.value = 0;
      };
    }, [width, riseY, line0, line1, line2, badge]),
  );

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

  const handleDepositConfirmed = useCallback(() => {
    setHasDeposit(true);
  }, []);

  const handleOpenWithdraw = useCallback(() => {
    void Haptics.selectionAsync();
    setWithdrawOpen(true);
  }, []);

  const handleCloseWithdraw = useCallback(() => {
    setWithdrawOpen(false);
  }, []);

  const handleWithdrawConfirmed = useCallback(() => {
    setHasDeposit(false);
  }, []);

  return (
    <View style={styles.root}>
      <View style={[styles.topArea, { paddingTop: insets.top + 8 }]}>
        {hasDeposit ? (
          <>
            <View style={styles.header}>
              <Text style={styles.title}>Earn</Text>
              <View style={styles.badge}>
                <EarnFlash width={12} height={16} />
                <Text style={styles.badgeText}>{APY_LABEL}</Text>
              </View>
            </View>
            <EarnChart />
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
        <View style={styles.balanceRow}>
          <Text style={styles.balanceLabel}>Earn Balance</Text>
          <Text style={styles.balanceValue}>
            {hasDeposit ? (
              <>
                <Text style={styles.balanceValueStrong}>
                  {DEPOSITED_BALANCE_WHOLE}
                </Text>
                <Text style={styles.balanceValueDim}>
                  {DEPOSITED_BALANCE_CENTS}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.balanceValueStrong}>$0</Text>
                <Text style={styles.balanceValueDim}>.00</Text>
              </>
            )}
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
                <ArrowUp size={20} color="#000" strokeWidth={2.2} />
              </View>
              <Text style={styles.withdrawLabel}>Withdraw</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <DepositSheet
        open={depositOpen}
        onClose={handleCloseDeposit}
        onDeposit={handleDepositConfirmed}
      />

      <WithdrawSheet
        open={withdrawOpen}
        onClose={handleCloseWithdraw}
        onWithdraw={handleWithdrawConfirmed}
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
  bottomCard: {
    backgroundColor: "#FFF",
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 8,
  },
  // Rounded top only in the deposited state; the empty hero meets the dog with
  // a flush, square edge (Figma 3883:18287).
  bottomCardRounded: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
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
