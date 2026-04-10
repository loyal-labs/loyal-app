import { Keypair } from "@solana/web3.js";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator } from "react-native";
import * as SeedVault from "expo-seed-vault";
import type { VaultAccount } from "expo-seed-vault";

import { BiometricSetupScreen } from "@/components/wallet/BiometricSetupScreen";
import { CreateWalletScreen } from "@/components/wallet/CreateWalletScreen";
import { ImportWalletScreen } from "@/components/wallet/ImportWalletScreen";
import { OnboardingSlidesScreen } from "@/components/wallet/OnboardingSlidesScreen";
import { SeedVaultChooserScreen } from "@/components/wallet/SeedVaultChooserScreen";
import {
  getSetupStartStep,
  type OnboardingStartStep,
} from "@/components/wallet/onboarding-slides";
import { WalletSetupOnboardingScreen } from "@/components/wallet/WalletSetupOnboardingScreen";
import { useWallet } from "@/lib/wallet/wallet-provider";
import { Text, View } from "@/tw";

type Step =
  | OnboardingStartStep
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

  const [step, setStep] = useState<Step>(() => getSetupStartStep(mode));
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
          setStep("setup-onboarding");
        }}
      />
    );
  }

  // --- Combined setup onboarding step ---
  if (step === "setup-onboarding") {
    return (
      <WalletSetupOnboardingScreen
        seedVaultAvailable={seedVaultAvailable}
        onUseSeedVault={() => {
          setFlow(null);
          setStep("seed-vault");
        }}
        onCreateWallet={() => {
          setFlow("create");
          setStep("create");
        }}
        onImportWallet={() => {
          setFlow("import");
          setStep("import");
        }}
      />
    );
  }

  // --- Seed Vault chooser step ---
  if (step === "seed-vault") {
    return (
      <SeedVaultChooserScreen
        onComplete={handleSeedVaultComplete}
        onBack={() => setStep("setup-onboarding")}
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
