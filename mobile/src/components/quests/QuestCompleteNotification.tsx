import { useEffect, useState } from "react";
import { Modal, StyleSheet, useWindowDimensions } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EarnDog } from "@/components/earn/EarnDog";
import { Pressable, Text, View } from "@/tw";

import PawPrint from "../../../assets/images/quests/paw_print.svg";
import SheetCurl from "../../../assets/images/quests/sheet_curl.svg";
import SnoutOverlap from "../../../assets/images/quests/snout_overlap.svg";

// The notification mirrors Figma 219-77891: a giant red dog over a dark
// backdrop, with a white panel that overlaps the dog's lower snout. Authored at
// a 400-wide artboard, so the dog metric scales with the screen width.
const DOG_HEAD_RATIO = 506 / 400;
const DOG_OVERLAP = 0.15; // fraction of the dog tucked behind the white panel
const REVEAL_DELAY_MS = 120;

// White panel anatomy (drives both the panel min-height and where the dog
// snout meets it). pt 48 + title 80 + gap 16 + subtitle 48 + gap 32 + button 50.
const PANEL_CONTENT = 48 + 80 + 16 + 48 + 32 + 50;
const PANEL_PB = 24;

export type QuestCompleteVariant = "single" | "all";

const COPY: Record<QuestCompleteVariant, { title: string; body: string; cta: string }> = {
  single: {
    title: "Task complete",
    body: "You completed a Seeker Season task",
    cta: "Next",
  },
  all: {
    title: "Quest complete!",
    body: "You completed all Seeker Season tasks",
    cta: "Great",
  },
};

export function QuestCompleteNotification({
  visible,
  variant,
  onClose,
}: {
  visible: boolean;
  variant: QuestCompleteVariant;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [runId, setRunId] = useState(0);

  const backdrop = useSharedValue(0);
  const panelY = useSharedValue(48);
  const dogY = useSharedValue(90);
  const dogScale = useSharedValue(0.86);

  useEffect(() => {
    if (!visible) return;
    setRunId((id) => id + 1);
    backdrop.value = 0;
    panelY.value = 48;
    dogY.value = 90;
    dogScale.value = 0.86;
    backdrop.value = withTiming(1, { duration: 220 });
    dogY.value = withDelay(
      REVEAL_DELAY_MS,
      withSpring(0, { damping: 13, stiffness: 180, mass: 0.7 }),
    );
    dogScale.value = withDelay(
      REVEAL_DELAY_MS,
      withSpring(1, { damping: 12, stiffness: 200, mass: 0.6 }),
    );
    panelY.value = withDelay(
      REVEAL_DELAY_MS + 40,
      withSpring(0, { damping: 16, stiffness: 190 }),
    );
  }, [visible, backdrop, panelY, dogY, dogScale]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));
  const dogStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dogY.value }, { scale: dogScale.value }],
  }));
  const panelStyle = useAnimatedStyle(() => ({
    opacity: backdrop.value,
    transform: [{ translateY: panelY.value }],
  }));

  const dogWidth = width;
  const dogHeight = Math.round(dogWidth * DOG_HEAD_RATIO);
  const panelMinHeight = PANEL_CONTENT + PANEL_PB + insets.bottom;
  const copy = COPY[variant];

  // Decorations scale with the 400-wide artboard.
  const scale = width / 400;
  const curlW = Math.round(78 * scale);
  const curlH = Math.round(100 * scale);
  const chinW = Math.round(204 * scale);
  const chinH = Math.round(22 * scale);

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1 }}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: "rgba(0,0,0,0.72)" },
            backdropStyle,
          ]}
        />

        {/* Giant red dog, snout tucked behind the panel. */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              left: 0,
              right: 0,
              bottom: panelMinHeight - Math.round(dogHeight * DOG_OVERLAP),
              alignItems: "center",
            },
            dogStyle,
          ]}
        >
          <EarnDog
            runId={runId}
            startDelay={REVEAL_DELAY_MS}
            width={dogWidth}
            height={dogHeight}
            eyeGlint
            blinkOnly
          />
        </Animated.View>

        {/* White panel with the completion copy. The top-right corner is
            square so the curl can define it; the dog's chin laps over the top. */}
        <Animated.View
          style={[
            {
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              minHeight: panelMinHeight,
              backgroundColor: "#fff",
              borderTopLeftRadius: 32,
              paddingTop: 48,
              paddingHorizontal: 20,
              paddingBottom: insets.bottom + PANEL_PB,
              overflow: "hidden",
            },
            panelStyle,
          ]}
        >
          {/* Curled top-right corner (red peeks where the sheet curls). */}
          <View
            pointerEvents="none"
            style={{ position: "absolute", top: 0, right: 0 }}
          >
            <SheetCurl width={curlW} height={curlH} />
          </View>
          {/* The dog's chin laps over the centre of the sheet's top edge. */}
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              alignItems: "center",
            }}
          >
            <SnoutOverlap width={chinW} height={chinH} />
          </View>

          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              right: 24,
              bottom: 86,
              width: 108,
              height: 105,
            }}
          >
            <PawPrint width={108} height={105} />
          </View>

          <Text
            style={{
              fontFamily: "Geist_700Bold",
              fontSize: 36,
              lineHeight: 40,
              letterSpacing: -0.72,
              textTransform: "uppercase",
              color: "#000",
              width: 254,
            }}
          >
            {copy.title}
          </Text>
          <Text
            style={{
              marginTop: 16,
              fontFamily: "Geist_400Regular",
              fontSize: 17,
              lineHeight: 22,
              color: "rgba(60,60,67,0.6)",
              width: 254,
            }}
          >
            {copy.body}
          </Text>

          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={copy.cta}
            style={{
              marginTop: 32,
              height: 50,
              borderRadius: 78,
              backgroundColor: "#000",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                fontFamily: "Geist_500Medium",
                fontSize: 17,
                lineHeight: 22,
                color: "#fff",
              }}
            >
              {copy.cta}
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}
