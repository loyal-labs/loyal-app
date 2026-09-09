import {
  useLoginWithEmail,
  useLoginWithOAuth,
  useLoginWithSiws,
  usePrivy,
} from "@privy-io/expo";
import { Keypair } from "@solana/web3.js";
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

import { BiometricSetupScreen } from "@/components/wallet/BiometricSetupScreen";
import { ImportWalletScreen } from "@/components/wallet/ImportWalletScreen";
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
import { WalletSetupOnboardingScreen } from "@/components/wallet/WalletSetupOnboardingScreen";
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
  findCloudBackup,
  restoreCloudBackup,
  type WalletBackupEnvelope,
} from "@/lib/wallet/icloud-backup";
import {
  connectMwaWallet,
  isMwaSupported,
  MwaSigner,
} from "@/lib/wallet/mwa-signer";
import { privyErrorMessage } from "@/lib/wallet/privy-errors";
import {
  migrateSignerToPrivy,
  PRIVY_MIGRATION_DONE_KEY,
} from "@/lib/wallet/privy-migration";
import { isPrivyUserDecline } from "@/lib/wallet/privy-signer";
import { mmkv } from "@/lib/storage";
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

// "create" and "login" are the same Privy sign-in (email / Google / Apple);
// create ends in a new embedded wallet, login hydrates an existing one.
// "import" is the secret-key + PIN flow, kept for users bringing their own
// key. All end on the same Privy user as a connected wallet does.
type Step = OnboardingStartStep | "create" | "login" | "import" | "biometric-setup";
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
  if (!isPrivyConfigured()) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-8">
        <Text style={styles.unavailableText}>
          Sign-in is unavailable in this build. Update the app or try again
          later.
        </Text>
      </View>
    );
  }
  return <PrivyOnboardingGate mode={mode} onReplayDone={onReplayDone} />;
}

// Rendered only under a configured PrivyProvider: the Privy hooks throw
// without one.
function PrivyOnboardingGate({ mode = "setup", onReplayDone }: Props) {
  const {
    finalizeSigner,
    finalizeMwaSigner,
    finalizeDeeplinkSigner,
    finalizeVaultSigner,
    finalizePrivySigner,
    refreshFromStorage,
  } = useWallet();
  const { user: privyUser, logout: privyLogout } = usePrivy();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { login: loginWithOAuth } = useLoginWithOAuth();
  const siws = useLoginWithSiws();

  // Onboarding only renders when no wallet is set up, so any Privy session
  // still on the device is stale (earlier reset, or a login that ended
  // without a usable wallet). Privy refuses to log in over it.
  const ensurePrivyLoggedOut = useCallback(async () => {
    if (privyUser) await privyLogout();
  }, [privyUser, privyLogout]);

  const [step, setStep] = useState<Step>(() => getSetupStartStep(mode));
  const [pendingKeypair, setPendingKeypair] = useState<Keypair | null>(null);
  const [pendingPin, setPendingPin] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [seedVaultAvailable, setSeedVaultAvailable] = useState(false);
  const [deeplinkWallets, setDeeplinkWallets] = useState<
    DeeplinkWalletProvider[]
  >([]);
  const [connectWalletPending, setConnectWalletPending] = useState(false);
  const [connectWalletError, setConnectWalletError] = useState<string | null>(
    null,
  );
  const [privyPending, setPrivyPending] = useState<PrivySignInMethod | null>(
    null,
  );
  const [privyError, setPrivyError] = useState<string | null>(null);
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
        | "new_wallet"
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
    if (isMwaSupported()) return;
    SeedVault.isAvailable().then(setSeedVaultAvailable);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    getInstalledDeeplinkWallets().then(setDeeplinkWallets);
  }, []);

  // iCloud Drive wallet backup, if the user made one on a previous install
  // (iOS only — findCloudBackup resolves null everywhere else).
  const [cloudBackup, setCloudBackup] = useState<WalletBackupEnvelope | null>(
    null,
  );
  useEffect(() => {
    if (mode !== "setup") return;
    findCloudBackup().then(setCloudBackup);
  }, [mode]);

  const handleRestoreCloudBackup = useCallback(async () => {
    if (!cloudBackup) return;
    setFinalizing(true);
    try {
      await restoreCloudBackup(cloudBackup);
      // Transitions the provider to "locked"; the auth gate swaps this
      // screen for the PIN lock screen. The Privy link runs after unlock.
      await refreshFromStorage();
    } catch (e) {
      setFinalizing(false);
      setConnectWalletError(
        e instanceof Error ? e.message : "Restoring the backup failed",
      );
    }
  }, [cloudBackup, refreshFromStorage]);

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

  // ---- Import (secret key + PIN + biometrics) ----

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
      // Import stored the keypair already; this unlocks. The provider's
      // migration effect then links the new local signer to Privy via SIWS
      // (silent: the app holds the key).
      await finalizeSigner(pendingKeypair, pendingPin, { alreadyStored: true });
      authFlowRef.current?.complete("completion");
    } catch (error) {
      authFlowRef.current?.failFrom("completion", error);
      throw error;
    }
  }, [pendingKeypair, pendingPin, finalizeSigner]);

  // ---- Create (Privy email / OAuth → embedded wallet) ----

  const privyAttempt = useCallback(
    async (method: PrivySignInMethod, run: () => Promise<void>) => {
      if (privyPending) return;
      setPrivyError(null);
      setPrivyPending(method);
      try {
        await run();
        authFlowRef.current?.complete("completion");
      } catch (e) {
        if (isUserCancel(e)) {
          authFlowRef.current?.cancel("wallet_connect");
        } else {
          authFlowRef.current?.failFrom("wallet_connect", e);
          setPrivyError(privyErrorMessage(e));
        }
        setFinalizing(false);
      } finally {
        setPrivyPending(null);
      }
    },
    [privyPending],
  );

  const onSendEmailCode = useCallback(
    async (email: string) => {
      beginAuthFlow("privy_email");
      await privyAttempt("email", async () => {
        await sendCode({ email });
      });
    },
    [privyAttempt, beginAuthFlow, sendCode],
  );

  const onSubmitEmailCode = useCallback(
    async (code: string) => {
      await privyAttempt("email", async () => {
        await ensurePrivyLoggedOut();
        const user = await loginWithCode({
          code,
          disableSignup: step === "login",
        });
        if (!user) throw new Error("Sign-in failed. Check the code and try again.");
        authFlowRef.current?.observe("challenge");
        setFinalizing(true);
        await finalizePrivySigner(user);
      });
    },
    [privyAttempt, ensurePrivyLoggedOut, finalizePrivySigner, loginWithCode, step],
  );

  const onOAuth = useCallback(
    (provider: "google" | "apple") => {
      beginAuthFlow("privy_oauth");
      void privyAttempt(provider, async () => {
        await ensurePrivyLoggedOut();
        const user = await loginWithOAuth({
          provider,
          disableSignup: step === "login",
        });
        // Undefined means the user closed the browser sheet.
        if (!user) throw new WalletRejectedError("Sign-in was cancelled.");
        authFlowRef.current?.observe("challenge");
        setFinalizing(true);
        await finalizePrivySigner(user);
      });
    },
    [privyAttempt, beginAuthFlow, ensurePrivyLoggedOut, finalizePrivySigner, loginWithOAuth, step],
  );

  // ---- Connect wallet (Seed Vault / MWA / deeplink) + Privy SIWS link ----

  // After the legacy connect stored the signer, link it to a Privy user.
  // "declined"/"failed" leave the wallet connected (the provider already
  // finalized it) and migration retries on next launch.
  const linkToPrivy = useCallback(
    async (signer: Signer) => {
      authFlowRef.current?.observe("challenge");
      const address = signer.publicKey.toBase58();
      if (privyUser) {
        const alreadyLinked = privyUser.linked_accounts.some(
          (a) => a.type === "wallet" && "address" in a && a.address === address,
        );
        if (alreadyLinked) {
          // e.g. email login found this external wallet and sent the user
          // here; the session is the right one, no signature needed.
          mmkv.setBoolean(PRIVY_MIGRATION_DONE_KEY, true);
          return;
        }
        await privyLogout();
      }
      await migrateSignerToPrivy(signer, siws);
    },
    [privyUser, privyLogout, siws],
  );

  // Legacy fallback for pre-MWA Seeker builds: authorize a seed directly
  // with the vault. Opens the vault's seed picker first so the user can
  // choose WHICH seed to connect; falls back to an already-authorized seed
  // to recover orphaned auth tokens.
  const connectSeedVault = useCallback(async () => {
    const granted = await SeedVault.requestPermission();
    if (!granted) {
      // Deliberately a failure, not a cancel: this boolean is false for a
      // fresh denial, a permanent "don't ask again" (no dialog shown), a
      // missing manifest permission, and policy blocks alike. Silencing it
      // would hide a packaging bug that breaks connect for every user. The
      // MWA chooser below can cancel because it has a real cancel signal.
      authFlowRef.current?.fail("wallet_connect");
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
    await linkToPrivy(
      new SeedVaultSigner(
        account.authToken,
        account.derivationPath,
        account.publicKey,
      ),
    );
    authFlowRef.current?.complete("completion");
  }, [finalizeVaultSigner, linkToPrivy]);

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
    // Fires when the app regains control with an authorized account
    // (shared contract with ASK-2202).
    track(WALLET_CONNECT_EVENTS.returned, {
      provider: "mwa",
      surface: "onboarding",
    });
    setFinalizing(true);
    await finalizeMwaSigner(account);
    await linkToPrivy(
      new MwaSigner(account.authToken, account.publicKey, account.label),
    );
    authFlowRef.current?.complete("completion");
  }, [finalizeMwaSigner, linkToPrivy]);

  // iOS external-wallet connect over Phantom-style deeplinks. Null from the
  // connect call means the user declined in the wallet or switched back
  // without answering — a choice, not an error.
  const connectDeeplink = useCallback(async () => {
    const provider = await chooseDeeplinkProvider(deeplinkWallets);
    if (!provider) {
      authFlowRef.current?.cancel("wallet_connect");
      return;
    }
    track(WALLET_CONNECT_EVENTS.pressed, { provider, surface: "onboarding" });
    try {
      const session = await connectDeeplinkWallet(provider);
      if (!session) {
        track(WALLET_CONNECT_EVENTS.failed, {
          provider,
          surface: "onboarding",
          reason: "cancelled",
        });
        authFlowRef.current?.cancel("wallet_connect");
        return;
      }
      track(WALLET_CONNECT_EVENTS.returned, {
        provider,
        surface: "onboarding",
      });
      authFlowRef.current?.setWalletAddress(session.publicKey);
      authFlowRef.current?.observe("wallet_connect");
      setFinalizing(true);
      await finalizeDeeplinkSigner(session);
      await linkToPrivy(new DeeplinkSigner(session));
      authFlowRef.current?.complete("completion");
    } catch (e) {
      track(WALLET_CONNECT_EVENTS.failed, {
        provider,
        surface: "onboarding",
        reason: connectFailureReason(e),
      });
      throw e;
    }
  }, [deeplinkWallets, finalizeDeeplinkSigner, linkToPrivy]);

  const handleConnectWallet = useCallback(async () => {
    if (connectWalletPending) return;
    setConnectWalletError(null);
    setConnectWalletPending(true);
    if (connectMode === "mwa") {
      track(WALLET_CONNECT_EVENTS.pressed, {
        provider: "mwa",
        surface: "onboarding",
      });
    }
    beginAuthFlow(connectMode === "seed-vault" ? "seed_vault" : "wallet_adapter");
    try {
      if (connectMode === "seed-vault") {
        await connectSeedVault();
      } else if (connectMode === "deeplink") {
        await connectDeeplink();
      } else {
        await connectMwa();
      }
    } catch (e) {
      authFlowRef.current?.failFrom("wallet_connect", e);
      const msg =
        e instanceof Error ? e.message : "Wallet connection failed";
      if (connectMode === "mwa") {
        track(WALLET_CONNECT_EVENTS.failed, {
          provider: "mwa",
          surface: "onboarding",
          reason: msg,
        });
      }
      setConnectWalletError(msg);
      setFinalizing(false);
    } finally {
      setConnectWalletPending(false);
    }
  }, [
    connectWalletPending,
    connectMode,
    connectSeedVault,
    connectDeeplink,
    connectMwa,
    beginAuthFlow,
  ]);

  if (finalizing) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#000" />
        <Text style={styles.finalizingText}>Setting up your wallet...</Text>
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
        hasCloudBackup={cloudBackup != null}
        connectWalletPending={connectWalletPending}
        connectWalletError={connectWalletError}
        onRestoreCloudBackup={() => {
          void handleRestoreCloudBackup();
        }}
        onConnectWallet={() => {
          void handleConnectWallet();
        }}
        onCreateWallet={() => {
          beginAuthFlow("new_wallet");
          setPrivyError(null);
          navigateToStep("create", "forward");
        }}
        onLogin={() => {
          beginAuthFlow("privy_email");
          setPrivyError(null);
          navigateToStep("login", "forward");
        }}
        onImportWallet={() => {
          beginAuthFlow("import_wallet");
          navigateToStep("import", "forward");
        }}
      />
    );
  } else if (step === "create" || step === "login") {
    content = (
      <PrivySignInScreen
        intent={step}
        pending={privyPending}
        error={privyError}
        onSendEmailCode={onSendEmailCode}
        onSubmitEmailCode={onSubmitEmailCode}
        onOAuth={onOAuth}
        onBack={() => {
          authFlowRef.current?.cancel("intent");
          navigateToStep("setup-onboarding", "backward");
        }}
      />
    );
  } else if (step === "import") {
    content = (
      <ImportWalletScreen
        onComplete={handleImportComplete}
        onBack={() => {
          authFlowRef.current?.cancel("intent");
          navigateToStep("setup-onboarding", "backward");
        }}
      />
    );
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
