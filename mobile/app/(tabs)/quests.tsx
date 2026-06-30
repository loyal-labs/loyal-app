import { Redirect, useFocusEffect, useRouter } from "expo-router";
import { ChevronRight, Lock } from "lucide-react-native";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useWindowDimensions } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EarnDog } from "@/components/earn/EarnDog";
import { QUESTS_ENABLED } from "@/lib/feature-flags";
import {
  fetchSolanaWeekQuestProgress,
  type SolanaWeekQuestKind,
  type SolanaWeekQuestProgressItem,
  type SolanaWeekQuestStatus,
} from "@/lib/solana/earn/earn-api";
import { useWallet } from "@/lib/wallet/wallet-provider";
import { Pressable, Text, View } from "@/tw";

import AutodepositIcon from "../../assets/images/quests/autodeposit_icon_40.svg";
import CheckIcon from "../../assets/images/quests/check_64.svg";
import CoinIcon from "../../assets/images/quests/coin_58.svg";
import DepositIcon from "../../assets/images/quests/deposit_icon_40.svg";

// The Quests header mirrors Figma 219-56235 at a 400-wide artboard. We scale
// every dog/coin metric by (screenWidth / 400) so the framing holds on any
// device: black header 340 tall, the dog inset to 300 wide (≈75%, black
// margins), head dropped 32 from the top, coin balanced in the ear notch.
const ART_WIDTH = 400;
const DOG_HEAD_RATIO = 506 / 400;
const REVEAL_START_DELAY_MS = 500;
const DOG_RISE_MS = 800;
const ENTER_EASING = Easing.bezier(0.22, 1, 0.36, 1);

// The coin drops in from the top (independent of the dog) and lands with a
// small overshoot.
const COIN_DROP_DELAY_MS = REVEAL_START_DELAY_MS + 200;
const COIN_DROP_MS = 650;
const COIN_EASING = Easing.bezier(0.34, 1.56, 0.64, 1);

// Card face is 180×240 in the design (a 3:4 portrait).
const CARD_ASPECT = 180 / 240;

type TaskState = "active" | "locked" | "complete";

function statusOf(
  items: SolanaWeekQuestProgressItem[] | null,
  kind: SolanaWeekQuestKind,
): SolanaWeekQuestStatus {
  return items?.find((q) => q.kind === kind)?.status ?? "not_started";
}

function TaskCard({
  icon,
  title,
  state,
  onPress,
}: {
  icon: ReactNode;
  title: string;
  state: TaskState;
  onPress: () => void;
}) {
  const complete = state === "complete";
  const locked = state === "locked";

  const card = (
    <View
      style={{
        width: "100%",
        aspectRatio: CARD_ASPECT,
        borderRadius: 24,
        backgroundColor: "#f7f7f7",
        padding: 16,
        justifyContent: "space-between",
        overflow: "hidden",
      }}
    >
      {complete ? (
        <View style={{ gap: 4, alignItems: "center" }}>
          <View style={{ width: "100%", flexDirection: "row" }}>{icon}</View>
          <CheckIcon width={64} height={64} />
        </View>
      ) : locked ? (
        <View style={{ gap: 12 }}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "flex-start",
            }}
          >
            {icon}
            <Lock size={24} color="rgba(60,60,67,0.3)" strokeWidth={2} />
          </View>
          <Text
            style={{
              fontFamily: "Geist_500Medium",
              fontSize: 13,
              lineHeight: 16,
              color: "rgba(60,60,67,0.6)",
              width: 128,
            }}
          >
            Finish the previous task first
          </Text>
        </View>
      ) : (
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          {icon}
          <ChevronRight size={24} color="rgba(60,60,67,0.3)" strokeWidth={2} />
        </View>
      )}
      <Text
        style={{
          fontFamily: "Geist_500Medium",
          fontSize: 20,
          lineHeight: 22,
          color: complete ? "rgba(60,60,67,0.4)" : "#000",
        }}
      >
        {title}
      </Text>
    </View>
  );

  const inner =
    locked || complete ? (
      card
    ) : (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={title}
      >
        {card}
      </Pressable>
    );

  return <View style={{ flex: 1 }}>{inner}</View>;
}

export default function QuestsScreen() {
  // Hidden until the Seeker Season reveal. The tab is also deactivated in
  // TabBar; this guard catches any deep-link / programmatic navigation.
  // See docs/quests-launch-toggle.md.
  if (!QUESTS_ENABLED) {
    return <Redirect href="/(tabs)" />;
  }
  return <QuestsScreenContent />;
}

function QuestsScreenContent() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { publicKey } = useWallet();

  const [items, setItems] = useState<SolanaWeekQuestProgressItem[] | null>(null);
  const [runId, setRunId] = useState(0);

  const scale = width / ART_WIDTH;
  const dogAreaHeight = Math.round(340 * scale);
  const dogWidth = Math.round(300 * scale);
  const dogHeight = Math.round(dogWidth * DOG_HEAD_RATIO);
  const dogTop = Math.round(32 * scale);
  const coinWidth = Math.round(57.457 * scale);
  const coinHeight = Math.round(98.312 * scale);
  const coinTop = Math.round(10 * scale);
  // Dog rises from the bottom; the coin drops in from above (starts fully
  // off-screen over the top edge).
  const sink = Math.round(dogAreaHeight * 0.5);
  const riseY = useSharedValue(sink);
  const coinSlide = insets.top + coinTop + coinHeight + 20;
  const coinY = useSharedValue(-coinSlide);

  const load = useCallback(async () => {
    if (!publicKey) {
      setItems(null);
      return;
    }
    try {
      const res = await fetchSolanaWeekQuestProgress(publicKey);
      setItems(res.quests);
    } catch {
      // Keep the last good snapshot; the card states just won't advance.
    }
  }, [publicKey]);

  // Replay the reveal + refresh progress every time the tab gains focus.
  useFocusEffect(
    useCallback(() => {
      void load();
      setRunId((id) => id + 1);
      return () => {
        riseY.value = sink;
        coinY.value = -coinSlide;
      };
    }, [load, riseY, sink, coinY, coinSlide]),
  );

  useEffect(() => {
    if (runId === 0) return;
    cancelAnimation(riseY);
    cancelAnimation(coinY);
    riseY.value = sink;
    coinY.value = -coinSlide;
    riseY.value = withDelay(
      REVEAL_START_DELAY_MS,
      withTiming(0, { duration: DOG_RISE_MS, easing: ENTER_EASING }),
    );
    coinY.value = withDelay(
      COIN_DROP_DELAY_MS,
      withTiming(0, { duration: COIN_DROP_MS, easing: COIN_EASING }),
    );
    return () => {
      cancelAnimation(riseY);
      cancelAnimation(coinY);
    };
  }, [runId, riseY, sink, coinY, coinSlide]);

  const riseStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: riseY.value }],
  }));
  const coinStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: coinY.value }],
  }));

  const task1Complete = statusOf(items, "earn_deposit") === "reported";
  const task2Complete =
    statusOf(items, "first_autodeposit_sweep") === "reported";
  const allComplete = task1Complete && task2Complete;
  const task1State: TaskState = task1Complete ? "complete" : "active";
  const task2State: TaskState = task2Complete
    ? "complete"
    : task1Complete
      ? "active"
      : "locked";

  const openDeposit = useCallback(() => {
    router.navigate({ pathname: "/(tabs)", params: { open: "deposit" } });
  }, [router]);
  const openAutodeposit = useCallback(() => {
    router.navigate({ pathname: "/(tabs)", params: { open: "autodeposit" } });
  }, [router]);

  return (
    <View className="flex-1" style={{ backgroundColor: "#000" }}>
      {/* Dog header */}
      <View
        style={{
          height: insets.top + dogAreaHeight,
          backgroundColor: "#000",
          overflow: "hidden",
        }}
      >
        {/* Dog rises from the bottom. */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              left: 0,
              right: 0,
              top: insets.top + dogTop,
              alignItems: "center",
            },
            riseStyle,
          ]}
        >
          <EarnDog
            runId={runId}
            startDelay={REVEAL_START_DELAY_MS}
            width={dogWidth}
            height={dogHeight}
            eyeGlint
          />
        </Animated.View>
        {/* Coin drops in from the top. */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              left: 0,
              right: 0,
              top: insets.top + coinTop,
              alignItems: "center",
            },
            coinStyle,
          ]}
        >
          <CoinIcon width={coinWidth} height={coinHeight} />
        </Animated.View>
      </View>

      {/* Tasks */}
      <View className="flex-1" style={{ backgroundColor: "#fff" }}>
        <View style={{ paddingTop: 32, paddingHorizontal: 16 }}>
          <Text
            style={{
              fontFamily: "Geist_600SemiBold",
              fontSize: 36,
              lineHeight: 40,
              letterSpacing: -0.72,
              color: "#000",
            }}
          >
            {allComplete ? "All tasks\ncompleted" : "Complete tasks.\nGet rewards"}
          </Text>
        </View>

        <View style={{ flex: 1 }} />

        <View
          className="flex-row"
          style={{
            gap: 8,
            paddingHorizontal: 16,
            paddingBottom: insets.bottom + 84,
            alignItems: "flex-end",
          }}
        >
          <TaskCard
            icon={<DepositIcon width={40} height={40} />}
            title="Deposit $10 to Earn with Seeker Wallet"
            state={task1State}
            onPress={openDeposit}
          />
          <TaskCard
            icon={<AutodepositIcon width={40} height={40} />}
            title="Set up Autodeposit and let it make its first deposit"
            state={task2State}
            onPress={openAutodeposit}
          />
        </View>
      </View>
    </View>
  );
}
