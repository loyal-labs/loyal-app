import {
  useLoginWithEmail,
  useLoginWithOAuth,
  useLoginWithSiws,
} from "@privy-io/expo";
import * as SeedVault from "expo-seed-vault";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActionSheetIOS, ActivityIndicator, Platform, StyleSheet } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInLeft,
  FadeInRight,
  FadeOut,
} from "react-native-reanimated";

import { OnboardingSlidesScreen } from "@/components/wallet/OnboardingSlidesScreen";
import {
  getSetupStartStep,
  type OnboardingStartStep,
  type WalletConnectMode,
} from "@/components/wallet/onboarding-slides";
import { isPrivyConfigured } from "@/components/wallet/PrivyProviderRoot";
import {
  type PrivySignInMethod,
  PrivySignInScreen,
} from "@/components/wallet/PrivySignInScreen";
import { track } from "@/lib/analytics/analytics";
import { WALLET_CONNECT_EVENTS } from "@/lib/analytics/wallet-connect-events";
import {
  DeeplinkResponseError,
  type DeeplinkWalletProvider,
} from "@/lib/wallet/deeplink-protocol";
import {
  connectDeeplinkWallet,
  DEEPLINK_WALLET_LABELS,
  DeeplinkSigner,
  getInstalledDeeplinkWallets,
} from "@/lib/wallet/deeplink-signer";
import {
  connectMwaWallet,
  isMwaSupported,
  MwaSigner,
} from "@/lib/wallet/mwa-signer";
import { migrateSignerToPrivy } from "@/lib/wallet/privy-migration";
import { isPrivyUserDecline } from "@/lib/wallet/privy-signer";
import { WalletRejectedError } from "@/lib/wallet/rejection";
import {
  isSeedVaultUserDecline,
  SeedVaultSigner,
} from "@/lib/wallet/seed-vault-signer";
import type { Signer } from "@/lib/wallet/signer";
import { isWalletSessionError } from "@/lib/wallet/wallet-session-error";
import { useWallet } from "@/lib/wallet/wallet-provider";
import {
  type LifecycleFlow,
  startLifecycleFlow,
} from "@/services/observability";
import { Text, View } from "@/tw";

type Step = OnboardingStartStep;
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

// iOS-only by construction: the deeplink connect mode is only reachable on
// iOS, where ActionSheetIOS is the native chooser.
function chooseDeeplinkProvider(
  providers: DeeplinkWalletProvider[],
): Promise<DeeplinkWalletProvider | null> {
  if (providers.length === 1) return Promise.resolve(providers[0]);
  return new Promise((resolve) => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: "Connect Wallet",
        options: [
          ...providers.map((provider) => DEEPLINK_WALLET_LABELS[provider]),
          "Cancel",
        ],
        cancelButtonIndex: providers.length,
      },
      (index) => resolve(index >= providers.length ? null : providers[index]),
    );
  });
}

// `reason` prop for wallet_connect_failed (contract shared with ASK-2199).
function connectFailureReason(error: unknown): string {
  if (isWalletSessionError(error)) return error.failure;
  if (error instanceof DeeplinkResponseError) {
    return `wallet_error_${error.errorCode}`;
  }
  return "unexpected_error";
}

function isUserCancel(error: unknown): boolean {
  return error instanceof WalletRejectedError || isPrivyUserDecline(error);
}

export function OnboardingGate({ mode = "setup", onReplayDone }: Props) {
  const [step, setStep] = useState<Step>(() => getSetupStartStep(mode));
  const [transitionDirection, setTransitionDirection] =
    useState<TransitionDirection>("forward");
  const [screenAnimationsReady, setScreenAnimationsReady] = useState(false);

  useEffect(() => {
    setScreenAnimationsReady(true);
  }, []);

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
          setTransitionDirection("forward");
          setStep("sign-in");
        }}
      />
    );
  } else if (!isPrivyConfigured()) {
    content = (
      <View className="flex-1 items-center justify-center bg-white px-8">
        <Text style={styles.unavailableText}>
          Sign-in is unavailable in this build. Update the app or try again
          later.
        </Text>
      </View>
    );
  } else {
    content = <PrivyOnboarding />;
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

// Rendered only under a configured PrivyProvider: every hook here throws
// without one.
function PrivyOnboarding() {
  const {
    finalizeMwaSigner,
    finalizeDeeplinkSigner,
    finalizeVaultSigner,
    finalizePrivySigner,
  } = useWallet();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { login: loginWithOAuth } = useLoginWithOAuth();
  const siws = useLoginWithSiws();

  const [pending, setPending] = useState<PrivySignInMethod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [seedVaultAvailable, setSeedVaultAvailable] = useState(false);
  const [deeplinkWallets, setDeeplinkWallets] = useState<
    DeeplinkWalletProvider[]
  >([]);

  // One sign-in lifecycle flow per onboarding attempt (ASK-1804). Starting a
  // new attempt cancels the abandoned one; terminal emissions latch, so the
  // blanket cancel never overwrites a completed/failed flow.
  const authFlowRef = useRef<LifecycleFlow<"auth.sign_in"> | null>(null);
  const beginAuthFlow = useCallback(
    (
      variant:
        | "seed_vault"
        | "wallet_adapter"
        | "privy_email"
        | "privy_oauth",
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
  // legacy fallback on pre-MWA Seeker builds receiving this bundle via OTA;
  // Phantom/Solflare deeplinks on iOS when either wallet is installed.
  const connectMode: WalletConnectMode = isMwaSupported()
    ? "mwa"
    : seedVaultAvailable
      ? "seed-vault"
      : deeplinkWallets.length > 0
        ? "deeplink"
        : "none";

  useEffect(() => {
    SeedVault.isAvailable().then(setSeedVaultAvailable);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    getInstalledDeeplinkWallets().then(setDeeplinkWallets);
  }, []);

  // Wrap a sign-in attempt: shared pending/error/cancel handling.
  const attempt = useCallback(
    async (method: PrivySignInMethod, run: () => Promise<void>) => {
      if (pending) return;
      setError(null);
      setPending(method);
      try {
        await run();
        authFlowRef.current?.complete("completion");
      } catch (e) {
        if (isUserCancel(e)) {
          authFlowRef.current?.cancel("wallet_connect");
        } else {
          authFlowRef.current?.failFrom("wallet_connect", e);
          setError(e instanceof Error ? e.message : "Sign-in failed");
        }
        setFinalizing(false);
      } finally {
        setPending(null);
      }
    },
    [pending],
  );

  const onSendEmailCode = useCallback(
    async (email: string) => {
      beginAuthFlow("privy_email");
      await attempt("email", async () => {
        await sendCode({ email });
      });
    },
    [attempt, beginAuthFlow, sendCode],
  );

  const onSubmitEmailCode = useCallback(
    async (code: string) => {
      await attempt("email", async () => {
        await loginWithCode({ code });
        authFlowRef.current?.observe("challenge");
        setFinalizing(true);
        await finalizePrivySigner();
      });
    },
    [attempt, finalizePrivySigner, loginWithCode],
  );

  const onOAuth = useCallback(
    (provider: "google" | "apple") => {
      beginAuthFlow("privy_oauth");
      void attempt(provider, async () => {
        const user = await loginWithOAuth({ provider });
        // Undefined means the user closed the browser sheet.
        if (!user) throw new WalletRejectedError("Sign-in was cancelled.");
        authFlowRef.current?.observe("challenge");
        setFinalizing(true);
        await finalizePrivySigner();
      });
    },
    [attempt, beginAuthFlow, finalizePrivySigner, loginWithOAuth],
  );

  // After the legacy connect stored the signer, link it to a Privy user.
  // "declined"/"failed" leave the wallet connected (the provider already
  // finalized it) and migration retries on next launch.
  const linkToPrivy = useCallback(
    async (signer: Signer) => {
      authFlowRef.current?.observe("challenge");
      await migrateSignerToPrivy(signer, siws);
    },
    [siws],
  );

  // Legacy direct Seed Vault connect for binaries without the MWA module.
  // Opens the vault's seed picker first so the user can choose WHICH seed;
  // falls back to an already-authorized seed to recover orphaned tokens.
  const connectSeedVault = useCallback(async () => {
    const granted = await SeedVault.requestPermission();
    if (!granted) {
      // A failure, not a cancel: false for a fresh denial, "don't ask again",
      // a missing manifest permission, and policy blocks alike.
      throw new Error(
        "Seed Vault access is required. Grant the permission in Settings → Apps → Loyal → Permissions.",
      );
    }
    const account = await SeedVault.authorizeExistingSeed().catch(
      async (authorizeError) => {
        const existing = await SeedVault.listAuthorizedSeeds();
        if (existing.length > 0) return existing[0];
        throw isSeedVaultUserDecline(authorizeError)
          ? new WalletRejectedError("Seed Vault connection was cancelled.")
          : authorizeError;
      },
    );
    authFlowRef.current?.setWalletAddress(account.publicKey);
    authFlowRef.current?.observe("wallet_connect");
    setFinalizing(true);
    await finalizeVaultSigner(account);
    await linkToPrivy(
      new SeedVaultSigner(
        account.authToken,
        account.derivationPath,
        account.publicKey,
      ),
    );
  }, [finalizeVaultSigner, linkToPrivy]);

  const connectMwa = useCallback(async () => {
    track(WALLET_CONNECT_EVENTS.pressed, { provider: "mwa", surface: "onboarding" });
    // Opens the MWA wallet chooser; null means cancelled or declined.
    const account = await connectMwaWallet();
    if (!account) throw new WalletRejectedError();
    authFlowRef.current?.setWalletAddress(account.publicKey);
    authFlowRef.current?.observe("wallet_connect");
    track(WALLET_CONNECT_EVENTS.returned, { provider: "mwa", surface: "onboarding" });
    setFinalizing(true);
    await finalizeMwaSigner(account);
    await linkToPrivy(
      new MwaSigner(account.authToken, account.publicKey, account.label),
    );
  }, [finalizeMwaSigner, linkToPrivy]);

  // iOS external-wallet connect over Phantom-style deeplinks.
  const connectDeeplink = useCallback(async () => {
    const provider = await chooseDeeplinkProvider(deeplinkWallets);
    if (!provider) throw new WalletRejectedError();
    track(WALLET_CONNECT_EVENTS.pressed, { provider, surface: "onboarding" });
    try {
      const session = await connectDeeplinkWallet(provider);
      if (!session) {
        track(WALLET_CONNECT_EVENTS.failed, {
          provider,
          surface: "onboarding",
          reason: "cancelled",
        });
        throw new WalletRejectedError();
      }
      track(WALLET_CONNECT_EVENTS.returned, { provider, surface: "onboarding" });
      authFlowRef.current?.setWalletAddress(session.publicKey);
      authFlowRef.current?.observe("wallet_connect");
      setFinalizing(true);
      await finalizeDeeplinkSigner(session);
      await linkToPrivy(new DeeplinkSigner(session));
    } catch (e) {
      if (!(e instanceof WalletRejectedError)) {
        track(WALLET_CONNECT_EVENTS.failed, {
          provider,
          surface: "onboarding",
          reason: connectFailureReason(e),
        });
      }
      throw e;
    }
  }, [deeplinkWallets, finalizeDeeplinkSigner, linkToPrivy]);

  const onConnectWallet = useCallback(() => {
    beginAuthFlow(connectMode === "seed-vault" ? "seed_vault" : "wallet_adapter");
    void attempt("wallet", async () => {
      try {
        if (connectMode === "seed-vault") await connectSeedVault();
        else if (connectMode === "deeplink") await connectDeeplink();
        else await connectMwa();
      } catch (e) {
        if (connectMode === "mwa" && !isUserCancel(e)) {
          track(WALLET_CONNECT_EVENTS.failed, {
            provider: "mwa",
            surface: "onboarding",
            reason: e instanceof Error ? e.message : "Wallet connection failed",
          });
        }
        throw e;
      }
    });
  }, [attempt, beginAuthFlow, connectMode, connectSeedVault, connectDeeplink, connectMwa]);

  if (finalizing) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#000" />
        <Text style={styles.finalizingText}>Setting up your wallet...</Text>
      </View>
    );
  }

  return (
    <PrivySignInScreen
      connectMode={connectMode}
      seekerWallet={seedVaultAvailable}
      pending={pending}
      error={error}
      onSendEmailCode={onSendEmailCode}
      onSubmitEmailCode={onSubmitEmailCode}
      onOAuth={onOAuth}
      onConnectWallet={onConnectWallet}
    />
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#fff",
    overflow: "hidden",
  },
  finalizingText: {
    fontFamily: "Geist_500Medium",
    fontSize: 15,
    color: "rgba(0,0,0,0.5)",
    marginTop: 16,
  },
  unavailableText: {
    fontFamily: "Geist_500Medium",
    fontSize: 15,
    color: "rgba(0,0,0,0.5)",
    textAlign: "center",
  },
});
