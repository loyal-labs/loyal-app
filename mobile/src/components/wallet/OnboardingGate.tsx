import { Keypair } from "@solana/web3.js";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet } from "react-native";
import * as SeedVault from "expo-seed-vault";
import type { VaultAccount } from "expo-seed-vault";
import Animated, {
  Easing,
  FadeIn,
  FadeInLeft,
  FadeInRight,
  FadeOut,
} from "react-native-reanimated";

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
type TransitionDirection = "forward" | "backward";

type Props = {
  mode?: "setup" | "replay";
  onReplayDone?: () => void;
};

function getScreenEnteringAnimation(direction: TransitionDirection) {
  const easing = Easing.out(Easing.cubic);

  return direction === "forward"
    ? FadeInRight.duration(240).easing(easing)
    : FadeInLeft.duration(240).easing(easing);
}

const SCREEN_EXITING_ANIMATION = FadeOut.duration(160).easing(
  Easing.out(Easing.quad),
);

export function OnboardingGate({ mode = "setup", onReplayDone }: Props) {
  const { finalizeSigner, finalizeVaultSigner } = useWallet();

  const [step, setStep] = useState<Step>(() => getSetupStartStep(mode));
  const [flow, setFlow] = useState<Flow>(null);
  const [pendingKeypair, setPendingKeypair] = useState<Keypair | null>(null);
  const [pendingPin, setPendingPin] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [seedVaultAvailable, setSeedVaultAvailable] = useState(false);
  const [transitionDirection, setTransitionDirection] =
    useState<TransitionDirection>("forward");
  const [screenAnimationsReady, setScreenAnimationsReady] = useState(false);

  useEffect(() => {
    SeedVault.isAvailable().then(setSeedVaultAvailable);
  }, []);

  useEffect(() => {
    setScreenAnimationsReady(true);
  }, []);

  const navigateToStep = useCallback(
    (nextStep: Step, direction: TransitionDirection = "forward") => {
      setTransitionDirection(direction);
      setStep(nextStep);
    },
    [],
  );

  const handleCreateComplete = useCallback(
    (keypair: Keypair, pin: string) => {
      setPendingKeypair(keypair);
      setPendingPin(pin);
      navigateToStep("biometric-setup", "forward");
    },
    [navigateToStep],
  );

  const handleImportComplete = useCallback(
    (keypair: Keypair, pin: string) => {
      setPendingKeypair(keypair);
      setPendingPin(pin);
      navigateToStep("biometric-setup", "forward");
    },
    [navigateToStep],
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

  let content: React.ReactNode;

  if (step === "slides") {
    content = (
      <OnboardingSlidesScreen
        onDone={() => {
          if (mode === "replay") {
            onReplayDone?.();
            return;
          }
          navigateToStep("setup-onboarding", "forward");
        }}
      />
    );
  } else if (step === "setup-onboarding") {
    content = (
      <WalletSetupOnboardingScreen
        seedVaultAvailable={seedVaultAvailable}
        onUseSeedVault={() => {
          setFlow(null);
          navigateToStep("seed-vault", "forward");
        }}
        onCreateWallet={() => {
          setFlow("create");
          navigateToStep("create", "forward");
        }}
        onImportWallet={() => {
          setFlow("import");
          navigateToStep("import", "forward");
        }}
      />
    );
  } else if (step === "seed-vault") {
    content = (
      <SeedVaultChooserScreen
        onComplete={handleSeedVaultComplete}
        onBack={() => navigateToStep("setup-onboarding", "backward")}
      />
    );
  } else if (step === "create") {
    content = (
      <CreateWalletScreen
        onComplete={handleCreateComplete}
        onBack={() => {
          setFlow(null);
          navigateToStep("setup-onboarding", "backward");
        }}
      />
    );
  } else if (step === "import") {
    content = <ImportWalletScreen onComplete={handleImportComplete} />;
  } else {
    content = (
      <BiometricSetupScreen
        pin={pendingPin!}
        onComplete={handleBiometricComplete}
      />
    );
  }

  return (
    <Animated.View
      key={step}
      style={styles.screen}
      entering={
        screenAnimationsReady
          ? getScreenEnteringAnimation(transitionDirection)
          : FadeIn.duration(0)
      }
      exiting={
        screenAnimationsReady ? SCREEN_EXITING_ANIMATION : FadeOut.duration(0)
      }
    >
      {content}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#fff",
    overflow: "hidden",
  },
});
