import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { useCallback, useEffect, useRef } from "react";
import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Pressable, Text } from "@/tw";

import UnverifiedBadgeIcon from "../../../../assets/images/icons/unverified_badge_24.svg";
import VerifiedBadgeIcon from "../../../../assets/images/icons/verified_badge_24.svg";

const VERIFIED_COLOR = "#34C759";
const UNVERIFIED_COLOR = "#FFA000";
const MUTED = "rgba(60, 60, 67, 0.6)";

// Small explainer sheet opened by tapping the verified/unverified badge next
// to the token name (Figma 316:9729 / 316:9741).
export function TokenVerificationSheet({
  open,
  onClose,
  verified,
}: {
  open: boolean;
  onClose: () => void;
  verified: boolean;
}) {
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (open) {
      bottomSheetRef.current?.present();
    } else {
      bottomSheetRef.current?.dismiss();
    }
  }, [open]);

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

  return (
    <BottomSheetModal
      ref={bottomSheetRef}
      enableDynamicSizing
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      onDismiss={onClose}
      handleComponent={null}
      backgroundStyle={styles.sheetBackground}
    >
      <BottomSheetView
        style={[styles.container, { paddingBottom: insets.bottom + 16 }]}
      >
        {verified ? (
          <VerifiedBadgeIcon width={48} height={48} />
        ) : (
          <UnverifiedBadgeIcon width={48} height={48} />
        )}
        <Text
          className="mt-6 text-[20px] font-semibold"
          style={{
            color: verified ? VERIFIED_COLOR : UNVERIFIED_COLOR,
            letterSpacing: -0.22,
            lineHeight: 24,
          }}
        >
          {verified ? "This token is verified" : "This token is not verified"}
        </Text>
        <Text className="mt-2 text-[15px]" style={{ color: MUTED, lineHeight: 20 }}>
          {verified
            ? "This token is recognized by community token lists and market data providers. Verification is not an endorsement — always do your own research."
            : "This token hasn't been verified by community token lists yet. It may be newly created or unsafe — trade with caution and do your own research."}
        </Text>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          className="mt-6 h-[50px] items-center justify-center"
          style={styles.closeButton}
        >
          <Text
            className="text-[17px] font-medium text-black"
            style={{ lineHeight: 22 }}
          >
            Close
          </Text>
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
    paddingHorizontal: 24,
    paddingTop: 32,
  },
  closeButton: {
    borderRadius: 78,
    backgroundColor: "#f5f5f5",
  },
});
