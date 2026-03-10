import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import * as Haptics from "expo-haptics";
import { Ban, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView } from "react-native";

import { Pressable, Text, View } from "@/tw";

type BgOption = {
  id: string | null;
  label: string;
};

const BG_OPTIONS: BgOption[] = [
  { id: "balance-bg-01", label: "Gradient 1" },
  { id: "balance-bg-02", label: "Gradient 2" },
  { id: "balance-bg-03", label: "Gradient 3" },
  { id: "balance-bg-04", label: "Gradient 4" },
  { id: "balance-bg-05", label: "Gradient 5" },
  { id: null, label: "Default" },
];

const BG_COLORS: Record<string, string> = {
  "balance-bg-01": "#FF6B6B",
  "balance-bg-02": "#4ECDC4",
  "balance-bg-03": "#45B7D1",
  "balance-bg-04": "#96CEB4",
  "balance-bg-05": "#FFEAA7",
};

type BalanceBackgroundPickerProps = {
  open: boolean;
  onClose: () => void;
  selectedBg: string | null;
  onSelect: (bg: string | null) => void;
};

export function BalanceBackgroundPicker({
  open,
  onClose,
  selectedBg,
  onSelect,
}: BalanceBackgroundPickerProps) {
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const [previewBg, setPreviewBg] = useState<string | null>(selectedBg);

  useEffect(() => {
    if (open) {
      setPreviewBg(selectedBg);
      bottomSheetRef.current?.present();
    } else {
      bottomSheetRef.current?.dismiss();
    }
  }, [open, selectedBg]);

  const handleClose = useCallback(() => {
    bottomSheetRef.current?.dismiss();
    onClose();
  }, [onClose]);

  const handleDone = useCallback(() => {
    onSelect(previewBg);
    onClose();
  }, [previewBg, onSelect, onClose]);

  const handleSelectOption = useCallback((id: string | null) => {
    setPreviewBg(id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

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
      backdropComponent={renderBackdrop}
      onDismiss={onClose}
      handleIndicatorStyle={{ backgroundColor: "rgba(0,0,0,0.15)", width: 36 }}
      backgroundStyle={{ borderTopLeftRadius: 24, borderTopRightRadius: 24 }}
    >
      <BottomSheetView>
        <View className="px-6 pb-12 pt-2">
          {/* Header */}
          <View className="mb-6 flex-row items-center justify-center">
            <Text
              className="text-[17px] font-semibold text-black"
              style={{ lineHeight: 22 }}
            >
              Choose your style
            </Text>
            <Pressable className="absolute right-0" onPress={handleClose}>
              <X size={24} color="#000" />
            </Pressable>
          </View>

          {/* Thumbnail options */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 16 }}
            className="mb-8"
          >
            {BG_OPTIONS.map((option) => {
              const isSelected = previewBg === option.id;
              return (
                <Pressable
                  key={option.id ?? "default"}
                  onPress={() => handleSelectOption(option.id)}
                  className="items-center"
                >
                  <View
                    style={[
                      {
                        width: 64,
                        height: 64,
                        borderRadius: 32,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: option.id
                          ? BG_COLORS[option.id]
                          : "#F5F5F5",
                      },
                      isSelected && {
                        borderWidth: 3,
                        borderColor: "#000",
                      },
                    ]}
                  >
                    {option.id === null && <Ban size={24} color="#999" />}
                  </View>
                  <Text className="mt-2 text-[12px] text-neutral-600">
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Done button */}
          <Pressable
            className="items-center rounded-2xl py-4"
            style={{ backgroundColor: "#f9363c" }}
            onPress={handleDone}
          >
            <Text className="text-[16px] font-semibold text-white">Done</Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
}
