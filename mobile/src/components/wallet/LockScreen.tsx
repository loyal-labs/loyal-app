import { Fingerprint, Scan } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, StyleSheet } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { LogoHeader } from "@/components/LogoHeader";
import { PinPadInput } from "@/components/wallet/PinPadInput";
import { getBiometricType } from "@/lib/wallet/biometrics";
import { PinLockedError } from "@/lib/wallet/keypair-storage";
import { WALLET_PIN_LENGTH } from "@/lib/wallet/pin";
import { useWallet } from "@/lib/wallet/wallet-provider";
import { Pressable, Text, View } from "@/tw";

export function LockScreen() {
  const { unlock, unlockWithBiometrics, biometricEnabled } = useWallet();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [biometricType, setBiometricType] = useState<
    "faceid" | "fingerprint" | "none"
  >("none");
  const [biometricFailed, setBiometricFailed] = useState(false);
  const [lockCountdown, setLockCountdown] = useState(0);

  // Track whether biometric auth should be attempted.
  // Only on initial mount when app is already active — NOT when
  // transitioning to background or when user manually locked.
  const didAttemptBiometric = useRef(false);

  // Resolve biometric type on mount
  useEffect(() => {
    if (biometricEnabled) {
      getBiometricType().then(setBiometricType);
    }
  }, [biometricEnabled]);

  // Attempt biometric only when app is active and screen first appears
  useEffect(() => {
    if (!biometricEnabled || didAttemptBiometric.current) return;

    // Only auto-trigger if app is in foreground
    if (AppState.currentState !== "active") return;

    didAttemptBiometric.current = true;
    setUnlocking(true);
    unlockWithBiometrics().then((ok) => {
      if (!ok) {
        setBiometricFailed(true);
        setUnlocking(false);
      }
      // If ok, state transitions to unlocked — component unmounts
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-trigger biometric when app comes back to foreground
  useEffect(() => {
    if (!biometricEnabled) return;

    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        setUnlocking(true);
        unlockWithBiometrics().then((ok) => {
          if (!ok) {
            setBiometricFailed(true);
            setUnlocking(false);
          }
        });
      }
    });
    return () => subscription.remove();
  }, [biometricEnabled, unlockWithBiometrics]);

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

  const tryUnlock = useCallback(async (value: string) => {
    setUnlocking(true);
    setError(null);
    try {
      await unlock(value);
      // State transitions to unlocked — component unmounts
    } catch (e) {
      if (e instanceof PinLockedError) {
        const seconds = Math.ceil(e.remainingMs / 1000);
        setLockCountdown(seconds);
        setError(`Wallet locked for ${seconds}s`);
      } else {
        setError("Incorrect PIN");
      }
      setPin("");
      setUnlocking(false);
    }
  }, [unlock]);

  const handleUnlock = useCallback(async () => {
    if (pin.length !== WALLET_PIN_LENGTH || lockCountdown > 0) return;
    await tryUnlock(pin);
  }, [pin, lockCountdown, tryUnlock]);

  const handlePinComplete = useCallback(
    async (value: string) => {
      if (lockCountdown > 0) return;
      await tryUnlock(value);
    },
    [lockCountdown, tryUnlock],
  );

  const handleBiometricRetry = useCallback(async () => {
    setUnlocking(true);
    const ok = await unlockWithBiometrics();
    if (!ok) {
      setBiometricFailed(true);
      setUnlocking(false);
    }
  }, [unlockWithBiometrics]);

  const isLocked = lockCountdown > 0;
  const showBiometricButton =
    biometricEnabled && biometricFailed && biometricType !== "none" && !unlocking;
  const isFaceId = biometricType === "faceid";
  const BiometricIcon = isFaceId ? Scan : Fingerprint;

  // Full-screen loading overlay while decrypting
  if (unlocking) {
    return (
      <Animated.View
        entering={FadeIn.duration(150)}
        exiting={FadeOut.duration(200)}
        style={styles.loadingContainer}
      >
        <ActivityIndicator size="large" color="#000" />
        <Text style={styles.loadingText}>Unlocking...</Text>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      style={styles.container}
    >
      <LogoHeader />
      <View className="flex-1 items-center justify-center px-6">
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>
          Enter your 4-digit PIN to unlock your wallet
        </Text>

        <View style={{ width: "100%", gap: 16, marginTop: 32 }}>
          <PinPadInput
            value={pin}
            onChange={(value) => {
              setPin(value);
              if (error) setError(null);
            }}
            onComplete={handlePinComplete}
            error={isLocked ? `Wallet locked for ${lockCountdown}s` : error}
            disabled={isLocked}
          />

          <Pressable
            style={[
              styles.primaryButton,
              (isLocked || pin.length !== WALLET_PIN_LENGTH) &&
                styles.primaryButtonDisabled,
            ]}
            onPress={handleUnlock}
            disabled={isLocked || pin.length !== WALLET_PIN_LENGTH}
          >
            <Text style={styles.primaryButtonText}>Unlock</Text>
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
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    fontFamily: "Geist_500Medium",
    fontSize: 15,
    color: "rgba(0,0,0,0.5)",
    marginTop: 16,
  },
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
