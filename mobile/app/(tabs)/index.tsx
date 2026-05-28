import * as Haptics from "expo-haptics";
import { useFocusEffect } from "expo-router";
import { ArrowUp, Plus } from "lucide-react-native";
import { useCallback, useState } from "react";
import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DepositSheet } from "@/components/earn/DepositSheet";
import { EarnChart } from "@/components/earn/EarnChart";
import { WithdrawSheet } from "@/components/earn/WithdrawSheet";
import { Pressable, Text, View } from "@/tw";

import EarnFlash from "../../assets/images/earn/flash.svg";
import EarnMascot from "../../assets/images/earn/mascot.svg";

const APY_LABEL = "8.46% APY";
const IDLE_AMOUNT = "$1,250";
const DEPOSITED_BALANCE_WHOLE = "$6,165";
const DEPOSITED_BALANCE_CENTS = ".662512";

const COLOR_BUBBLE_BG = "#E9E9EB";
const COLOR_BUBBLE_DIM = "rgba(0, 0, 0, 0.6)";
const COLOR_BADGE_GREEN = "#32B67C";
const COLOR_LABEL_DIM = "rgba(60, 60, 67, 0.6)";
const COLOR_BALANCE_DIM = "rgba(60, 60, 67, 0.4)";
const COLOR_WITHDRAW_BG = "#F5F5F5";

const TAB_BAR_RESERVED_HEIGHT = 96;

function Bubble({ children, widthPct }: { children: React.ReactNode; widthPct?: number }) {
  return (
    <View
      style={[
        styles.bubble,
        widthPct != null ? { alignSelf: "flex-start", maxWidth: `${widthPct}%` } : null,
      ]}
    >
      <Text style={styles.bubbleText}>{children}</Text>
    </View>
  );
}

export default function EarnScreen() {
  const insets = useSafeAreaInsets();
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [hasDeposit, setHasDeposit] = useState(false);

  // Reset to the pre-deposit state whenever the user leaves the Earn tab so
  // returning always replays the demo. Cleanup runs on blur, the body runs
  // on focus — we only need the cleanup.
  useFocusEffect(
    useCallback(() => {
      return () => {
        setHasDeposit(false);
      };
    }, []),
  );

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
            <View style={styles.bubbles}>
              <Bubble widthPct={62}>
                <Text style={styles.bubbleTextDim}>You have </Text>
                <Text style={styles.bubbleTextStrong}>{IDLE_AMOUNT}</Text>
                <Text style={styles.bubbleTextDim}> sitting idle.</Text>
              </Bubble>
              <Bubble widthPct={70}>
                <Text style={styles.bubbleTextDim}>{`Let's start earning `}</Text>
                <Text style={styles.bubbleTextStrong}>{APY_LABEL}</Text>
              </Bubble>
              <Bubble widthPct={72}>
                <Text style={styles.bubbleTextDim}>Withdraw instantly, any time.</Text>
              </Bubble>
            </View>

            <View pointerEvents="none" style={styles.mascotWrap}>
              <EarnMascot width={300} height={252} />
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
  bubbles: {
    marginTop: 18,
    gap: 12,
    alignItems: "flex-start",
  },
  bubble: {
    backgroundColor: COLOR_BUBBLE_BG,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderBottomRightRadius: 22,
    borderBottomLeftRadius: 9,
  },
  bubbleText: {
    fontFamily: "Geist_400Regular",
    fontSize: 24,
    lineHeight: 27,
    color: "#000",
    letterSpacing: -0.24,
  },
  bubbleTextDim: {
    fontFamily: "Geist_400Regular",
    fontSize: 24,
    lineHeight: 27,
    color: COLOR_BUBBLE_DIM,
    letterSpacing: -0.24,
  },
  bubbleTextStrong: {
    fontFamily: "Geist_400Regular",
    fontSize: 24,
    lineHeight: 27,
    color: "#000",
    letterSpacing: -0.24,
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
