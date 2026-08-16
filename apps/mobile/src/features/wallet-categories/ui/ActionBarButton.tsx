import { useState } from "react";
import type { ReactNode } from "react";

import { Pressable, Text } from "@/tw";

// The pill buttons on the wallet/category action bars (Figma 141:5940). Primary
// = black Send; secondary = light-gray Receive / icon-only "More". Shared so the
// wallet screen and the stablecoins/crypto screens stay byte-for-byte identical.
export function ActionBarButton({
  icon,
  label,
  onPress,
  variant,
}: {
  icon: ReactNode;
  label?: string;
  onPress: () => void;
  variant: "primary" | "secondary";
}) {
  const [pressed, setPressed] = useState(false);
  const isPrimary = variant === "primary";
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-[50px] flex-row items-center justify-center gap-1"
      style={{
        flex: label ? 1 : undefined,
        width: label ? undefined : 50,
        borderRadius: 78,
        backgroundColor: isPrimary ? "#000000" : "#f5f5f5",
        opacity: pressed ? 0.85 : 1,
      }}
    >
      {icon}
      {label ? (
        <Text
          className="text-[17px] font-medium"
          style={{ color: isPrimary ? "#FFFFFF" : "#000000", lineHeight: 22 }}
        >
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}
