import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Shield,
  ShieldOff,
  Trophy,
  X,
} from "lucide-react-native";
import {
  type ComponentRef,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { BackHandler, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Pressable, Text } from "@/tw";

// Full-screen frosted "..." action menu (Figma 195:34783 / overlay 195:34942).
// The frosted layer slides up to fill the screen (directional, not a fade); the
// rows reveal bottom-to-top and reverse on close, all driven by one shared
// `progress` value so the animation is interruptible. The "✕" close button is
// anchored to the trigger's measured position so it lands exactly where "..."
// was. Rendered inline (not in a Modal) so the trigger and the overlay share one
// coordinate space — the overlay root's measured origin converts the trigger's
// window coordinates into overlay-local ones with no Modal-window mismatch.

// Window coordinates of the "..." trigger, so the close button can sit on top.
export type MoreActionsAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
};

// Slide distance for each row (kept small — exits should feel subtle).
const ROW_TRAVEL = 18;
// Normalized stagger between rows and per-row reveal window (must satisfy
// (maxRank * STAGGER) + WINDOW <= 1 so the last row finishes by progress 1).
const STAGGER = 0.09;
const WINDOW = 0.6;
// Fraction of the timeline over which the frosted layer finishes rising. Kept
// below 1 so the fill leads the row reveals (no row flashes over un-frosted
// content above the trigger).
const FILL_FRACTION = 0.6;
const ICON_OPACITY = 0.6;

type QuestAction = {
  key: string;
  label: string;
  icon: ReactNode;
  run: () => void;
};

function AnimatedActionRow({
  action,
  rank,
  progress,
  onRun,
}: {
  action: QuestAction;
  rank: number;
  progress: SharedValue<number>;
  onRun: (run: () => void) => void;
}) {
  const [pressed, setPressed] = useState(false);

  const animatedStyle = useAnimatedStyle(() => {
    const start = rank * STAGGER;
    const raw = (progress.value - start) / WINDOW;
    const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    return {
      opacity: t,
      transform: [{ translateY: (1 - t) * ROW_TRAVEL }],
    };
  });

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        onPress={() => onRun(action.run)}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        accessibilityRole="button"
        accessibilityLabel={action.label}
        className="h-[50px] flex-row items-center justify-end gap-3 pl-2 pr-2"
        style={{ transform: [{ scale: pressed ? 0.96 : 1 }] }}
      >
        <Text className="text-[20px] font-medium text-black" style={{ lineHeight: 24 }}>
          {action.label}
        </Text>
        {action.icon}
      </Pressable>
    </Animated.View>
  );
}

export function MoreActionsSheet({
  open,
  onClose,
  anchor,
  onSend,
  onReceive,
  onSwap,
  onShield,
  onUnshield,
  onQuests,
}: {
  open: boolean;
  onClose: () => void;
  anchor?: MoreActionsAnchor | null;
  onSend?: () => void;
  onReceive?: () => void;
  onSwap?: () => void;
  onShield?: () => void;
  onUnshield?: () => void;
  onQuests?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const progress = useSharedValue(0);
  // Keep the overlay mounted through the close animation, then unmount.
  const [mounted, setMounted] = useState(false);
  // Window origin of the overlay root, used to translate the trigger's window
  // coordinates into the overlay's coordinate space.
  const rootRef = useRef<ComponentRef<typeof View>>(null);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (open) {
      setMounted(true);
    }
  }, [open]);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    if (open) {
      void Haptics.selectionAsync();
      progress.value = withTiming(1, {
        duration: 560,
        easing: Easing.out(Easing.cubic),
      });
    } else {
      progress.value = withTiming(
        0,
        { duration: 380, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished) {
            runOnJS(setMounted)(false);
          }
        },
      );
    }
  }, [open, mounted, progress]);

  // Close on Android hardware back while open.
  useEffect(() => {
    if (!mounted || !open) {
      return;
    }
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [mounted, open, onClose]);

  const handleRootLayout = () => {
    rootRef.current?.measureInWindow((x, y) => setOrigin({ x, y }));
  };

  // Design order, top -> bottom. Only render the actions the screen supplies.
  const actions: QuestAction[] = [];
  if (onQuests) {
    actions.push({
      key: "quests",
      label: "Quests",
      icon: <Trophy size={28} color="#000" strokeWidth={2} opacity={ICON_OPACITY} />,
      run: onQuests,
    });
  }
  if (onUnshield) {
    actions.push({
      key: "unshield",
      label: "Unshield",
      icon: <ShieldOff size={28} color="#000" strokeWidth={2} opacity={ICON_OPACITY} />,
      run: onUnshield,
    });
  }
  if (onShield) {
    actions.push({
      key: "shield",
      label: "Shield",
      icon: <Shield size={28} color="#000" strokeWidth={2} opacity={ICON_OPACITY} />,
      run: onShield,
    });
  }
  if (onSwap) {
    actions.push({
      key: "swap",
      label: "Swap",
      icon: <ArrowLeftRight size={28} color="#000" strokeWidth={2} opacity={ICON_OPACITY} />,
      run: onSwap,
    });
  }
  if (onReceive) {
    actions.push({
      key: "receive",
      label: "Receive",
      icon: <ArrowDown size={28} color="#000" strokeWidth={2} opacity={ICON_OPACITY} />,
      run: onReceive,
    });
  }
  if (onSend) {
    actions.push({
      key: "send",
      label: "Send",
      icon: <ArrowUp size={28} color="#000" strokeWidth={2} opacity={ICON_OPACITY} />,
      run: onSend,
    });
  }

  const runAction = (run: () => void) => {
    void Haptics.selectionAsync();
    onClose();
    run();
  };

  // The frosted layer slides up from the bottom to fill the screen (directional
  // reveal); opacity ramps quickly so there's no hard edge as it enters.
  const backdropStyle = useAnimatedStyle(() => {
    const fill = Math.min(1, progress.value / FILL_FRACTION);
    return {
      opacity: Math.min(1, progress.value * 5),
      transform: [{ translateY: (1 - fill) * screenH }],
    };
  });
  const closeStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.85 + 0.15 * progress.value }],
  }));

  // Trigger position in the overlay's coordinate space (window coords minus the
  // overlay root's own window origin). Fall back to the bottom-right.
  const closeTop = anchor ? anchor.y - origin.y : null;
  const closeLeft = anchor ? anchor.x - origin.x : null;
  const closePos =
    anchor && closeTop !== null && closeLeft !== null
      ? {
          top: closeTop,
          left: closeLeft,
          width: anchor.width,
          height: anchor.height,
        }
      : { right: 16, bottom: insets.bottom + 8, width: 50, height: 50 };
  const rowsPos =
    anchor && closeTop !== null && closeLeft !== null
      ? {
          top: 0,
          left: 0,
          right: 0,
          height: Math.max(0, closeTop),
          justifyContent: "flex-end" as const,
          alignItems: "flex-end" as const,
          paddingRight: Math.max(0, screenW - (closeLeft + anchor.width)),
          paddingBottom: 12,
        }
      : {
          right: 16,
          bottom: insets.bottom + 8 + 50 + 12,
          alignItems: "flex-end" as const,
        };

  if (!mounted) {
    return null;
  }

  return (
    <View
      ref={rootRef}
      onLayout={handleRootLayout}
      style={[StyleSheet.absoluteFill, styles.overlay]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close menu"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        >
          <BlurView intensity={32} tint="light" style={StyleSheet.absoluteFill} />
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: "rgba(255,255,255,0.9)" },
            ]}
          />
        </Pressable>
      </Animated.View>

      <View pointerEvents="box-none" style={[styles.absolute, rowsPos]}>
        {actions.map((action, index) => (
          <AnimatedActionRow
            key={action.key}
            action={action}
            rank={actions.length - 1 - index}
            progress={progress}
            onRun={runAction}
          />
        ))}
      </View>

      <Animated.View style={[styles.absolute, closePos, closeStyle]}>
        <CloseButton onPress={onClose} />
      </Animated.View>
    </View>
  );
}

function CloseButton({ onPress }: { onPress: () => void }) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel="Close menu"
      className="h-full w-full items-center justify-center"
      style={{
        borderRadius: 78,
        backgroundColor: "#f5f5f5",
        transform: [{ scale: pressed ? 0.96 : 1 }],
      }}
    >
      <X size={28} color="#3C3C43" strokeWidth={2} opacity={ICON_OPACITY} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    zIndex: 50,
    elevation: 50,
  },
  absolute: {
    position: "absolute",
  },
});
