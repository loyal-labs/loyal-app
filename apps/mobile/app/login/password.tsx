import { PinPadInput } from "@/components/wallet/PinPadInput";
import { Text, View } from "@/tw";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { StyleSheet } from "react-native";

const VALID_PIN = "1234";

export default function PinScreen() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleChangePin = useCallback(
    (text: string) => {
      if (error) setError(null);
      setPin(text);
    },
    [error],
  );

  const handlePinComplete = useCallback((nextPin: string) => {
    if (process.env.EXPO_OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    if (nextPin === VALID_PIN) {
      router.dismissAll();
      router.replace("/");
    } else {
      if (process.env.EXPO_OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      setError("Invalid PIN. Please, try again");
      setPin("");
    }
  }, [router]);

  return (
    <View className="flex-1 bg-white">
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Enter PIN</Text>
          <Text style={styles.subtitle}>
            Enter your 4-digit verification PIN to continue
          </Text>
        </View>

        <View style={styles.pinPadWrap}>
          <PinPadInput
            value={pin}
            onChange={handleChangePin}
            onComplete={handlePinComplete}
            error={error}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
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
  pinPadWrap: {
    width: "100%",
    maxWidth: 340,
  },
});
