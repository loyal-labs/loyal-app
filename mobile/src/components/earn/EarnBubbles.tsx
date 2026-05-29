import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

export type BubbleSegment = { text: string; strong?: boolean };
export type BubbleData = { segments: BubbleSegment[]; widthPct: number };

const COLOR_BUBBLE_BG = "#E9E9EB";
const COLOR_BUBBLE_DIM = "rgba(0, 0, 0, 0.6)";
const COLOR_BUBBLE_STRONG = "#000";

// Choreography constants — tuned for an iMessage-style "composing" cadence.
// Each bubble slides in from the left, settles, then types its text. The next
// bubble only begins once the previous one finishes typing ("one by one").
const SLIDE_DISTANCE = 28; // px the bubble travels in from the left
const SLIDE_DURATION_MS = 420;
const PER_CHAR_MS = 26; // typing speed
const TYPE_LEAD_MS = 260; // delay from slide-start to first typed character
const GAP_MS = 140; // pause after a bubble finishes before the next slides in
const INITIAL_DELAY_MS = 120; // beat before the first bubble appears

// Matches the `line-by-line-slide` spec signature easing.
const ENTER_EASING = Easing.bezier(0.22, 1, 0.36, 1);

type TimedBubble = BubbleData & {
  chars: number;
  enterDelay: number;
  typeStart: number;
};

function totalChars(segments: BubbleSegment[]): number {
  return segments.reduce((sum, segment) => sum + segment.text.length, 0);
}

// Reveal `chars` characters one at a time, starting after `startDelay`.
// Restarts whenever `runId` changes so the demo replays on each tab focus.
function useTypewriter(
  chars: number,
  startDelay: number,
  runId: number,
): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(0);
    // runId 0 = pre-visible idle state: keep the text empty until the tab shows.
    if (runId === 0) {
      return;
    }
    let current = 0;
    let interval: ReturnType<typeof setInterval> | undefined;

    const start = setTimeout(() => {
      interval = setInterval(() => {
        current += 1;
        setCount(current);
        if (current >= chars && interval) {
          clearInterval(interval);
        }
      }, PER_CHAR_MS);
    }, startDelay);

    return () => {
      clearTimeout(start);
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [chars, startDelay, runId]);

  return count;
}

// Renders the bubble copy with a typewriter reveal. A transparent "ghost" copy
// of the full text reserves the bubble's final size so it never reflows while
// characters fill in; the typed text is overlaid exactly on top of it.
//
// Raw react-native Text/View are used here (not the `@/tw` CSS wrappers) so the
// per-character re-renders stay cheap and don't glitch through the CSS engine.
function BubbleText({
  segments,
  visible,
}: {
  segments: BubbleSegment[];
  visible: number;
}) {
  const fullText = useMemo(
    () => segments.map((segment) => segment.text).join(""),
    [segments],
  );
  const offsets = useMemo(() => {
    const result: number[] = [];
    let running = 0;
    for (const segment of segments) {
      result.push(running);
      running += segment.text.length;
    }
    return result;
  }, [segments]);

  return (
    <View>
      <Text style={[styles.bubbleText, styles.ghost]}>{fullText}</Text>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Text style={styles.bubbleText}>
          {segments.map((segment, index) => {
            const shown = Math.max(
              0,
              Math.min(visible - offsets[index], segment.text.length),
            );
            return (
              <Text
                key={index}
                style={segment.strong ? styles.strong : styles.dim}
              >
                {segment.text.slice(0, shown)}
              </Text>
            );
          })}
        </Text>
      </View>
    </View>
  );
}

function AnimatedBubble({
  bubble,
  runId,
}: {
  bubble: TimedBubble;
  runId: number;
}) {
  const translateX = useSharedValue(-SLIDE_DISTANCE);
  const opacity = useSharedValue(0);

  useEffect(() => {
    // runId 0 = pre-visible idle state: stay hidden until the tab is on screen.
    if (runId === 0) {
      return;
    }
    translateX.value = -SLIDE_DISTANCE;
    opacity.value = 0;
    translateX.value = withDelay(
      bubble.enterDelay,
      withTiming(0, { duration: SLIDE_DURATION_MS, easing: ENTER_EASING }),
    );
    opacity.value = withDelay(
      bubble.enterDelay,
      withTiming(1, { duration: SLIDE_DURATION_MS, easing: ENTER_EASING }),
    );

    return () => {
      cancelAnimation(translateX);
      cancelAnimation(opacity);
    };
  }, [bubble.enterDelay, runId, translateX, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }],
  }));

  const visible = useTypewriter(bubble.chars, bubble.typeStart, runId);

  return (
    <Animated.View
      style={[styles.bubble, { maxWidth: `${bubble.widthPct}%` }, animatedStyle]}
    >
      <BubbleText segments={bubble.segments} visible={visible} />
    </Animated.View>
  );
}

export function EarnBubbles({
  bubbles,
  runId,
}: {
  bubbles: BubbleData[];
  runId: number;
}) {
  const timed = useMemo<TimedBubble[]>(() => {
    let cursor = INITIAL_DELAY_MS;
    return bubbles.map((bubble) => {
      const chars = totalChars(bubble.segments);
      const enterDelay = cursor;
      const typeStart = enterDelay + TYPE_LEAD_MS;
      cursor = typeStart + chars * PER_CHAR_MS + GAP_MS;
      return { ...bubble, chars, enterDelay, typeStart };
    });
  }, [bubbles]);

  return (
    <View style={styles.bubbles}>
      {timed.map((bubble, index) => (
        <AnimatedBubble key={index} bubble={bubble} runId={runId} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bubbles: {
    marginTop: 18,
    gap: 12,
    alignItems: "flex-start",
  },
  bubble: {
    alignSelf: "flex-start",
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
    color: COLOR_BUBBLE_STRONG,
    letterSpacing: -0.24,
  },
  ghost: {
    opacity: 0,
  },
  dim: {
    color: COLOR_BUBBLE_DIM,
  },
  strong: {
    color: COLOR_BUBBLE_STRONG,
  },
});
