import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";

import { Pressable, Text, View } from "@/tw";

type ActionButtonProps = {
  icon: ReactNode;
  label: string;
  onPress: () => void;
};

export function ActionButton({ icon, label, onPress }: ActionButtonProps) {
  const handlePress = () => {
    if (process.env.EXPO_OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress();
  };

  return (
    <Pressable className="items-center gap-2" onPress={handlePress}>
      <View
        className="h-[52px] w-[52px] items-center justify-center rounded-full"
        style={{ backgroundColor: "rgba(249, 54, 60, 0.14)" }}
      >
        {icon}
      </View>
      <Text
        className="text-[13px]"
        style={{ color: "rgba(60, 60, 67, 0.6)" }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
