import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import * as Haptics from "expo-haptics";
import { ArrowLeftRight, Shield, ShieldOff } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Pressable, Text } from "@/tw";

function MenuRow({
  icon,
  label,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="flex-row items-center gap-3 px-5"
      style={{
        height: 56,
        borderRadius: 16,
        backgroundColor: pressed ? "#f2f2f7" : "transparent",
      }}
    >
      {icon}
      <Text className="text-[17px] font-medium text-black" style={{ letterSpacing: -0.187 }}>
        {label}
      </Text>
    </Pressable>
  );
}

// The "..." menu on the category screens. Send + Receive stay on the bottom
// bar; the rest (Swap, Shield, Unshield) live here as a compact drop-up.
export function MoreActionsSheet({
  open,
  onClose,
  onSwap,
  onShield,
  onUnshield,
}: {
  open: boolean;
  onClose: () => void;
  onSwap: () => void;
  onShield: () => void;
  onUnshield: () => void;
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

  const pick = useCallback(
    (action: () => void) => () => {
      void Haptics.selectionAsync();
      sheetRef.current?.dismiss();
      action();
    },
    [],
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      enableDynamicSizing
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      onDismiss={onClose}
      backgroundStyle={styles.background}
      handleIndicatorStyle={styles.handleIndicator}
    >
      <BottomSheetView style={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 12, paddingTop: 4 }}>
        <MenuRow
          icon={<ArrowLeftRight size={24} color="#000" strokeWidth={2} />}
          label="Swap"
          onPress={pick(onSwap)}
        />
        <MenuRow
          icon={<Shield size={24} color="#000" strokeWidth={2} />}
          label="Shield"
          onPress={pick(onShield)}
        />
        <MenuRow
          icon={<ShieldOff size={24} color="#000" strokeWidth={2} />}
          label="Unshield"
          onPress={pick(onUnshield)}
        />
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = {
  background: {
    backgroundColor: "#FFF",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  handleIndicator: {
    backgroundColor: "rgba(60, 60, 67, 0.3)",
    width: 40,
  },
} as const;
