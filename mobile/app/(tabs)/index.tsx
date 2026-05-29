import * as Haptics from "expo-haptics";
import { useFocusEffect } from "expo-router";
import { ArrowUp, Plus } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DepositSheet } from "@/components/earn/DepositSheet";
import { type BubbleData, EarnBubbles } from "@/components/earn/EarnBubbles";
import { EarnChart } from "@/components/earn/EarnChart";
import { EarnMascot } from "@/components/earn/EarnMascot";
import { WithdrawSheet } from "@/components/earn/WithdrawSheet";
import { useAppReady } from "@/lib/app-ready";
import { Pressable, Text, View } from "@/tw";

import EarnFlash from "../../assets/images/earn/flash.svg";

const APY_LABEL = "8.46% APY";
const IDLE_AMOUNT = "$1,250";
const DEPOSITED_BALANCE_WHOLE = "$6,165";
const DEPOSITED_BALANCE_CENTS = ".662512";

const COLOR_BADGE_GREEN = "#32B67C";
const COLOR_LABEL_DIM = "rgba(60, 60, 67, 0.6)";
const COLOR_BALANCE_DIM = "rgba(60, 60, 67, 0.4)";
const COLOR_WITHDRAW_BG = "#F5F5F5";

const TAB_BAR_RESERVED_HEIGHT = 96;

// Beat after the tab becomes visible before the demo starts, so it doesn't
// begin the instant the splash/lock overlays clear on cold start.
const ANIMATION_START_DELAY_MS = 1000;

// The delay only applies to the first reveal of the app session (cold start).
// Later navigations to the Earn tab replay immediately. Module-level so it
// survives any screen remount — navigation must never re-introduce the delay.
let hasRevealedSinceLaunch = false;

// How long after a demo play to "pop" the Deposit button — i.e. after the
// bubbles have typed and the mascot has tilted back + closed its eye (~4.4s).
const DEPOSIT_POP_DELAY_MS = 4600;

// Pre-deposit demo copy. Rendered as animated iMessage-style bubbles that slide
// in from the left and type their text one by one (see EarnBubbles).
const BUBBLES: BubbleData[] = [
  {
    widthPct: 62,
    segments: [
      { text: "You have " },
      { text: IDLE_AMOUNT, strong: true },
      { text: " sitting idle." },
    ],
  },
  {
    widthPct: 70,
    segments: [
      { text: "Let's start earning " },
      { text: APY_LABEL, strong: true },
    ],
  },
  {
    widthPct: 72,
    segments: [{ text: "Withdraw instantly, any time." }],
  },
];

export default function EarnScreen() {
  const insets = useSafeAreaInsets();
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [hasDeposit, setHasDeposit] = useState(false);
  // Bumped to (re)play the bubble + mascot demo.
  const [runId, setRunId] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const appReady = useAppReady();

  // Track focus, and reset to the pre-deposit state whenever the user leaves the
  // Earn tab so returning always replays the demo.
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => {
        setIsFocused(false);
        setHasDeposit(false);
      };
    }, []),
  );

  // Only (re)play once the tab is both focused AND actually visible — i.e. the
  // splash and wallet auth overlays are gone. Otherwise the animation runs
  // hidden during boot and the user lands mid-animation. The first reveal after
  // launch waits a beat (so it doesn't start the instant overlays clear); later
  // navigations play immediately.
  useEffect(() => {
    if (!(isFocused && appReady)) {
      return;
    }
    if (hasRevealedSinceLaunch) {
      setRunId((id) => id + 1);
      return;
    }
    const timer = setTimeout(() => {
      hasRevealedSinceLaunch = true;
      setRunId((id) => id + 1);
    }, ANIMATION_START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isFocused, appReady]);

  // Springy "pop" on the Deposit button once the demo has finished playing — an
  // attention nudge toward the next action. Fires after each pre-deposit demo.
  const depositScale = useSharedValue(1);
  const depositPopStyle = useAnimatedStyle(() => ({
    transform: [{ scale: depositScale.value }],
  }));

  useEffect(() => {
    cancelAnimation(depositScale);
    depositScale.value = 1;
    if (runId === 0 || hasDeposit) {
      return;
    }
    const timer = setTimeout(() => {
      depositScale.value = withRepeat(
        withSequence(
          withTiming(0.8, { duration: 110, easing: Easing.out(Easing.quad) }),
          // Loose, underdamped spring → overshoots to ~1.12 before settling.
          withSpring(1, { damping: 5, mass: 0.8, stiffness: 180 }),
        ),
        2,
        false,
      );
    }, DEPOSIT_POP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [runId, hasDeposit, depositScale]);

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
        <View style={styles.header}>
          <Text style={styles.title}>Earn</Text>
          <View style={styles.badge}>
            <EarnFlash width={12} height={16} />
            <Text style={styles.badgeText}>{APY_LABEL}</Text>
          </View>
        </View>

        {hasDeposit ? (
          <EarnChart />
        ) : (
          <View style={styles.initialContent}>
            <EarnBubbles bubbles={BUBBLES} runId={runId} />

            <View pointerEvents="none" style={styles.mascotWrap}>
              <EarnMascot runId={runId} width={300} height={252} />
            </View>
          </View>
        )}
      </View>

      <View
        style={[
          styles.bottomCard,
          { paddingBottom: TAB_BAR_RESERVED_HEIGHT + insets.bottom },
        ]}
      >
        <View style={styles.balanceRow}>
          <Text style={styles.balanceLabel}>Balance</Text>
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
          <Animated.View style={depositPopStyle}>
            <Pressable
              onPress={handleOpenDeposit}
              accessibilityRole="button"
              accessibilityLabel="Deposit"
              style={({ pressed }) => [
                styles.depositButton,
                { opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <View style={styles.iconWrap}>
                <Plus size={20} color="#FFF" strokeWidth={2.2} />
              </View>
              <Text style={styles.depositLabel}>Deposit</Text>
            </Pressable>
          </Animated.View>
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
    // No horizontal padding on the outer column — the chart needs the full
    // screen width and supplies its own internal padding. Header/bubbles/
    // mascot get their own 16px padding instead.
    flex: 1,
    position: "relative",
    overflow: "hidden",
  },
  initialContent: {
    flex: 1,
    paddingHorizontal: 16,
  },
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
  mascotWrap: {
    position: "absolute",
    right: -40,
    bottom: 0,
  },
  bottomCard: {
    backgroundColor: "#FFF",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 8,
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
