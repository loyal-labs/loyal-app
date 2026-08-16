import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { ArrowRightLeft, Repeat, Undo2 } from "lucide-react-native";
import { useCallback, useEffect, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Pre-flight transparency interstitial, shown BEFORE the Autodeposit setup
// sheet opens (create and edit — delete lives inside the edit sheet, so every
// operation passes through here first): what primitive it runs on, what
// permission it holds, and how it's undone. Exists so the on-chain footprint
// (token delegate + rent) is understood before the user commits, not something
// a wallet UI surprises them with later. "Continue" proceeds to the setup
// sheet; closing any other way cancels.
const COLOR_CHIP_BG = "#F2F2F7";
const COLOR_BODY_DIM = "rgba(60, 60, 67, 0.6)";
const COLOR_BRAND_RED = "#F9363C";

const ROWS = [
  {
    Icon: Repeat,
    title: "Native Solana subscriptions",
    body: "Autodeposit runs on Solana's built-in subscriptions primitive — a standard, auditable on-chain permission.",
  },
  {
    Icon: ArrowRightLeft,
    title: "Deposits happen for you",
    body: "It lets your smart account move stablecoins above your threshold from your wallet into Kamino reserves — no signing each time.",
  },
  {
    Icon: Undo2,
    title: "Fully reversible",
    body: "Delete the Autodeposit anytime to revoke its permissions and get back the SOL held as account rent.",
  },
] as const;

export function AutodepositInfoSheet({
  open,
  onClose,
  onContinue,
}: {
  open: boolean;
  onClose: () => void;
  // Called when the user accepts — close this sheet, then open the setup
  // sheet (mirrors AutodepositHelpSheet → setup).
  onContinue: () => void;
}) {
  const sheetRef = useRef<BottomSheetModal>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (open) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [open]);

  const handleContinue = useCallback(() => {
    sheetRef.current?.dismiss();
    onContinue();
  }, [onContinue]);

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
    // No snap points: dynamic sizing fits the sheet to its short content
    // (unlike the full-height setup/help sheets).
    <BottomSheetModal
      ref={sheetRef}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      onDismiss={onClose}
      handleComponent={null}
      backgroundStyle={styles.sheetBackground}
    >
      <BottomSheetView style={styles.container}>
        <Text style={styles.heading}>How Autodeposit works</Text>

        <View style={styles.rows}>
          {ROWS.map(({ Icon, title, body }) => (
            <View key={title} style={styles.row}>
              <View style={styles.rowIcon}>
                <Icon size={24} color={COLOR_BRAND_RED} strokeWidth={2} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{title}</Text>
                <Text style={styles.rowBody}>{body}</Text>
              </View>
            </View>
          ))}
        </View>

        <Pressable
          onPress={handleContinue}
          accessibilityRole="button"
          accessibilityLabel="Continue"
          style={({ pressed }) => [
            styles.cta,
            { marginBottom: insets.bottom + 12 },
            pressed && styles.ctaPressed,
          ]}
        >
          <Text style={styles.ctaLabel}>Continue</Text>
        </Pressable>
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
    paddingHorizontal: 20,
    paddingTop: 28,
  },
  heading: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 24,
    lineHeight: 29,
    letterSpacing: -0.48,
    color: "#000",
    paddingHorizontal: 2,
  },
  rows: {
    gap: 20,
    paddingTop: 24,
    paddingBottom: 28,
  },
  row: {
    flexDirection: "row",
    gap: 14,
  },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLOR_CHIP_BG,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: {
    flex: 1,
    gap: 3,
  },
  rowTitle: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 17,
    lineHeight: 22,
    color: "#000",
  },
  rowBody: {
    fontFamily: "Geist_400Regular",
    fontSize: 15,
    lineHeight: 20,
    color: COLOR_BODY_DIM,
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
