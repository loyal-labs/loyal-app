import { Keypair } from "@solana/web3.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet } from "react-native";
import * as SeedVault from "expo-seed-vault";
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
import {
  getSetupStartStep,
  type OnboardingStartStep,
  type WalletConnectMode,
} from "@/components/wallet/onboarding-slides";
import { WalletSetupOnboardingScreen } from "@/components/wallet/WalletSetupOnboardingScreen";
import { connectMwaWallet, isMwaSupported } from "@/lib/wallet/mwa-signer";
import { WalletRejectedError } from "@/lib/wallet/rejection";
import { isSeedVaultUserDecline } from "@/lib/wallet/seed-vault-signer";
import { useWallet } from "@/lib/wallet/wallet-provider";
import {
  type LifecycleFlow,
  startLifecycleFlow,
} from "@/services/observability";
import { Text, View } from "@/tw";

type Step =
  | OnboardingStartStep
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
  const { finalizeSigner, finalizeMwaSigner, finalizeVaultSigner } =
    useWallet();

  const [step, setStep] = useState<Step>(() => getSetupStartStep(mode));
  const [flow, setFlow] = useState<Flow>(null);
  const [pendingKeypair, setPendingKeypair] = useState<Keypair | null>(null);
  const [pendingPin, setPendingPin] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [seedVaultAvailable, setSeedVaultAvailable] = useState(false);
  const [connectWalletPending, setConnectWalletPending] = useState(false);
  const [connectWalletError, setConnectWalletError] = useState<string | null>(
    null,
  );
  const [transitionDirection, setTransitionDirection] =
    useState<TransitionDirection>("forward");
  const [screenAnimationsReady, setScreenAnimationsReady] = useState(false);

  // One sign-in lifecycle flow per onboarding attempt (ASK-1804). Starting a
  // new attempt cancels the abandoned one; terminal emissions latch, so the
  // blanket cancel never overwrites a completed/failed flow.
  const authFlowRef = useRef<LifecycleFlow<"auth.sign_in"> | null>(null);
  const beginAuthFlow = useCallback(
    (
      variant:
        | "seed_vault"
        | "wallet_adapter"
        | "import_wallet"
        | "new_wallet",
    ) => {
      authFlowRef.current?.cancel("intent");
      const flow = startLifecycleFlow({
        flowName: "auth.sign_in",
        flowVariant: variant,
      });
      flow.start("intent");
      authFlowRef.current = flow;
      return flow;
    },
    [],
  );

  // MWA when the binary has the native module; direct Seed Vault as the
  // legacy fallback on pre-MWA Seeker builds receiving this bundle via OTA.
  const connectMode: WalletConnectMode = isMwaSupported()
    ? "mwa"
    : seedVaultAvailable
      ? "seed-vault"
      : "none";

  useEffect(() => {
    if (isMwaSupported()) return;
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
      authFlowRef.current?.setWalletAddress(keypair.publicKey.toBase58());
      authFlowRef.current?.observe("challenge");
      setPendingKeypair(keypair);
      setPendingPin(pin);
      navigateToStep("biometric-setup", "forward");
    },
    [navigateToStep],
  );

  const handleImportComplete = useCallback(
    (keypair: Keypair, pin: string) => {
      authFlowRef.current?.setWalletAddress(keypair.publicKey.toBase58());
      authFlowRef.current?.observe("challenge");
      setPendingKeypair(keypair);
      setPendingPin(pin);
      navigateToStep("biometric-setup", "forward");
    },
    [navigateToStep],
  );

  const handleBiometricComplete = useCallback(async () => {
    if (!pendingKeypair || !pendingPin) return;
    setFinalizing(true);
    try {
      if (flow === "create") {
        await finalizeSigner(pendingKeypair, pendingPin);
      } else {
        // Import: keypair already stored, just unlock
        await finalizeSigner(pendingKeypair, pendingPin, {
          alreadyStored: true,
        });
      }
      authFlowRef.current?.complete("completion");
    } catch (error) {
      authFlowRef.current?.failFrom("completion", error);
      throw error;
    }
  }, [flow, pendingKeypair, pendingPin, finalizeSigner]);

  // Legacy fallback for pre-MWA Seeker builds: authorize a seed directly
  // with the vault. Opens the vault's seed picker first so the user can
  // choose WHICH seed to connect; falls back to an already-authorized seed
  // to recover orphaned auth tokens.
  const connectSeedVault = useCallback(async () => {
    const granted = await SeedVault.requestPermission();
    if (!granted) {
      // Denying the OS permission dialog is a user decision, not a fault —
      // same treatment as backing out of the MWA chooser below.
      authFlowRef.current?.cancel("wallet_connect", {
        errorCode: "wallet_rejected",
      });
      setConnectWalletError(
        "Seed Vault access is required. Grant the permission in Settings → Apps → Loyal → Permissions.",
      );
      return;
    }
    const account = await SeedVault.authorizeExistingSeed().catch(
      async (authorizeError) => {
        const existing = await SeedVault.listAuthorizedSeeds();
        if (existing.length > 0) return existing[0];
        // Backing out of the vault's seed picker reaches us as a bare activity
        // result; classify it so it lands as cancelled, not unexpected_error.
        throw isSeedVaultUserDecline(authorizeError)
          ? new WalletRejectedError("Seed Vault connection was cancelled.")
          : authorizeError;
      },
    );
    authFlowRef.current?.setWalletAddress(account.publicKey);
    authFlowRef.current?.observe("wallet_connect");
    setFinalizing(true);
    await finalizeVaultSigner(account);
    authFlowRef.current?.complete("completion");
  }, [finalizeVaultSigner]);

  const connectMwa = useCallback(async () => {
    // Opens the MWA wallet chooser; the user picks the wallet app and
    // account there. Null means they cancelled or declined — no error.
    const account = await connectMwaWallet();
    if (!account) {
      authFlowRef.current?.cancel("wallet_connect");
      return;
    }
    authFlowRef.current?.setWalletAddress(account.publicKey);
    authFlowRef.current?.observe("wallet_connect");
    setFinalizing(true);
    await finalizeMwaSigner(account);
    authFlowRef.current?.complete("completion");
  }, [finalizeMwaSigner]);

  const handleConnectWallet = useCallback(async () => {
    if (connectWalletPending) return;
    setConnectWalletError(null);
    setConnectWalletPending(true);
    beginAuthFlow(connectMode === "seed-vault" ? "seed_vault" : "wallet_adapter");
    try {
      if (connectMode === "seed-vault") {
        await connectSeedVault();
      } else {
        await connectMwa();
      }
    } catch (e) {
      authFlowRef.current?.failFrom("wallet_connect", e);
      const msg =
        e instanceof Error ? e.message : "Wallet connection failed";
      setConnectWalletError(msg);
    } finally {
      setConnectWalletPending(false);
    }
  }, [
    connectWalletPending,
    connectMode,
    connectSeedVault,
    connectMwa,
    beginAuthFlow,
  ]);

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
        surface={mode === "replay" ? "replay" : "setup"}
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
        connectMode={connectMode}
        connectWalletPending={connectWalletPending}
        connectWalletError={connectWalletError}
        onConnectWallet={() => {
          setFlow(null);
          void handleConnectWallet();
        }}
        onCreateWallet={() => {
          beginAuthFlow("new_wallet");
          setFlow("create");
          navigateToStep("create", "forward");
        }}
        onImportWallet={() => {
          beginAuthFlow("import_wallet");
          setFlow("import");
          navigateToStep("import", "forward");
        }}
      />
    );
  } else if (step === "create") {
    content = (
      <CreateWalletScreen
        onComplete={handleCreateComplete}
        onBack={() => {
          authFlowRef.current?.cancel("intent");
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
