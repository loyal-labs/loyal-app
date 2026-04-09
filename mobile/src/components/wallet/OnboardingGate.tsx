import { Keypair } from "@solana/web3.js";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet } from "react-native";
import * as SeedVault from "expo-seed-vault";
import type { VaultAccount } from "expo-seed-vault";

import { LogoHeader } from "@/components/LogoHeader";
import { BiometricSetupScreen } from "@/components/wallet/BiometricSetupScreen";
import { CreateWalletScreen } from "@/components/wallet/CreateWalletScreen";
import { ImportWalletScreen } from "@/components/wallet/ImportWalletScreen";
import { OnboardingSlidesScreen } from "@/components/wallet/OnboardingSlidesScreen";
import { SeedVaultChooserScreen } from "@/components/wallet/SeedVaultChooserScreen";
import { useWallet } from "@/lib/wallet/wallet-provider";
import { Pressable, Text, View } from "@/tw";

type Step =
  | "slides"
  | "choose"
  | "seed-vault"
  | "create"
  | "import"
  | "biometric-setup";
type Flow = "create" | "import" | null;

type Props = {
  mode?: "setup" | "replay";
  onReplayDone?: () => void;
};

export function OnboardingGate({ mode = "setup", onReplayDone }: Props) {
  const { finalizeSigner, finalizeVaultSigner } = useWallet();

  const [step, setStep] = useState<Step>("slides");
  const [flow, setFlow] = useState<Flow>(null);
  const [pendingKeypair, setPendingKeypair] = useState<Keypair | null>(null);
  const [pendingPin, setPendingPin] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [seedVaultAvailable, setSeedVaultAvailable] = useState(false);

  useEffect(() => {
    SeedVault.isAvailable().then(setSeedVaultAvailable);
  }, []);

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

  const handleSeedVaultComplete = useCallback(
    async (account: VaultAccount) => {
      setFinalizing(true);
      await finalizeVaultSigner(account);
    },
    [finalizeVaultSigner],
  );

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

  // --- Slides step ---
  if (step === "slides") {
    return (
      <OnboardingSlidesScreen
        onDone={() => {
          if (mode === "replay") {
            onReplayDone?.();
            return;
          }
          setStep("choose");
        }}
      />
    );
  }

  // --- Choose step ---
  if (step === "choose") {
    return (
      <View className="flex-1 bg-white">
        <LogoHeader />
        <View className="flex-1 items-center justify-center px-6">
          <Text style={styles.title}>Welcome to Loyal</Text>
          <Text style={styles.subtitle}>Your Solana wallet</Text>
          <View className="mt-10 w-full gap-3">
            <Pressable
              style={[
                styles.primaryButton,
                !seedVaultAvailable && styles.disabledButton,
              ]}
              onPress={() => {
                if (!seedVaultAvailable) return;
                setFlow(null);
                setStep("seed-vault");
              }}
              disabled={!seedVaultAvailable}
            >
              <Text
                style={[
                  styles.primaryButtonText,
                  !seedVaultAvailable && styles.disabledButtonText,
                ]}
              >
                Use Seed Vault
              </Text>
            </Pressable>
            {!seedVaultAvailable && (
              <Text style={styles.helperText}>
                Only available on Solana Seeker
              </Text>
            )}
            <Pressable
              style={styles.secondaryButton}
              onPress={() => {
                setFlow("create");
                setStep("create");
              }}
            >
              <Text style={styles.secondaryButtonText}>Create New Wallet</Text>
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
      </View>
    );
  }

  // --- Seed Vault chooser step ---
  if (step === "seed-vault") {
    return (
      <SeedVaultChooserScreen
        onComplete={handleSeedVaultComplete}
        onBack={() => setStep("choose")}
      />
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
  disabledButton: {
    backgroundColor: "rgba(0,0,0,0.08)",
  },
  disabledButtonText: {
    color: "rgba(0,0,0,0.35)",
  },
  helperText: {
    fontFamily: "Geist_400Regular",
    fontSize: 12,
    color: "rgba(0,0,0,0.45)",
    textAlign: "center",
    marginTop: -4,
    marginBottom: 4,
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
