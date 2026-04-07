import { Fingerprint, Scan } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet } from "react-native";

import { LogoHeader } from "@/components/LogoHeader";
import { getBiometricType } from "@/lib/wallet/biometrics";
import { PinLockedError } from "@/lib/wallet/keypair-storage";
import { useWallet } from "@/lib/wallet/wallet-provider";
import { Pressable, Text, View } from "@/tw";

import { PasswordInput } from "./PasswordInput";

export function LockScreen() {
  const { unlock, unlockWithBiometrics, biometricEnabled } = useWallet();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [biometricType, setBiometricType] = useState<
    "faceid" | "fingerprint" | "none"
  >("none");
  const [biometricFailed, setBiometricFailed] = useState(false);
  const [lockCountdown, setLockCountdown] = useState(0);

  // Resolve biometric type on mount
  useEffect(() => {
    if (biometricEnabled) {
      getBiometricType().then(setBiometricType);
    }
  }, [biometricEnabled]);

  // Attempt biometric auth on mount
  useEffect(() => {
    if (biometricEnabled) {
      unlockWithBiometrics().then((ok) => {
        if (!ok) setBiometricFailed(true);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Countdown timer for lockout
  useEffect(() => {
    if (lockCountdown <= 0) return;
    const interval = setInterval(() => {
      setLockCountdown((prev) => {
        if (prev <= 1) {
          setError(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [lockCountdown]);

  const handleUnlock = useCallback(async () => {
    if (!password.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await unlock(password);
    } catch (e) {
      if (e instanceof PinLockedError) {
        const seconds = Math.ceil(e.remainingMs / 1000);
        setLockCountdown(seconds);
        setError(`Wallet locked for ${seconds}s`);
      } else {
        setError("Incorrect password");
      }
    } finally {
      setLoading(false);
    }
  }, [password, unlock]);

  const handleBiometricRetry = useCallback(async () => {
    const ok = await unlockWithBiometrics();
    if (!ok) setBiometricFailed(true);
  }, [unlockWithBiometrics]);

  const isLocked = lockCountdown > 0;
  const showBiometricButton =
    biometricEnabled && biometricFailed && biometricType !== "none";
  const isFaceId = biometricType === "faceid";
  const BiometricIcon = isFaceId ? Scan : Fingerprint;

  return (
    <View className="flex-1 bg-white">
      <LogoHeader />
      <View className="flex-1 items-center justify-center px-6">
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>
          Enter your password to unlock your wallet
        </Text>

        <View className="mt-8 w-full gap-4">
          <PasswordInput
            value={password}
            onChange={setPassword}
            onSubmit={handleUnlock}
            error={isLocked ? `Wallet locked for ${lockCountdown}s` : error}
            placeholder="Enter password"
            autoFocus
          />

          <Pressable
            style={[
              styles.primaryButton,
              (loading || isLocked) && styles.primaryButtonDisabled,
            ]}
            onPress={handleUnlock}
            disabled={loading || isLocked || !password.trim()}
          >
            <Text style={styles.primaryButtonText}>
              {loading ? "Unlocking..." : "Unlock"}
            </Text>
          </Pressable>

          {showBiometricButton && (
            <Pressable
              style={styles.biometricButton}
              onPress={handleBiometricRetry}
            >
              <BiometricIcon size={24} color="#000" strokeWidth={1.5} />
              <Text style={styles.biometricButtonText}>
                Use {isFaceId ? "Face ID" : "Fingerprint"}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: "Geist_700Bold",
    fontSize: 24,
    color: "#000",
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
  primaryButtonDisabled: {
    opacity: 0.4,
  },
  primaryButtonText: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 16,
    color: "#fff",
  },
  biometricButton: {
    height: 52,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.04)",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  biometricButtonText: {
    fontFamily: "Geist_500Medium",
    fontSize: 16,
    color: "#000",
  },
});
