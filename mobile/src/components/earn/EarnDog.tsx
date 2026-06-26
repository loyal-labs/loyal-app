import { useEffect } from "react";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from "react-native-svg";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedRect = Animated.createAnimatedComponent(Rect);

// Authored at 400×506 (full head). The head, snout shadow, white eye domes and
// nose are static; only the pupils (look direction) and the eyelids (blink)
// animate — all via leaf props (cx/cy/height), never <G> transforms, which
// crash react-native-svg on the New Architecture.
const VIEW_BOX = "0 0 400 506";
const HEAD = "M96 164L0 0V506H399.998V0L304 164H96Z";
const SNOUT = "M73 298H329L293.634 506H119.333L73 298Z";
const NOSE = "M248 382H215V415L185 416V382H156L133 341L267 338L248 382Z";
const DOME_LEFT =
  "M95 238C133.66 238 165 264.863 165 298H25C25 264.863 56.3401 238 95 238Z";
const DOME_RIGHT =
  "M305 238C343.66 238 375 264.863 375 298H235C235 264.863 266.34 238 305 238Z";

// Pupil rest position (straight) and the offsets to each look state, derived
// from Figma 3883-22658 (up) and 3883-22561 (left).
const PUPIL_R = 32;
const PUPIL_LEFT_X = 95;
const PUPIL_RIGHT_X = 305;
const PUPIL_BASE_Y = 291;
const LOOK_UP_DY = -46;
const LOOK_LEFT_DX = -21.38;
const LOOK_LEFT_DY = 9;

// White catch-light inside each pupil (Figma 219:78050/57 — the notification
// dog's eyes): a ~17px dot in the upper-right of each pupil. Offsets are from
// the pupil centre; it tracks the gaze so it reads as a glint.
const GLINT_R = 8.8;
const GLINT_DX = 18;
const GLINT_DY = -24;

// Eyelid covers each 140×60 dome from the top when blinking.
const DOME_TOP_Y = 238;
const DOME_HEIGHT = 60;

const ENTER_EASING = Easing.bezier(0.22, 1, 0.36, 1);

// Eye choreography. Roughly aligned with the screen's entrance (~1.15s): the
// gaze drifts up while the dog rises + the copy reveals, then settles straight
// and begins the idle look-around + blink loops.
const EYE_UP_MS = 560;
const EYE_UP_HOLD_MS = 1640;
const EYE_SETTLE_MS = 400;
const ENTRANCE_END_MS = EYE_UP_MS + EYE_UP_HOLD_MS + EYE_SETTLE_MS;

const LOOK_STRAIGHT_HOLD_MS = 2500;
const LOOK_LEFT_MS = 460;
const LOOK_LEFT_HOLD_MS = 950;
const LOOK_BACK_MS = 460;

const BLINK_START_DELAY_MS = ENTRANCE_END_MS + 1400;
const BLINK_INTERVAL_MS = 3600;
const BLINK_CLOSE_MS = 90;
const BLINK_OPEN_MS = 120;

export function EarnDog({
  runId,
  startDelay = 0,
  width,
  height,
  eyeGlint = false,
  blinkOnly = false,
}: {
  // Bumping runId replays the look-up entrance, then the idle loops resume.
  runId: number;
  // Delay (ms) before the gaze starts rising — kept in sync with the screen's
  // reveal delay so the eyes look up as the dog rises and the copy appears.
  startDelay?: number;
  width: number;
  height: number;
  // Show the white catch-light in each pupil (used on the Quests header).
  eyeGlint?: boolean;
  // Keep the gaze fixed straight ahead and only blink — no look-up entrance or
  // idle look-around (used on the completion notification).
  blinkOnly?: boolean;
}) {
  const lookUp = useSharedValue(0);
  const lookLeft = useSharedValue(0);
  const blink = useSharedValue(0);

  useEffect(() => {
    // runId 0 = pre-reveal idle: stay straight (the dog is sunk off-screen).
    if (runId === 0) {
      return;
    }

    cancelAnimation(lookUp);
    cancelAnimation(lookLeft);
    cancelAnimation(blink);
    lookUp.value = 0;
    lookLeft.value = 0;
    blink.value = 0;

    if (!blinkOnly) {
      // Gaze up during the reveal, hold, then settle back to straight.
      lookUp.value = withDelay(
        startDelay,
        withSequence(
          withTiming(1, { duration: EYE_UP_MS, easing: ENTER_EASING }),
          withDelay(
            EYE_UP_HOLD_MS,
            withTiming(0, { duration: EYE_SETTLE_MS, easing: ENTER_EASING }),
          ),
        ),
      );

      // Idle look-around: dwell straight, glance left, return — forever.
      lookLeft.value = withDelay(
        startDelay + ENTRANCE_END_MS + 200,
        withRepeat(
          withSequence(
            withDelay(
              LOOK_STRAIGHT_HOLD_MS,
              withTiming(1, { duration: LOOK_LEFT_MS, easing: ENTER_EASING }),
            ),
            withDelay(
              LOOK_LEFT_HOLD_MS,
              withTiming(0, { duration: LOOK_BACK_MS, easing: ENTER_EASING }),
            ),
          ),
          -1,
          false,
        ),
      );
    }

    // Blink loop. With blinkOnly the gaze never moves, so start the blink
    // sooner — there's no look-up entrance to wait out.
    const blinkStartDelay = blinkOnly
      ? startDelay + 1200
      : startDelay + BLINK_START_DELAY_MS;
    blink.value = withDelay(
      blinkStartDelay,
      withRepeat(
        withSequence(
          withDelay(
            BLINK_INTERVAL_MS,
            withTiming(1, {
              duration: BLINK_CLOSE_MS,
              easing: Easing.in(Easing.quad),
            }),
          ),
          withTiming(0, {
            duration: BLINK_OPEN_MS,
            easing: Easing.out(Easing.quad),
          }),
        ),
        -1,
        false,
      ),
    );

    return () => {
      cancelAnimation(lookUp);
      cancelAnimation(lookLeft);
      cancelAnimation(blink);
    };
  }, [runId, startDelay, blinkOnly, lookUp, lookLeft, blink]);

  const leftPupilProps = useAnimatedProps(() => ({
    cx: PUPIL_LEFT_X + lookLeft.value * LOOK_LEFT_DX,
    cy: PUPIL_BASE_Y + lookUp.value * LOOK_UP_DY + lookLeft.value * LOOK_LEFT_DY,
  }));
  const rightPupilProps = useAnimatedProps(() => ({
    cx: PUPIL_RIGHT_X + lookLeft.value * LOOK_LEFT_DX,
    cy: PUPIL_BASE_Y + lookUp.value * LOOK_UP_DY + lookLeft.value * LOOK_LEFT_DY,
  }));
  const lidProps = useAnimatedProps(() => ({ height: DOME_HEIGHT * blink.value }));
  const leftGlintProps = useAnimatedProps(() => ({
    cx: PUPIL_LEFT_X + lookLeft.value * LOOK_LEFT_DX + GLINT_DX,
    cy:
      PUPIL_BASE_Y +
      lookUp.value * LOOK_UP_DY +
      lookLeft.value * LOOK_LEFT_DY +
      GLINT_DY,
  }));
  const rightGlintProps = useAnimatedProps(() => ({
    cx: PUPIL_RIGHT_X + lookLeft.value * LOOK_LEFT_DX + GLINT_DX,
    cy:
      PUPIL_BASE_Y +
      lookUp.value * LOOK_UP_DY +
      lookLeft.value * LOOK_LEFT_DY +
      GLINT_DY,
  }));

  return (
    <Svg width={width} height={height} viewBox={VIEW_BOX} fill="none">
      <Defs>
        <LinearGradient
          id="dogSnout"
          x1="201"
          y1="298"
          x2="201"
          y2="506"
          gradientUnits="userSpaceOnUse"
        >
          <Stop offset="0" stopColor="#000" stopOpacity="0" />
          <Stop offset="0.36295" stopColor="#000" stopOpacity="1" />
        </LinearGradient>
        <ClipPath id="dogEyes">
          <Path d={DOME_LEFT} />
          <Path d={DOME_RIGHT} />
        </ClipPath>
      </Defs>
      <Path d={HEAD} fill="#F9363C" />
      <Path d={SNOUT} fill="url(#dogSnout)" fillOpacity={0.14} />
      <Path d={DOME_LEFT} fill="white" />
      <Path d={DOME_RIGHT} fill="white" />
      <G clipPath="url(#dogEyes)">
        <AnimatedCircle animatedProps={leftPupilProps} r={PUPIL_R} fill="black" />
        <AnimatedCircle
          animatedProps={rightPupilProps}
          r={PUPIL_R}
          fill="black"
        />
        {eyeGlint ? (
          <>
            <AnimatedCircle
              animatedProps={leftGlintProps}
              r={GLINT_R}
              fill="white"
            />
            <AnimatedCircle
              animatedProps={rightGlintProps}
              r={GLINT_R}
              fill="white"
            />
          </>
        ) : null}
        {/* Head-coloured eyelids sweep down from the dome top to blink. */}
        <AnimatedRect
          animatedProps={lidProps}
          x={25}
          y={DOME_TOP_Y}
          width={140}
          fill="#F9363C"
        />
        <AnimatedRect
          animatedProps={lidProps}
          x={235}
          y={DOME_TOP_Y}
          width={140}
          fill="#F9363C"
        />
      </G>
      <Path d={NOSE} fill="black" />
    </Svg>
  );
}
