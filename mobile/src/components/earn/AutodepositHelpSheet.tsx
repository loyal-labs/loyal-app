import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import HelpCoin from "../../../assets/images/earn/help-coin.svg";
import HelpDog from "../../../assets/images/earn/help-dog.svg";

// Autodeposit "?" help sheet (Figma 137-6178). Red dog mascot peeking up with
// three gold coins floating above its head; each coin hovers independently.
const SCREEN_HEIGHT = Dimensions.get("screen").height;
const SHEET_HEIGHT = Math.floor(SCREEN_HEIGHT * 0.94);

// Hero artboard is 400×500 in Figma; everything below is expressed in that base
// space and scaled by `s = heroWidth / 400` so the layout stays pixel-faithful.
const HERO_BASE_WIDTH = 400;
const HERO_ASPECT = 500 / 400;
const COIN_BASE_WIDTH = 90.6403;
const COIN_BASE_HEIGHT = 149.556;

const COLOR_CHIP_BG = "#F2F2F7";
const COLOR_BODY_DIM = "rgba(60, 60, 67, 0.6)";

// Coin box (top-left + rotation) in 400×500 base space, plus an independent
// bob/wobble cadence per coin so they never float in sync.
const COINS = [
  {
    left: 258.79,
    top: 92.95,
    rotate: 53.81,
    bob: 13,
    bobDuration: 2200,
    wobble: 3,
    wobbleDuration: 3000,
    delay: 0,
  },
  {
    left: 49.91,
    top: 118.74,
    rotate: 108.31,
    bob: 16,
    bobDuration: 2600,
    wobble: 4,
    wobbleDuration: 2700,
    delay: 350,
  },
  {
    left: 156.08,
    top: 15.88,
    rotate: 14.31,
    bob: 11,
    bobDuration: 2400,
    wobble: 2.5,
    wobbleDuration: 3200,
    delay: 700,
  },
] as const;

type CoinSpec = (typeof COINS)[number];

function FloatingCoin({ spec, scale }: { spec: CoinSpec; scale: number }) {
  const bob = useSharedValue(0);
  const wobble = useSharedValue(0);

  useEffect(() => {
    bob.value = withDelay(
      spec.delay,
      withRepeat(
        withTiming(1, {
          duration: spec.bobDuration,
          easing: Easing.inOut(Easing.sin),
        }),
        -1,
        true,
      ),
    );
    wobble.value = withDelay(
      spec.delay,
      withRepeat(
        withTiming(1, {
          duration: spec.wobbleDuration,
          easing: Easing.inOut(Easing.sin),
        }),
        -1,
        true,
      ),
    );
  }, [bob, wobble, spec]);

  const coinWidth = COIN_BASE_WIDTH * scale;
  const coinHeight = COIN_BASE_HEIGHT * scale;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: spec.bob * scale * (1 - 2 * bob.value) },
      { rotate: `${spec.rotate + spec.wobble * (1 - 2 * wobble.value)}deg` },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          left: spec.left * scale,
          top: spec.top * scale,
          width: coinWidth,
          height: coinHeight,
        },
        animatedStyle,
      ]}
    >
      <HelpCoin width={coinWidth} height={coinHeight} />
    </Animated.View>
  );
}

export function AutodepositHelpSheet({
  open,
  onClose,
  onSetUp,
}: {
  open: boolean;
  onClose: () => void;
  onSetUp: () => void;
}) {
  const sheetRef = useRef<BottomSheetModal>(null);
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const snapPoints = useMemo(() => ["94%"], []);

  const heroWidth = windowWidth;
  const heroHeight = heroWidth * HERO_ASPECT;
  const heroScale = heroWidth / HERO_BASE_WIDTH;

  useEffect(() => {
    if (open) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [open]);

  const handleClose = useCallback(() => {
    sheetRef.current?.dismiss();
  }, []);

  const handleSetUp = useCallback(() => {
    sheetRef.current?.dismiss();
    onSetUp();
  }, [onSetUp]);

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.2}
      />
    ),
    [],
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      onDismiss={onClose}
      handleComponent={null}
      backgroundStyle={styles.sheetBackground}
    >
      <BottomSheetView style={styles.container}>
        <View style={[styles.hero, { width: heroWidth, height: heroHeight }]}>
          <HelpDog width={heroWidth} height={heroHeight} />
          {COINS.map((spec) => (
            <FloatingCoin key={spec.rotate} spec={spec} scale={heroScale} />
          ))}
        </View>

        <View style={styles.textLayout}>
          <Text style={styles.heading}>Earn more without manual deposits</Text>
          <Text style={styles.body}>
            Set the balance you want to keep in your wallet. Any stablecoins
            above that amount are automatically deposited into Earn.
          </Text>
        </View>

        <View style={styles.spacer} />

        <View style={[styles.footer, { paddingBottom: insets.bottom + 24 }]}>
          <Pressable
            onPress={handleSetUp}
            accessibilityRole="button"
            accessibilityLabel="Set up autodeposit"
            style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          >
            <Text style={styles.ctaLabel}>Set up Autodeposit</Text>
          </Pressable>
        </View>

        <View style={styles.toolbar}>
          <Pressable
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={({ pressed }) => [
              styles.iconButton,
              { opacity: pressed ? 0.7 : 1 },
            ]}
            hitSlop={12}
          >
            <X size={24} color="#1C1C1E" strokeWidth={2} />
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: "#FFF",
    borderTopLeftRadius: 38,
    borderTopRightRadius: 38,
  },
  container: {
    height: SHEET_HEIGHT,
    backgroundColor: "#FFF",
    borderTopLeftRadius: 38,
    borderTopRightRadius: 38,
    overflow: "hidden",
  },
  hero: {
    alignSelf: "center",
  },
  toolbar: {
    position: "absolute",
    top: 16,
    left: 16,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLOR_CHIP_BG,
    alignItems: "center",
    justifyContent: "center",
  },
  textLayout: {
    paddingHorizontal: 22,
    paddingTop: 32,
    gap: 12,
  },
  heading: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.56,
    color: "#000",
  },
  body: {
    fontFamily: "Geist_400Regular",
    fontSize: 17,
    lineHeight: 22,
    color: COLOR_BODY_DIM,
  },
  spacer: {
    flex: 1,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    backgroundColor: "#FFF",
  },
  cta: {
    height: 50,
    borderRadius: 78,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  ctaPressed: {
    opacity: 0.85,
  },
  ctaLabel: {
    fontFamily: "Geist_500Medium",
    fontSize: 17,
    lineHeight: 22,
    color: "#FFF",
  },
});
