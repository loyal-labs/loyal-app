import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Keypair } from "@solana/web3.js";
import { ArrowLeft, Copy } from "lucide-react-native";
import { useCallback, useState } from "react";
import { StyleSheet } from "react-native";

import { PinPadInput } from "@/components/wallet/PinPadInput";
import { useWallet } from "@/lib/wallet/wallet-provider";
import { Pressable, ScrollView, Text, View } from "@/tw";

type Step = "pin" | "confirm" | "backup";

type Props = {
  onComplete: (keypair: Keypair, pin: string) => void;
};

export function CreateWalletScreen({ onComplete }: Props) {
  const { createWallet } = useWallet();

  const [step, setStep] = useState<Step>("pin");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [pendingKeypair, setPendingKeypair] = useState<Keypair | null>(null);
  const [copied, setCopied] = useState(false);

  const secretKeyHex = pendingKeypair
    ? Array.from(pendingKeypair.secretKey)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    : "";

  const handlePinComplete = useCallback((nextPin: string) => {
    setPin(nextPin);
    setStep("confirm");
    setConfirmPin("");
    setConfirmError(null);
  }, []);

  const handleConfirmComplete = useCallback((nextConfirmPin: string) => {
    setConfirmPin(nextConfirmPin);

    if (nextConfirmPin !== pin) {
      setConfirmError("PINs don't match");
      setConfirmPin("");
      return;
    }

    setConfirmError(null);
    try {
      const kp = createWallet(nextConfirmPin);
      setPendingKeypair(kp);
      setStep("backup");
    } catch (e) {
      setConfirmError(
        e instanceof Error ? e.message : "Failed to create wallet",
      );
    }
  }, [pin, createWallet]);

  const handleBack = useCallback(() => {
    setStep("pin");
    setConfirmPin("");
    setConfirmError(null);
  }, []);

  const handleCopyKey = useCallback(async () => {
    if (!secretKeyHex) return;
    if (process.env.EXPO_OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    await Clipboard.setStringAsync(secretKeyHex);
    setCopied(true);
    if (process.env.EXPO_OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setTimeout(() => setCopied(false), 2000);
  }, [secretKeyHex]);

  const handleBackupConfirmed = useCallback(() => {
    if (!pendingKeypair) return;
    onComplete(pendingKeypair, pin);
  }, [pendingKeypair, pin, onComplete]);

  // --- PIN step ---
  if (step === "pin") {
    return (
      <ScrollView
        className="flex-1 bg-white"
        contentContainerClassName="flex-grow px-6 pt-16 pb-10"
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-1 justify-center pb-16">
          <Text style={styles.title}>Create PIN</Text>
          <Text style={styles.subtitle}>
            Use a 4-digit PIN to protect your wallet
          </Text>

          <View className="mt-10">
            <PinPadInput
              value={pin}
              onChange={setPin}
              onComplete={handlePinComplete}
            />
          </View>
        </View>
      </ScrollView>
    );
  }

  // --- Confirm step ---
  if (step === "confirm") {
    return (
      <ScrollView
        className="flex-1 bg-white"
        contentContainerClassName="flex-grow px-6 pt-16 pb-10"
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-1 justify-center pb-16">
          <Pressable
            onPress={handleBack}
            hitSlop={16}
            className="mb-6 h-10 w-10 items-center justify-center rounded-full"
            style={{ backgroundColor: "rgba(0,0,0,0.05)" }}
          >
            <ArrowLeft size={20} color="#000" strokeWidth={2} />
          </Pressable>

          <Text style={styles.title}>Confirm PIN</Text>
          <Text style={styles.subtitle}>Enter your PIN again</Text>

          <View className="mt-10">
            <PinPadInput
              value={confirmPin}
              onChange={(value) => {
                setConfirmPin(value);
                if (confirmError) setConfirmError(null);
              }}
              onComplete={handleConfirmComplete}
              error={confirmError}
            />
          </View>
        </View>
      </ScrollView>
    );
  }

  // --- Backup step ---
  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerClassName="flex-grow px-6 pt-16 pb-10"
      keyboardShouldPersistTaps="handled"
    >
      <View className="flex-1">
        <Text style={styles.title}>Save Your Secret Key</Text>
        <Text style={[styles.subtitle, { maxWidth: 320 }]}>
          This is the only way to recover your wallet. Save it somewhere safe.
        </Text>

        <View
          className="mt-8 rounded-2xl p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.03)" }}
        >
          <Text
            className="leading-5"
            style={{
              fontFamily: "Geist_400Regular",
              fontSize: 13,
              color: "#000",
            }}
            selectable
          >
            {secretKeyHex}
          </Text>
        </View>

        <Pressable
          onPress={handleCopyKey}
          className="mt-4 flex-row items-center justify-center gap-2 self-start rounded-xl px-4 py-2.5"
          style={{ backgroundColor: "rgba(0,0,0,0.05)" }}
        >
          <Copy size={16} color="#000" strokeWidth={1.5} />
          <Text
            style={{
              fontFamily: "Geist_600SemiBold",
              fontSize: 14,
              color: "#000",
            }}
          >
            {copied ? "Copied!" : "Copy"}
          </Text>
        </Pressable>
      </View>

      <Pressable onPress={handleBackupConfirmed} style={styles.primaryButton}>
        <Text style={styles.primaryButtonText}>{"I've saved my key"}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: "Geist_700Bold",
    fontSize: 28,
    color: "#000",
    lineHeight: 34,
  },
  subtitle: {
    fontFamily: "Geist_400Regular",
    fontSize: 18,
    color: "rgba(0,0,0,0.5)",
    marginTop: 8,
    lineHeight: 24,
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
});
