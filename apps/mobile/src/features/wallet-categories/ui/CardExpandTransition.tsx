import { useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import type { GestureType } from "react-native-gesture-handler";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import type { CardRect } from "../routes";

const CARD_RADIUS = 24;
const OPEN_MS = 440;
const CLOSE_MS = 260;
// The root's window offset (status bar / insets) is constant for the app, so
// cache it across opens: the first open measures it; every open after starts
// already positioned, with no measurement delay.
let cachedOrigin: { x: number; y: number } | null = null;
// Cross-fade windows in box `progress` space (0 = card, 1 = full screen), kept
// disjoint so the card "face" and the page are never both visible at once.
const FACE_FADE: [number, number] = [0, 0.22];
const CONTENT_FADE: [number, number] = [0.5, 0.85];
// How far you must drag down to fully collapse, and the release threshold.
const DRAG_FACTOR = 0.45;
const DISMISS_DISTANCE = 130;
const DISMISS_VELOCITY = 900;

type Children = ReactNode | ((api: { close: () => void }) => ReactNode);

// Morphs a destination screen out of (and back into) the card the user tapped.
// A single `progress` value (0 = card, 1 = full screen) drives a box from the
// source rect to the whole window — straightening corners, fading gray→white —
// while the card "face" cross-fades out and the page cross-fades in.
//
// The box lands exactly on the real card (offset-corrected) and is opaque, so it
// covers the real card behind it — no need to hide the source card, and the real
// card simply fills the brief pre-measurement gap on open. Without a `sourceRect`
// (deep link) it just renders the page full size.
export function CardExpandTransition({
  sourceRect,
  cardColor,
  face,
  scrollOffset,
  scrollGesture,
  children,
}: {
  sourceRect?: CardRect;
  cardColor: string;
  /** Collapsed card contents, shown at the start/end of the morph. */
  face?: ReactNode;
  /** Inner scroll position, so swipe-to-dismiss only engages at the top. */
  scrollOffset?: SharedValue<number>;
  /** The inner scroll view's native gesture, for simultaneous recognition. */
  scrollGesture?: GestureType;
  children: Children;
}) {
  const router = useRouter();
  const navigation = useNavigation();
  const { width: W, height: H } = useWindowDimensions();

  const progress = useSharedValue(sourceRect ? 0 : 1);
  // Guards against re-entrancy: once we start collapsing, the `beforeRemove`
  // listener must let the eventual `router.back()` through.
  const closingRef = useRef(false);
  const openedRef = useRef(false);

  // The source rect is in window coordinates (measureInWindow), but the box is
  // positioned inside this screen's root — which may not sit at the window origin
  // (status bar / safe-area insets). Measuring the root the SAME way lets us
  // subtract that offset so the box lands exactly on the real card. The morph
  // waits until this is known so it never animates from a wrong position.
  const rootRef = useRef<View>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(
    sourceRect ? cachedOrigin : { x: 0, y: 0 },
  );
  const handleRootLayout = useCallback(() => {
    rootRef.current?.measureInWindow((x, y) => {
      cachedOrigin = { x, y };
      setOrigin((prev) => prev ?? { x, y });
    });
  }, []);

  const sx = sourceRect?.x ?? 0;
  const sy = sourceRect?.y ?? 0;
  const sw = sourceRect?.width ?? W;
  const sh = sourceRect?.height ?? H;

  const finishClose = useCallback(() => {
    router.back();
  }, [router]);

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (!sourceRect) {
      router.back();
      return;
    }
    progress.value = withTiming(
      0,
      { duration: CLOSE_MS, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(finishClose)();
      },
    );
  }, [sourceRect, router, finishClose, progress]);

  // Open animation — starts once the root offset is measured, so the expand
  // begins exactly from the real card position. `inOut` easing reads as a
  // deliberate expand rather than a pop.
  useEffect(() => {
    if (sourceRect && origin && !openedRef.current) {
      openedRef.current = true;
      progress.value = withTiming(1, {
        duration: OPEN_MS,
        easing: Easing.inOut(Easing.cubic),
      });
    }
  }, [sourceRect, origin, progress]);

  // Play the collapse for every dismissal path (header back button, hardware
  // back) by intercepting the navigation removal and re-issuing it once the
  // animation has finished.
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (e) => {
      if (closingRef.current) return;
      e.preventDefault();
      close();
    });
    return unsubscribe;
  }, [navigation, close]);

  const pan = useMemo(() => {
    let gesture = Gesture.Pan()
      .enabled(!!sourceRect)
      .activeOffsetY(14)
      .failOffsetY(-14)
      .onUpdate((e) => {
        if (scrollOffset && scrollOffset.value > 0) return;
        if (e.translationY <= 0) return;
        progress.value = Math.min(
          1,
          Math.max(0, 1 - e.translationY / (H * DRAG_FACTOR)),
        );
      })
      .onEnd((e) => {
        if (scrollOffset && scrollOffset.value > 0) return;
        if (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) {
          runOnJS(close)();
        } else {
          progress.value = withTiming(1, { duration: 180 });
        }
      });
    if (scrollGesture) {
      gesture = gesture.simultaneousWithExternalGesture(scrollGesture);
    }
    return gesture;
  }, [sourceRect, H, scrollOffset, scrollGesture, close, progress]);

  const boxStyle = useAnimatedStyle(() => {
    const p = progress.value;
    // Card end: subtract the root's own window offset so the window-space card
    // rect lands exactly on the real card inside this root. Full-screen end:
    // (0,0) to fill the root.
    const ox = origin?.x ?? 0;
    const oy = origin?.y ?? 0;
    return {
      left: interpolate(p, [0, 1], [sx - ox, 0]),
      top: interpolate(p, [0, 1], [sy - oy, 0]),
      width: interpolate(p, [0, 1], [sw, W]),
      height: interpolate(p, [0, 1], [sh, H]),
      borderRadius: interpolate(p, [0, 1], [CARD_RADIUS, 0]),
      backgroundColor: interpolateColor(p, [0, 1], [cardColor, "#FFFFFF"]),
    };
  });

  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, CONTENT_FADE, [0, 1], Extrapolation.CLAMP),
  }));

  const faceStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, FACE_FADE, [1, 0], Extrapolation.CLAMP),
  }));

  const rendered =
    typeof children === "function" ? children({ close }) : children;

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.root}>
        {/* Measures this root's window position so the box can correct for any
            status-bar / inset offset. pointerEvents none — measurement only. */}
        <View
          ref={rootRef}
          onLayout={handleRootLayout}
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        />
        {origin ? (
          <Animated.View style={[styles.box, boxStyle]}>
            <Animated.View
              style={[styles.content, { width: W, height: H }, contentStyle]}
            >
              {rendered}
            </Animated.View>
            {sourceRect && face ? (
              <Animated.View
                pointerEvents="none"
                style={[styles.face, { width: sw, height: sh }, faceStyle]}
              >
                {face}
              </Animated.View>
            ) : null}
          </Animated.View>
        ) : null}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  box: { position: "absolute", overflow: "hidden" },
  content: { position: "absolute", left: 0, top: 0 },
  face: {
    position: "absolute",
    left: 0,
    top: 0,
    padding: 16,
    justifyContent: "space-between",
  },
});
