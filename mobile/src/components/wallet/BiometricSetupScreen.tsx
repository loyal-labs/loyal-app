import { Fingerprint, Scan } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet } from "react-native";

import {
  getBiometricType,
  isBiometricAvailable,
} from "@/lib/wallet/biometrics";
import { useWallet } from "@/lib/wallet/wallet-provider";
import { Pressable, Text, View } from "@/tw";

type Props = {
  pin: string;
  onComplete: () => void;
};

export function BiometricSetupScreen({ pin, onComplete }: Props) {
  const { setBiometricEnabled } = useWallet();
  const [biometricType, setBiometricType] = useState<
    "faceid" | "fingerprint" | "none"
  >("none");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const available = await isBiometricAvailable();
      if (available) {
        const type = await getBiometricType();
        setBiometricType(type);
      } else {
        onComplete();
      }
    })();
  }, [onComplete]);

  const handleEnable = useCallback(async () => {
    setLoading(true);
    try {
      await setBiometricEnabled(pin, true);
    } catch {
      // Biometric enrollment failed — continue without
    }
    onComplete();
  }, [pin, setBiometricEnabled, onComplete]);

  const isFaceId = biometricType === "faceid";
  const Icon = isFaceId ? Scan : Fingerprint;
  const label = isFaceId ? "Face ID" : "Fingerprint";

  if (biometricType === "none") return null;

  return (
    <View className="flex-1 items-center justify-center bg-white px-6">
      <Icon size={80} color="#000" strokeWidth={1.2} />
      <Text style={styles.title}>Enable {label}?</Text>
      <Text style={styles.subtitle}>
        Unlock your wallet quickly with {label} instead of entering your PIN
        each time.
      </Text>
      <View className="mt-10 w-full gap-3">
        <Pressable
          style={styles.primaryButton}
          onPress={handleEnable}
          disabled={loading}
        >
          <Text style={styles.primaryButtonText}>
            {loading ? "Setting up..." : `Enable ${label}`}
          </Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={onComplete}>
          <Text style={styles.secondaryButtonText}>Skip for now</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: "Geist_700Bold",
    fontSize: 24,
    color: "#000",
    marginTop: 24,
    textAlign: "center",
  },
  subtitle: {
    fontFamily: "Geist_400Regular",
    fontSize: 15,
    color: "rgba(0,0,0,0.5)",
    marginTop: 8,
    textAlign: "center",
    lineHeight: 22,
  },
  primaryButton: {
    height: 52,
    borderRadius: 16,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 16,
    color: "#fff",
  },
  secondaryButton: {
    height: 52,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.04)",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontFamily: "Geist_500Medium",
    fontSize: 16,
    color: "#000",
  },
});
