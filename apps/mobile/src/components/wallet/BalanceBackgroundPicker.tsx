import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import * as Haptics from "expo-haptics";
import { Ban, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { ScrollView as GHScrollView } from "react-native-gesture-handler";

import {
  BALANCE_BACKGROUND_OPTIONS,
  findBalanceBackground,
} from "@/lib/wallet/balance-backgrounds";
import { Pressable, Text, View } from "@/tw";
import { Image } from "@/tw/image";

const THUMB_SIZE = 72;
const THUMB_GAP = 16; // 8px on each side
const ITEM_STRIDE = THUMB_SIZE + THUMB_GAP;
const RING_SIZE = 80;
const PREVIEW_ASPECT = 361 / 203;

type BalanceBackgroundPickerProps = {
  open: boolean;
  onClose: () => void;
  selectedBg: string | null;
  onSelect: (bg: string | null) => void;
  walletAddressLabel?: string | null;
  primaryBalanceLabel?: string;
  secondaryBalanceLabel?: string;
};

export function BalanceBackgroundPicker({
  open,
  onClose,
  selectedBg,
  onSelect,
  walletAddressLabel,
  primaryBalanceLabel,
  secondaryBalanceLabel,
}: BalanceBackgroundPickerProps) {
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const { width: screenWidth } = useWindowDimensions();
  const carouselScrollRef = useRef<GHScrollView | null>(null);
  const lastSelectedIdxRef = useRef<number>(-1);
  const [carouselWidth, setCarouselWidth] = useState(screenWidth);

  const [previewBg, setPreviewBg] = useState<string | null>(selectedBg);

  // Spacer that puts the first thumb's CENTER at the carousel's center, and
  // lets the last thumb scroll all the way into the center too. Uses
  // ITEM_STRIDE (not THUMB_SIZE) so the per-item bounds line up with the
  // snap-interval grid.
  const sideInset = Math.max(0, (carouselWidth - ITEM_STRIDE) / 2);

  const initialIdx = useMemo(() => {
    const idx = BALANCE_BACKGROUND_OPTIONS.findIndex(
      (option) => option.id === selectedBg,
    );
    return idx === -1 ? 0 : idx;
  }, [selectedBg]);

  useEffect(() => {
    if (open) {
      setPreviewBg(selectedBg);
      lastSelectedIdxRef.current = initialIdx;
      bottomSheetRef.current?.present();
    } else {
      bottomSheetRef.current?.dismiss();
    }
  }, [open, selectedBg, initialIdx]);

  // Once the carousel reports its width, set the scroll position so the saved
  // selection lands in the center ring. Re-fires when the saved selection
  // changes after open.
  useEffect(() => {
    if (!open) return;
    if (carouselWidth <= 0) return;
    const offset = initialIdx * ITEM_STRIDE;
    // Run on the next tick so the ScrollView has its content laid out.
    const t = setTimeout(() => {
      carouselScrollRef.current?.scrollTo({ x: offset, animated: false });
    }, 0);
    return () => clearTimeout(t);
  }, [open, initialIdx, carouselWidth]);

  const handleClose = useCallback(() => {
    bottomSheetRef.current?.dismiss();
    onClose();
  }, [onClose]);

  const handleDone = useCallback(() => {
    onSelect(previewBg);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    bottomSheetRef.current?.dismiss();
    onClose();
  }, [previewBg, onSelect, onClose]);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = event.nativeEvent.contentOffset.x;
      const idx = Math.max(
        0,
        Math.min(
          BALANCE_BACKGROUND_OPTIONS.length - 1,
          Math.round(x / ITEM_STRIDE),
        ),
      );
      if (idx === lastSelectedIdxRef.current) return;
      lastSelectedIdxRef.current = idx;
      const next = BALANCE_BACKGROUND_OPTIONS[idx]?.id ?? null;
      setPreviewBg(next);
      Haptics.selectionAsync();
    },
    [],
  );

  const handleThumbPress = useCallback((idx: number) => {
    const offset = idx * ITEM_STRIDE;
    carouselScrollRef.current?.scrollTo({ x: offset, animated: true });
  }, []);

  const handleCarouselLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (width > 0 && width !== carouselWidth) setCarouselWidth(width);
  }, [carouselWidth]);

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.3}
      />
    ),
    [],
  );

  const snapPoints = useMemo(() => ["72%"], []);

  const previewSource = findBalanceBackground(previewBg)?.source ?? null;
  const hasBg = previewSource !== null;
  const previewPrimary = hasBg ? "#ffffff" : "#1c1c1e";
  const previewMuted = hasBg
    ? "rgba(255, 255, 255, 0.7)"
    : "rgba(60, 60, 67, 0.6)";

  return (
    <BottomSheetModal
      ref={bottomSheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      backdropComponent={renderBackdrop}
      onDismiss={onClose}
      handleIndicatorStyle={{ backgroundColor: "rgba(0,0,0,0.15)", width: 36 }}
      backgroundStyle={{ borderTopLeftRadius: 24, borderTopRightRadius: 24 }}
    >
      <BottomSheetView style={styles.container}>
        {/* Header */}
        <View style={styles.headerRow}>
          <Text style={styles.title}>Choose your style</Text>
          <Pressable
            onPress={handleClose}
            hitSlop={8}
            style={styles.closeBtn}
          >
            <X size={20} color="rgba(60, 60, 67, 0.6)" strokeWidth={2} />
          </Pressable>
        </View>

        {/* Preview card */}
        <View style={styles.previewWrap}>
          <View
            style={[styles.previewCard, { aspectRatio: PREVIEW_ASPECT }]}
          >
            <View
              style={[
                StyleSheet.absoluteFillObject,
                { backgroundColor: "#f2f2f7", borderRadius: 26 },
              ]}
            />
            {previewSource ? (
              <Image
                source={previewSource}
                style={{
                  ...StyleSheet.absoluteFillObject,
                  borderRadius: 26,
                }}
                contentFit="cover"
                transition={120}
              />
            ) : null}
            <View
              style={[
                StyleSheet.absoluteFillObject,
                {
                  backgroundColor: "rgba(255,255,255,0.08)",
                  borderRadius: 26,
                },
              ]}
            />
            <View style={styles.previewContent}>
              <Text style={[styles.previewAddress, { color: previewPrimary }]}>
                {walletAddressLabel ?? "Solana"}
              </Text>
              <View>
                <Text style={[styles.previewBalance, { color: previewPrimary }]}>
                  {primaryBalanceLabel ?? "$0.00"}
                </Text>
                <Text
                  style={[styles.previewSecondary, { color: previewMuted }]}
                >
                  {secondaryBalanceLabel ?? "0.0000 SOL"}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Spacer pushes carousel toward the bottom */}
        <View style={{ flex: 1 }} />

        {/* Carousel — full sheet width so center math is screen-centered */}
        <View
          style={styles.carouselWrap}
          onLayout={handleCarouselLayout}
        >
          <View
            pointerEvents="none"
            style={[
              styles.centerRing,
              {
                width: RING_SIZE,
                height: RING_SIZE,
                marginLeft: -RING_SIZE / 2,
                marginTop: -RING_SIZE / 2,
              },
            ]}
          />
          <GHScrollView
            ref={carouselScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={ITEM_STRIDE}
            snapToAlignment="start"
            decelerationRate="fast"
            onScroll={handleScroll}
            scrollEventThrottle={16}
            contentOffset={{ x: initialIdx * ITEM_STRIDE, y: 0 }}
            style={{ height: 96 }}
            contentContainerStyle={{
              alignItems: "center",
              paddingLeft: sideInset,
              paddingRight: sideInset,
            }}
          >
            {BALANCE_BACKGROUND_OPTIONS.map((option, idx) => (
              <View
                key={option.id ?? "none"}
                style={{
                  width: ITEM_STRIDE,
                  height: THUMB_SIZE,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Pressable
                  onPress={() => handleThumbPress(idx)}
                  style={{
                    width: THUMB_SIZE,
                    height: THUMB_SIZE,
                    borderRadius: THUMB_SIZE / 2,
                    overflow: "hidden",
                    backgroundColor:
                      option.thumb === null
                        ? "rgba(0,0,0,0.05)"
                        : "transparent",
                  }}
                >
                  {option.thumb ? (
                    <Image
                      source={option.thumb}
                      style={{ width: "100%", height: "100%" }}
                      contentFit="cover"
                      transition={80}
                    />
                  ) : (
                    <View
                      style={{
                        flex: 1,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ban
                        size={28}
                        strokeWidth={1.5}
                        color="rgba(0, 0, 0, 0.3)"
                      />
                    </View>
                  )}
                </Pressable>
              </View>
            ))}
          </GHScrollView>
        </View>

        {/* Done */}
        <Pressable
          onPress={handleDone}
          style={({ pressed }) => [
            styles.doneBtn,
            { opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 4,
    paddingBottom: 24,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  title: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 17,
    lineHeight: 22,
    color: "#000",
  },
  closeBtn: {
    position: "absolute",
    right: 12,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.06)",
  },
  previewWrap: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  previewCard: {
    width: "100%",
    overflow: "hidden",
    borderRadius: 26,
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  previewContent: {
    flex: 1,
    padding: 16,
    justifyContent: "space-between",
  },
  previewAddress: {
    fontFamily: "Geist_500Medium",
    fontSize: 17,
    lineHeight: 22,
  },
  previewBalance: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 36,
    lineHeight: 44,
  },
  previewSecondary: {
    fontFamily: "Geist_400Regular",
    fontSize: 15,
    lineHeight: 20,
    marginTop: 2,
  },
  carouselWrap: {
    height: 96,
    justifyContent: "center",
  },
  centerRing: {
    position: "absolute",
    top: "50%",
    left: "50%",
    borderRadius: 9999,
    borderWidth: 3,
    borderColor: "rgba(0, 0, 0, 0.15)",
    zIndex: 10,
  },
  doneBtn: {
    marginTop: 16,
    marginHorizontal: 16,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000",
  },
  doneText: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 16,
    color: "#fff",
  },
});
