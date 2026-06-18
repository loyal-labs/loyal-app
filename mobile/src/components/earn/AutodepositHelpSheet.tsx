import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { Image as ImageIcon, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Autodeposit "?" help sheet (Figma 80-34341). Explains what autodeposit does
// and offers a "Set up autodeposit" CTA. The hero image is a placeholder for now.
const SCREEN_HEIGHT = Dimensions.get("screen").height;
const SHEET_HEIGHT = Math.floor(SCREEN_HEIGHT * 0.94);

const COLOR_CHIP_BG = "#F2F2F7";
const COLOR_BODY_DIM = "rgba(60, 60, 67, 0.6)";
const COLOR_PLACEHOLDER = "#C7C7CC";

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
  const snapPoints = useMemo(() => ["94%"], []);

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

        <View style={styles.content}>
          <View style={styles.imagePlaceholder}>
            <ImageIcon size={64} color={COLOR_PLACEHOLDER} strokeWidth={1.5} />
          </View>
          <View style={styles.textLayout}>
            <Text style={styles.heading}>Earn more without manual deposits</Text>
            <Text style={styles.body}>
              Set the balance you want to keep in your wallet. Any stablecoins
              above that amount are automatically deposited into Earn.
            </Text>
          </View>
        </View>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 24 }]}>
          <Pressable
            onPress={handleSetUp}
            accessibilityRole="button"
            accessibilityLabel="Set up autodeposit"
            style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          >
            <Text style={styles.ctaLabel}>Set up autodeposit</Text>
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
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLOR_CHIP_BG,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 32,
    paddingHorizontal: 16,
  },
  imagePlaceholder: {
    width: "100%",
    aspectRatio: 1,
    maxHeight: 400,
    alignItems: "center",
    justifyContent: "center",
  },
  textLayout: {
    width: "100%",
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
