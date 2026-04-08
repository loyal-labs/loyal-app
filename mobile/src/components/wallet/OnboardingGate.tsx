import { Keypair } from "@solana/web3.js";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet } from "react-native";

import { LogoHeader } from "@/components/LogoHeader";
import { BiometricSetupScreen } from "@/components/wallet/BiometricSetupScreen";
import { CreateWalletScreen } from "@/components/wallet/CreateWalletScreen";
import { ImportWalletScreen } from "@/components/wallet/ImportWalletScreen";
import { useWallet } from "@/lib/wallet/wallet-provider";
import { Pressable, SafeAreaView, Text, View } from "@/tw";

type Step = "choose" | "create" | "import" | "biometric-setup";
type Flow = "create" | "import" | null;

export function OnboardingGate() {
  const { finalizeSigner } = useWallet();

  const [step, setStep] = useState<Step>("choose");
  const [flow, setFlow] = useState<Flow>(null);
  const [pendingKeypair, setPendingKeypair] = useState<Keypair | null>(null);
  const [pendingPin, setPendingPin] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  const handleCreateComplete = useCallback(
    (keypair: Keypair, pin: string) => {
      setPendingKeypair(keypair);
      setPendingPin(pin);
      setStep("biometric-setup");
    },
    [],
  );

  const handleImportComplete = useCallback(
    (keypair: Keypair, pin: string) => {
      setPendingKeypair(keypair);
      setPendingPin(pin);
      setStep("biometric-setup");
    },
    [],
  );

  const handleBiometricComplete = useCallback(async () => {
    if (!pendingKeypair || !pendingPin) return;
    setFinalizing(true);
    if (flow === "create") {
      await finalizeSigner(pendingKeypair, pendingPin);
    } else {
      // Import: keypair already stored, just unlock
      await finalizeSigner(pendingKeypair, pendingPin, { alreadyStored: true });
    }
  }, [flow, pendingKeypair, pendingPin, finalizeSigner]);

  // --- Finalizing (encrypting + storing) ---
  if (finalizing) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#000" />
        <Text
          style={{
            fontFamily: "Geist_500Medium",
            fontSize: 15,
            color: "rgba(0,0,0,0.5)",
            marginTop: 16,
          }}
        >
          Setting up your wallet...
        </Text>
      </View>
    );
  }

  // --- Choose step ---
  if (step === "choose") {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <LogoHeader />
        <View className="flex-1 items-center justify-center px-6">
          <Text style={styles.title}>Welcome to Loyal</Text>
          <Text style={styles.subtitle}>Your Solana wallet</Text>
          <View className="mt-10 w-full gap-3">
            <Pressable
              style={styles.primaryButton}
              onPress={() => {
                setFlow("create");
                setStep("create");
              }}
            >
              <Text style={styles.primaryButtonText}>Create New Wallet</Text>
            </Pressable>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => {
                setFlow("import");
                setStep("import");
              }}
            >
              <Text style={styles.secondaryButtonText}>
                Import Existing Wallet
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // --- Create step ---
  if (step === "create") {
    return <CreateWalletScreen onComplete={handleCreateComplete} />;
  }

  // --- Import step ---
  if (step === "import") {
    return <ImportWalletScreen onComplete={handleImportComplete} />;
  }

  // --- Biometric setup step ---
  return (
    <BiometricSetupScreen
      pin={pendingPin!}
      onComplete={handleBiometricComplete}
    />
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: "Geist_700Bold",
    fontSize: 28,
    color: "#000",
    textAlign: "center",
    lineHeight: 34,
  },
  subtitle: {
    fontFamily: "Geist_400Regular",
    fontSize: 16,
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
    fontFamily: "Geist_600SemiBold",
    fontSize: 16,
    color: "#000",
  },
});
