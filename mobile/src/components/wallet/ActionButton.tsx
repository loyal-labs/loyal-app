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
    <Pressable className="items-center gap-1.5" onPress={handlePress}>
      <View className="h-12 w-12 items-center justify-center rounded-full bg-black">
        {icon}
      </View>
      <Text className="text-xs font-medium text-neutral-600">{label}</Text>
    </Pressable>
  );
}
