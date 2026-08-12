import { Pressable, Text, View } from "@/tw";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, TextInput } from "react-native";

const CODE_LENGTH = 5;

function isAllSameDigits(code: string): boolean {
  return code.length === CODE_LENGTH && new Set(code).size === 1;
}

export default function CodeScreen() {
  const router = useRouter();
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const inputRef = useRef<TextInput>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, []);

  const handleChangeText = useCallback(
    (text: string) => {
      if (error) setError(false);
      const digits = text.replace(/\D/g, "").slice(0, CODE_LENGTH);
      setCode(digits);

      if (digits.length === CODE_LENGTH) {
        setTimeout(() => {
          if (isAllSameDigits(digits)) {
            if (Platform.OS !== "web") {
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success,
              );
            }
            router.push("/login/password");
          } else {
            if (Platform.OS !== "web") {
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Error,
              );
            }
            setError(true);
            setCode("");
            inputRef.current?.focus();
          }
        }, 300);
      }
    },
    [error, router],
  );

  const dots = Array.from({ length: CODE_LENGTH }, (_, i) => {
    const filled = i < code.length;
    const dotColor = error
      ? styles.dotError
      : filled
        ? styles.dotFilled
        : undefined;
    return (
      <View key={i} style={styles.dotCell}>
        <Text style={[styles.dot, dotColor]}>
          {filled ? code[i] : "\u2022"}
        </Text>
      </View>
    );
  });

  return (
    <Pressable
      style={styles.container}
      onPress={() => inputRef.current?.focus()}
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Enter the Code</Text>
          <Text style={styles.subtitle}>
            We have sent you a message in Telegram with a code to{" "}
            <Text style={styles.phoneHighlight}>{phone}</Text>
          </Text>
        </View>

        <View style={styles.codeSection}>
          <View style={styles.codeRow}>
            {dots}
            {/* Transparent TextInput overlays the dots so tapping them refocuses */}
            <TextInput
              ref={inputRef}
              style={styles.overlayInput}
              value={code}
              onChangeText={handleChangeText}
              keyboardType="number-pad"
              maxLength={CODE_LENGTH}
              autoFocus
              caretHidden
            />
          </View>
          {error && (
            <Text style={styles.errorText}>Invalid code</Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  content: {
    paddingHorizontal: 32,
    paddingTop: 48,
    gap: 32,
    alignItems: "center",
  },
  header: {
    alignItems: "center",
    gap: 4,
  },
  title: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 22,
    lineHeight: 28,
    color: "#000",
    textAlign: "center",
  },
  subtitle: {
    fontFamily: "Geist_400Regular",
    fontSize: 17,
    lineHeight: 22,
    color: "rgba(60,60,67,0.6)",
    textAlign: "center",
  },
  phoneHighlight: {
    color: "#3c3c43",
  },
  codeSection: {
    width: "100%",
    gap: 16,
    alignItems: "center",
  },
  codeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    position: "relative",
  },
  dotCell: {
    width: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    fontFamily: "Geist_500Medium",
    fontSize: 48,
    lineHeight: 56,
    color: "rgba(60,60,67,0.4)",
    textAlign: "center",
    letterSpacing: -0.43,
  },
  dotFilled: {
    color: "#000",
  },
  dotError: {
    color: "#F9363C",
  },
  errorText: {
    fontFamily: "Geist_400Regular",
    fontSize: 17,
    lineHeight: 22,
    color: "#F9363C",
    textAlign: "center",
  },
  overlayInput: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0,
  },
});
