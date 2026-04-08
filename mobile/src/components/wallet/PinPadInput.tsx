import * as Haptics from "expo-haptics";
import { Delete } from "lucide-react-native";
import { useCallback } from "react";
import { StyleSheet, useWindowDimensions } from "react-native";

import { WALLET_PIN_LENGTH } from "@/lib/wallet/pin";
import { Pressable, Text, View } from "@/tw";

type PadKey = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "0" | "backspace" | "empty";

const KEYPAD_ROWS: PadKey[][] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["empty", "0", "backspace"],
];

type Props = {
  value: string;
  onChange: (pin: string) => void;
  onComplete?: (pin: string) => void;
  disabled?: boolean;
  error?: string | null;
  length?: number;
};

export function PinPadInput({
  value,
  onChange,
  onComplete,
  disabled = false,
  error = null,
  length = WALLET_PIN_LENGTH,
}: Props) {
  const { width } = useWindowDimensions();

  const horizontalPadding = 32;
  const keyGap = 12;
  const keypadWidth = Math.max(300, Math.min(width - horizontalPadding, 420));
  const keyWidth = Math.floor((keypadWidth - keyGap * 2) / 3);
  const keyHeight = Math.round(keyWidth * 0.72);
  const dotSize = Math.max(16, Math.min(22, Math.round(keyWidth * 0.18)));
  const keyTextSize = Math.max(30, Math.min(40, Math.round(keyHeight * 0.45)));

  const handleKeyPress = useCallback(
    (key: PadKey) => {
      if (disabled || key === "empty") return;

      if (process.env.EXPO_OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }

      if (key === "backspace") {
        onChange(value.slice(0, -1));
        return;
      }

      if (value.length >= length) return;
      const next = `${value}${key}`;
      onChange(next);
      if (next.length === length) {
        onComplete?.(next);
      }
    },
    [disabled, length, onChange, onComplete, value],
  );

  return (
    <View style={styles.container}>
      <View style={styles.dotsRow}>
        {Array.from({ length }).map((_, index) => (
          <View
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            style={[
              styles.dot,
              {
                width: dotSize,
                height: dotSize,
                borderRadius: dotSize / 2,
              },
              index < value.length ? styles.dotFilled : undefined,
            ]}
          />
        ))}
      </View>

      {error ? (
        <Text style={styles.errorText}>
          {error}
        </Text>
      ) : null}

      <View style={[styles.keypad, { width: keypadWidth, gap: keyGap }]}>
        {KEYPAD_ROWS.map((row, rowIndex) => (
          <View
            // eslint-disable-next-line react/no-array-index-key
            key={rowIndex}
            style={[styles.row, { gap: keyGap }]}
          >
            {row.map((key, keyIndex) => {
              if (key === "empty") {
                return (
                  // eslint-disable-next-line react/no-array-index-key
                  <View
                    key={keyIndex}
                    style={[styles.keySpacer, { width: keyWidth, height: keyHeight }]}
                  />
                );
              }

              return (
                <Pressable
                  // eslint-disable-next-line react/no-array-index-key
                  key={keyIndex}
                  style={[
                    styles.keyButton,
                    {
                      width: keyWidth,
                      height: keyHeight,
                      borderRadius: Math.round(keyHeight * 0.28),
                    },
                    disabled ? styles.keyButtonDisabled : undefined,
                  ]}
                  disabled={disabled}
                  onPress={() => handleKeyPress(key)}
                >
                  {key === "backspace" ? (
                    <Delete
                      size={Math.round(keyHeight * 0.34)}
                      color={disabled ? "rgba(0,0,0,0.25)" : "#000"}
                      strokeWidth={1.75}
                    />
                  ) : (
                    <Text
                      style={[
                        styles.keyText,
                        { fontSize: keyTextSize },
                        disabled ? styles.keyTextDisabled : undefined,
                      ]}
                    >
                      {key}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 14,
    width: "100%",
  },
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    marginTop: 10,
    marginBottom: 4,
  },
  dot: {
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.25)",
    backgroundColor: "transparent",
  },
  dotFilled: {
    backgroundColor: "#000",
    borderColor: "#000",
  },
  errorText: {
    fontFamily: "Geist_500Medium",
    fontSize: 13,
    lineHeight: 18,
    color: "#FF3B30",
    textAlign: "center",
  },
  keypad: {
    alignSelf: "center",
  },
  row: {
    flexDirection: "row",
    justifyContent: "center",
  },
  keySpacer: {},
  keyButton: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.04)",
  },
  keyButtonDisabled: {
    opacity: 0.45,
  },
  keyText: {
    fontFamily: "Geist_600SemiBold",
    color: "#000",
  },
  keyTextDisabled: {
    color: "rgba(0,0,0,0.3)",
  },
});
