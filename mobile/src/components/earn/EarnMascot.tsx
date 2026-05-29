import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, G, Mask, Path } from "react-native-svg";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

const VIEW_BOX = "0 0 288.522 242.789";

// Head enters from the right in sync with the first bubble (EarnBubbles uses the
// same 120ms initial delay), then tilts slightly up to "look" at the bubbles.
const HEAD_FROM_X = 90; // px off to the right before sliding in
const HEAD_ENTER_DELAY = 120;
const HEAD_ENTER_DURATION = 440;
const TILT_DELAY = HEAD_ENTER_DELAY + HEAD_ENTER_DURATION - 80;
const TILT_DURATION = 520;
const TILT_DEGREES = 7; // positive = tilt up toward the bubbles (flip to adjust)
const ENTER_EASING = Easing.bezier(0.22, 1, 0.36, 1);

// Pupil rest position (from the source SVG) and its "reading" motion. Values are
// in SVG user units; the eye-white mask clips anything that drifts past it.
const PUPIL_CX = 164.429;
const PUPIL_CY = 147.015;
const PUPIL_R = 19.1996;
const EYE_START = 560; // begins once the head has roughly settled
const EYE_X_LINE_START = -20; // far left — start of a line, toward the bubbles
const EYE_X_LINE_END = -10; // panned right — end of a line (still left-of-center)
const EYE_SACCADE_MS = 180; // quick jump back to the start of the next line
const EYE_READ_MS = 760; // smooth pan while "reading" a line
const EYE_LOOK_MS = 220; // vertical glance to the next bubble
const EYE_HOLD_MS = 700; // dwell on a line before dropping down
// Bubbles sit well above the eye, so the gaze stays up throughout (negative cy
// = up). It drifts down slightly as it follows the bubbles top -> bottom, but
// never looks below the resting position.
const EYE_Y_TOP = -15; // top bubble (most up)
const EYE_Y_MID = -12; // middle bubble
const EYE_Y_BOTTOM = -9; // bottom bubble
const EYE_RETURN_MS = 320; // settle the gaze back to center before closing

// After reading, the head tilts back to upright and the eye morphs to the
// "closed" head (per Figma 3755-16782): the open eye (white + pupil) fades out
// and a rounded black arch fades in over the same spot via a plain opacity
// crossfade. The rest of the head is identical. (Opacity is animated on the leaf
// Path/Circle elements — animating a <G> transform crashes react-native-svg on
// the New Architecture.)
const TILT_HOLD_MS = 2500; // dwell tilted-up while reading, then return
const TILT_BACK_MS = 480;
const CLOSE_DELAY = 4000; // absolute from sequence start (after tilt settles)
const CLOSE_MS = 360;

// Closed-eye arch, centered over the open eye's region (x ~158, y ~135).
const CLOSED_EYE_ARC = "M132 146 C 140 125, 176 125, 184 146";
const CLOSED_EYE_STROKE = 9;

export function EarnMascot({
  runId,
  width = 300,
  height = 252,
}: {
  runId: number;
  width?: number;
  height?: number;
}) {
  const headX = useSharedValue(HEAD_FROM_X);
  const headOpacity = useSharedValue(0);
  const tilt = useSharedValue(0);
  const eyeX = useSharedValue(0);
  const eyeY = useSharedValue(0);
  const closeProgress = useSharedValue(0);

  useEffect(() => {
    // runId 0 = pre-visible idle state: stay hidden (off-screen, opacity 0) until
    // the tab is actually on screen, so the demo never plays behind the splash.
    if (runId === 0) {
      return;
    }

    headX.value = HEAD_FROM_X;
    headOpacity.value = 0;
    tilt.value = 0;
    eyeX.value = 0;
    eyeY.value = 0;
    closeProgress.value = 0;

    // Slide in from the right alongside the first bubble.
    headX.value = withDelay(
      HEAD_ENTER_DELAY,
      withTiming(0, { duration: HEAD_ENTER_DURATION, easing: ENTER_EASING }),
    );
    headOpacity.value = withDelay(
      HEAD_ENTER_DELAY,
      withTiming(1, { duration: Math.round(HEAD_ENTER_DURATION * 0.6) }),
    );

    // Tilt up toward the bubbles, hold while reading, then tilt back to upright.
    tilt.value = withSequence(
      withDelay(
        TILT_DELAY,
        withTiming(TILT_DEGREES, {
          duration: TILT_DURATION,
          easing: ENTER_EASING,
        }),
      ),
      withDelay(
        TILT_HOLD_MS,
        withTiming(0, { duration: TILT_BACK_MS, easing: ENTER_EASING }),
      ),
    );

    // Eye "reads" the bubbles (jump to each line's start, pan right, drop down),
    // then returns to center as the head settles back.
    eyeX.value = withDelay(
      EYE_START,
      withSequence(
        withTiming(EYE_X_LINE_START, { duration: EYE_SACCADE_MS }),
        withTiming(EYE_X_LINE_END, { duration: EYE_READ_MS }),
        withTiming(EYE_X_LINE_START, { duration: EYE_SACCADE_MS }),
        withTiming(EYE_X_LINE_END, { duration: EYE_READ_MS }),
        withTiming(EYE_X_LINE_START, { duration: EYE_SACCADE_MS }),
        withTiming(EYE_X_LINE_END, { duration: EYE_READ_MS }),
        withTiming(0, { duration: EYE_RETURN_MS }),
      ),
    );
    eyeY.value = withDelay(
      EYE_START,
      withSequence(
        withTiming(EYE_Y_TOP, { duration: EYE_LOOK_MS }),
        withDelay(EYE_HOLD_MS, withTiming(EYE_Y_MID, { duration: EYE_LOOK_MS })),
        withDelay(
          EYE_HOLD_MS,
          withTiming(EYE_Y_BOTTOM, { duration: EYE_LOOK_MS }),
        ),
        withTiming(0, { duration: EYE_RETURN_MS }),
      ),
    );

    // Morph to the closed-eye head once the head is back upright.
    closeProgress.value = withDelay(
      CLOSE_DELAY,
      withTiming(1, { duration: CLOSE_MS, easing: ENTER_EASING }),
    );

    return () => {
      cancelAnimation(headX);
      cancelAnimation(headOpacity);
      cancelAnimation(tilt);
      cancelAnimation(eyeX);
      cancelAnimation(eyeY);
      cancelAnimation(closeProgress);
    };
  }, [runId, headX, headOpacity, tilt, eyeX, eyeY, closeProgress]);

  const headStyle = useAnimatedStyle(() => ({
    opacity: headOpacity.value,
    transform: [{ translateX: headX.value }, { rotate: `${tilt.value}deg` }],
  }));

  const pupilProps = useAnimatedProps(() => ({
    cx: PUPIL_CX + eyeX.value,
    cy: PUPIL_CY + eyeY.value,
    opacity: 1 - closeProgress.value,
  }));

  const openEyeProps = useAnimatedProps(() => ({
    opacity: 1 - closeProgress.value,
  }));

  const closedEyeProps = useAnimatedProps(() => ({
    opacity: closeProgress.value,
  }));

  return (
    <Animated.View style={[styles.wrap, headStyle]}>
      <Svg width={width} height={height} viewBox={VIEW_BOX} fill="none">
        <Path
          d="M46.7488 214.345L0 99.5537H127.998V0L184.885 99.5537L199.107 0L288.522 242.789L46.7488 214.345Z"
          fill="#F9363C"
        />
        <Path
          d="M172.405 173.566L182.999 208.395L39.241 195.91L23.4176 157.055L172.405 173.566Z"
          fill="white"
        />
        <Mask
          id="mascotTeeth"
          maskUnits="userSpaceOnUse"
          x={23}
          y={157}
          width={160}
          height={52}
        >
          <Path
            d="M172.405 173.566L182.999 208.395L39.241 195.91L23.4176 157.055L172.405 173.566Z"
            fill="white"
          />
        </Mask>
        <G mask="url(#mascotTeeth)">
          <Path
            d="M33.0517 183.202L57.6342 172.602L87.822 190.169L109.812 179.417L148.389 196.493L180.672 183.543"
            stroke="black"
            strokeWidth={8.53317}
          />
        </G>
        <Mask
          id="mascotEye"
          maskUnits="userSpaceOnUse"
          x={114}
          y={114}
          width={86}
          height={40}
        >
          <Path
            d="M159.171 114.649C182.702 115.882 200.912 133.414 199.843 153.808L114.628 149.342C115.697 128.949 135.64 113.416 159.171 114.649Z"
            fill="white"
          />
        </Mask>
        {/* Open eye (white + tracking pupil) — fades out as it closes. */}
        <AnimatedPath
          animatedProps={openEyeProps}
          d="M159.171 114.649C182.702 115.882 200.912 133.414 199.843 153.808L114.628 149.342C115.697 128.948 135.639 113.416 159.171 114.649Z"
          fill="white"
        />
        <G mask="url(#mascotEye)">
          <AnimatedCircle animatedProps={pupilProps} r={PUPIL_R} fill="black" />
        </G>
        {/* Closed eye (arch) — fades in to form the closed-eye head. */}
        <AnimatedPath
          animatedProps={closedEyeProps}
          d={CLOSED_EYE_ARC}
          stroke="black"
          strokeWidth={CLOSED_EYE_STROKE}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    // Pivot the tilt near the base of the head so it reads as "looking up".
    transformOrigin: "50% 82%",
  },
});
