import { useEffect, useState } from "react";
import { Modal, StyleSheet, useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DogNose, EarnDog } from "@/components/earn/EarnDog";
import { Pressable, Text, View } from "@/tw";

import PawPrint from "../../../assets/images/quests/paw_print.svg";
import SheetCurl from "../../../assets/images/quests/sheet_curl.svg";
import Snout from "../../../assets/images/quests/snout.svg";

// The notification mirrors Figma 219-78039: a giant red dog over a dark
// backdrop, with a white panel that overlaps the dog's lower snout. Authored at
// a 400-wide artboard, so the dog metric scales with the screen width.
const DOG_HEAD_RATIO = 506 / 400;
// Fraction of the dog tucked behind the white panel. Sized so the panel's top
// edge sits above the snout chin (~y438 in the artboard), letting the snout lap
// over the panel; bump this to make the snout dip further onto the card.
const DOG_OVERLAP = 0.2;
const REVEAL_DELAY_MS = 120;

// White panel anatomy (drives both the panel min-height and where the dog
// snout meets it). pt 72 + title 80 + gap 16 + subtitle 48 + gap 48 + button 50.
const BUTTON_HEIGHT = 50;
const PANEL_PT = 72;
const PANEL_CONTENT = PANEL_PT + 80 + 16 + 48 + 48 + BUTTON_HEIGHT;
const PANEL_PB = 40;

// The paw is stamped onto the card after the slide-in spring has settled (~120ms
// delay + ~540ms spring), so it reads as a distinct beat — the sheet lands, then
// the paw presses down.
const PAW_STAMP_DELAY_MS = REVEAL_DELAY_MS + 540;

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

  const dogWidth = width;
  const dogHeight = Math.round(dogWidth * DOG_HEAD_RATIO);
  // Pixels of the dog tucked behind the white panel — shared by the dog's
  // placement and the snout overlay so they stay in exact registration.
  const dogTuck = Math.round(dogHeight * DOG_OVERLAP);
  const panelMinHeight = PANEL_CONTENT + PANEL_PB + insets.bottom;
  // Distance the composed sheet travels: its full visible height, so it starts
  // with the dog's ears just below the screen edge and slides all the way up.
  const sheetTravel = panelMinHeight + dogHeight - dogTuck;

  const backdrop = useSharedValue(0);
  const sheetY = useSharedValue(sheetTravel);
  const pawScale = useSharedValue(1.5);
  const pawOpacity = useSharedValue(0);

  useEffect(() => {
    // Park the sheet off-screen whenever it's hidden, so the next open paints
    // from the hidden state instead of flashing the previous open's last frame.
    if (!visible) {
      backdrop.value = 0;
      sheetY.value = sheetTravel;
      pawScale.value = 1.5;
      pawOpacity.value = 0;
      return;
    }
    setRunId((id) => id + 1);
    backdrop.value = 0;
    sheetY.value = sheetTravel;
    pawScale.value = 1.5;
    pawOpacity.value = 0;

    backdrop.value = withTiming(1, { duration: 240 });
    // Dog + card are one unit now: a single slide up from the bottom keeps the
    // snout/curl seam stable instead of drifting on independent springs.
    sheetY.value = withDelay(
      REVEAL_DELAY_MS,
      withSpring(0, { damping: 26, stiffness: 170, mass: 1 }),
    );
    // Stamp the paw: appears larger, then a stiff spring slams it down to size.
    pawOpacity.value = withDelay(
      PAW_STAMP_DELAY_MS,
      withTiming(1, { duration: 80, easing: Easing.out(Easing.quad) }),
    );
    pawScale.value = withDelay(
      PAW_STAMP_DELAY_MS,
      withSpring(1, { damping: 13, stiffness: 300, mass: 0.7 }),
    );
  }, [visible, sheetTravel, backdrop, sheetY, pawScale, pawOpacity]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetY.value }],
  }));
  const pawStyle = useAnimatedStyle(() => ({
    opacity: pawOpacity.value,
    transform: [{ scale: pawScale.value }],
  }));

  const copy = COPY[variant];

  // Decorations scale with the 400-wide artboard.
  const scale = width / 400;
  const curlW = Math.round(78 * scale);
  const curlH = Math.round(100 * scale);
  // The snout (Figma 219-78044) is 255×140, anchored at the dog's snout shoulder
  // (y298, where the snout is exactly 255 wide) and horizontally centred.
  const snoutW = Math.round(255 * scale);
  const snoutH = Math.round(140 * scale);
  const snoutTop = Math.round(298 * scale);
  const snoutLeft = Math.round((dogWidth - snoutW) / 2);
  // Sit the paw clear above the CTA (panel bottom pad + button + a 24px gap).
  const pawBottom = insets.bottom + PANEL_PB + BUTTON_HEIGHT + 24;

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

        {/* The whole sheet — giant red dog + white card — slides up from the
            bottom as one unit, so the snout/curl seam never drifts. */}
        <Animated.View
          pointerEvents="box-none"
          style={[StyleSheet.absoluteFill, sheetStyle]}
        >
          {/* Giant red dog, snout tucked behind the panel. */}
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: panelMinHeight - dogTuck,
              alignItems: "center",
            }}
          >
            <EarnDog
              runId={runId}
              startDelay={REVEAL_DELAY_MS}
              width={dogWidth}
              height={dogHeight}
              eyeGlint
              blinkOnly
            />
          </View>

          {/* White panel with the completion copy. Both top corners are square
              (the curl defines the top-right); the dog's snout laps over the top. */}
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              minHeight: panelMinHeight,
              backgroundColor: "#fff",
              paddingTop: PANEL_PT,
              paddingHorizontal: 20,
              paddingBottom: insets.bottom + PANEL_PB,
              overflow: "hidden",
            }}
          >
            {/* Curled top-right corner (red peeks where the sheet curls). */}
            <View
              pointerEvents="none"
              style={{ position: "absolute", top: 0, right: 0 }}
            >
              <SheetCurl width={curlW} height={curlH} />
            </View>
            {/* Paw, stamped onto the card. */}
            <Animated.View
              pointerEvents="none"
              style={[
                {
                  position: "absolute",
                  right: 24,
                  bottom: pawBottom,
                  width: 108,
                  height: 105,
                },
                pawStyle,
              ]}
            >
              <PawPrint width={108} height={105} />
            </Animated.View>

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
                width: 210,
              }}
            >
              {copy.body}
            </Text>

            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={copy.cta}
              style={{
                marginTop: 48,
                height: BUTTON_HEIGHT,
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
          </View>

          {/* Snout + nose drawn ON TOP of the panel: the snout laps its chin
              over the panel's top edge, the nose sits on the snout. Both live in
              the dog's frame (same box as the dog) so they register exactly with
              the face behind the panel. */}
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: panelMinHeight - dogTuck,
              height: dogHeight,
            }}
          >
            <View
              style={{
                position: "absolute",
                top: snoutTop,
                left: snoutLeft,
                width: snoutW,
                height: snoutH,
              }}
            >
              <Snout width={snoutW} height={snoutH} />
            </View>
            <DogNose width={dogWidth} height={dogHeight} />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
