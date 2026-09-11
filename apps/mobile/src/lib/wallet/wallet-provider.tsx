import {
  getAllUserEmbeddedSolanaWallets,
  getEntropyDetailsFromAccount,
  getUserEmbeddedEthereumWallet,
  useEmbeddedSolanaWallet,
  useIdentityToken,
  useLoginWithSiws,
  usePrivy,
  usePrivyClient,
} from "@privy-io/expo";
import type { User as PrivyUser } from "@privy-io/expo";
import { Keypair } from "@solana/web3.js";
import * as SeedVault from "expo-seed-vault";
import type { VaultAccount } from "expo-seed-vault";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { AppState } from "react-native";

import { isPrivyConfigured } from "@/components/wallet/PrivyProviderRoot";
import {
  identifyWallet,
  resetAnalytics,
  track,
} from "@/lib/analytics/analytics";
import { WALLET_SETUP_EVENTS } from "@/lib/analytics/wallet-setup-events";
import { mmkv } from "@/lib/storage";
import {
  clearWalletSignerCache,
  setWalletSigner,
} from "@/lib/solana/wallet/wallet-details";

import {
  authenticateWithBiometrics,
  disableBiometrics,
  enableBiometrics,
  isBiometricEnabled,
} from "./biometrics";
import {
  deleteCloudBackup,
  refreshCloudBackupIfEnabled,
} from "./icloud-backup";
import {
  clearStoredKeypair,
  consumeBiometricRestorePending,
  getStoredPublicKey,
  hasStoredKeypair,
  importKeypair,
  loadKeypair,
  restoreFromSyncedKeychain as restoreFromSyncedKeypair,
  storeKeypair,
  changePin as changeKeypairPin,
} from "./keypair-storage";
import {
  clearDeeplinkSession,
  loadDeeplinkSession,
  storeDeeplinkSession,
  type StoredDeeplinkSession,
} from "./deeplink-session-storage";
import { DeeplinkSigner, disconnectDeeplinkWallet } from "./deeplink-signer";
import {
  clearMwaAccount,
  loadMwaAccount,
  storeMwaAccount,
  type StoredMwaAccount,
} from "./mwa-account-storage";
import { deauthorizeMwaWallet, MwaSigner } from "./mwa-signer";
import {
  migrateSignerToPrivy,
  PRIVY_MIGRATION_DONE_KEY,
  type PrivyMigrationResult,
} from "./privy-migration";
import { exchangePrivySession } from "./privy-session";
import { PrivyEmbeddedSigner, PrivyExternalWalletError } from "./privy-signer";
import { SeedVaultSigner } from "./seed-vault-signer";
import { LocalKeypairSigner, Signer } from "./signer";
import {
  clearVaultAccount,
  hasVaultAccount,
  loadVaultAccount,
  storeVaultAccount,
} from "./vault-account-storage";

// "vault-unlocked" covers every external-wallet signer (Seed Vault legacy,
// MWA): no local secret, so no lock/unlock lifecycle.
export type WalletState =
  | "loading"
  | "noWallet"
  | "locked"
  | "unlocked"
  | "vault-unlocked";

/** True while the wallet is usable for signing (local unlocked or vault). */
export function isWalletUnlocked(state: WalletState): boolean {
  return state === "unlocked" || state === "vault-unlocked";
}

interface WalletContextValue {
  state: WalletState;
  signer: Signer | null;
  publicKey: string | null;
  onboardingReplayActive: boolean;

  // Wallet setup
  importWallet: (secretKey: Uint8Array, pin: string) => Promise<Keypair>;
  finalizeSigner: (
    keypair: Keypair,
    pin: string,
    opts?: { alreadyStored?: boolean },
  ) => Promise<void>;
  finalizeMwaSigner: (account: StoredMwaAccount) => Promise<void>;
  finalizeDeeplinkSigner: (session: StoredDeeplinkSession) => Promise<void>;
  finalizeVaultSigner: (account: VaultAccount) => Promise<void>;
  /**
   * Privy email/OAuth sign-in: hydrate or create the embedded wallet, then
   * unlock. Throws PrivyExternalWalletError when the user's only wallets are
   * external (connect that wallet instead).
   */
  finalizePrivySigner: (
    user: PrivyUser,
    opts?: { useEmbedded?: boolean },
  ) => Promise<void>;
  /** Legacy signer → Privy SIWS link. "idle" until the first attempt settles. */
  privyMigrationStatus: "idle" | PrivyMigrationResult;

  // Lock / unlock
  unlock: (pin: string) => Promise<void>;
  unlockWithBiometrics: () => Promise<boolean>;
  lock: () => void;

  // Biometrics
  biometricEnabled: boolean;
  setBiometricEnabled: (pin: string, enabled: boolean) => Promise<void>;

  // Management
  changePin: (newPin: string) => Promise<void>;
  resetWallet: (opts?: { keepCloudBackup?: boolean }) => Promise<void>;
  /** Re-read storage after an out-of-band restore (e.g. iCloud backup). */
  refreshFromStorage: () => Promise<void>;
  getSecretKeyHex: () => string | null;
  startOnboardingReplay: () => void;
  finishOnboardingReplay: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

// Set when a sign-in on this device ended on the Privy embedded wallet.
const PRIVY_EMBEDDED_KEY = "loyal:privy-embedded-wallet";

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}

// Everything WalletProviderCore needs from Privy, gathered by hooks that only
// exist under a configured <PrivyProvider>. Null when Privy is not configured.
type PrivyBindings = {
  isReady: boolean;
  user: PrivyUser | null;
  logout: () => Promise<void>;
  wallet: ReturnType<typeof useEmbeddedSolanaWallet>;
  client: ReturnType<typeof usePrivyClient>;
  siws: ReturnType<typeof useLoginWithSiws>;
  getIdentityToken: () => Promise<string | null>;
};

export function WalletProvider({ children }: { children: ReactNode }) {
  if (!isPrivyConfigured()) {
    return <WalletProviderCore privy={null}>{children}</WalletProviderCore>;
  }
  return <WalletProviderWithPrivy>{children}</WalletProviderWithPrivy>;
}

function WalletProviderWithPrivy({ children }: { children: ReactNode }) {
  const { isReady, user, logout } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const client = usePrivyClient();
  const siws = useLoginWithSiws();
  const { getIdentityToken } = useIdentityToken();
  const privy = useMemo<PrivyBindings>(
    () => ({ isReady, user, logout, wallet, client, siws, getIdentityToken }),
    [isReady, user, logout, wallet, client, siws, getIdentityToken],
  );
  return <WalletProviderCore privy={privy}>{children}</WalletProviderCore>;
}

function WalletProviderCore({
  children,
  privy,
}: {
  children: ReactNode;
  privy: PrivyBindings | null;
}) {
  const [state, setState] = useState<WalletState>("loading");
  const [privyMigrationStatus, setPrivyMigrationStatus] = useState<
    "idle" | PrivyMigrationResult
  >("idle");
  const [signer, setSigner] = useState<Signer | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [biometricEnabled, setBiometricEnabledState] = useState(false);
  const [onboardingReplayActive, setOnboardingReplayActive] = useState(false);

  // Initialize — check if a wallet exists (external-wallet metadata wins over
  // local encrypted storage; they are mutually exclusive on disk because
  // resetWallet clears all of them).
  // Privy-only users have no on-device wallet metadata, so wait for the SDK
  // before deciding "noWallet". Legacy metadata wins when both exist: that
  // is the address the user holds funds on.
  const privyReady = privy === null || privy.isReady;
  const privyEmbedded = privy?.wallet.wallets?.[0] ?? null;
  const privyHasUser = privy?.user != null;
  const initialized = useRef(false);
  useEffect(() => {
    if (!privyReady || initialized.current) return;
    initialized.current = true;
    (async () => {
      const mwa = await loadMwaAccount();
      if (mwa) {
        const next = new MwaSigner(mwa.authToken, mwa.publicKey, mwa.label);
        setSigner(next);
        setPublicKey(mwa.publicKey);
        setWalletSigner(next);
        setState("vault-unlocked");
        return;
      }

      const deeplink = await loadDeeplinkSession();
      if (deeplink) {
        const next = new DeeplinkSigner(deeplink);
        setSigner(next);
        setPublicKey(deeplink.publicKey);
        setWalletSigner(next);
        setState("vault-unlocked");
        return;
      }

      const vaultExists = await hasVaultAccount();
      if (vaultExists) {
        const vault = await loadVaultAccount();
        if (vault) {
          const next = new SeedVaultSigner(
            vault.authToken,
            vault.derivationPath,
            vault.publicKey,
          );
          setSigner(next);
          setPublicKey(vault.publicKey);
          setWalletSigner(next);
          setState("vault-unlocked");
          return;
        }
      }

      const exists = await hasStoredKeypair();
      if (exists) {
        const pk = await getStoredPublicKey();
        setPublicKey(pk);
        const bioEnabled = await isBiometricEnabled();
        setBiometricEnabledState(bioEnabled);
        setState("locked");
      } else if (await restoreFromSyncedKeypair()) {
        // Fresh install, but iCloud Keychain carried a wallet from another
        // device — land on the lock screen and let the PIN unlock it.
        setPublicKey(await getStoredPublicKey());
        setState("locked");
      } else if (
        privyHasUser &&
        privyEmbedded &&
        mmkv.getBoolean(PRIVY_EMBEDDED_KEY)
      ) {
        // Only after a sign-in on this device ended on the embedded wallet.
        // A Privy session alone is not enough: a login that stopped at the
        // external-wallet handoff would otherwise resurface as the embedded
        // address on the next launch.
        const provider = await privyEmbedded.getProvider();
        const next = new PrivyEmbeddedSigner(provider, privyEmbedded.address);
        setSigner(next);
        setPublicKey(privyEmbedded.address);
        setWalletSigner(next);
        setState("vault-unlocked");
      } else {
        setState("noWallet");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once, after Privy is ready
  }, [privyReady]);

  // Auto-lock with 30s grace period — local signers only.
  // Vault-backed signers do not auto-lock; the vault prompts for each signature
  // so there is no in-memory secret to protect.
  const backgroundedAt = useRef<number | null>(null);
  const AUTO_LOCK_GRACE_MS = 30_000;
  const lockInternal = useCallback(() => {
    if (state === "vault-unlocked") return; // no-op for vault
    setSigner(null);
    clearWalletSignerCache();
    setState("locked");
  }, [state]);
  const lock = useCallback(() => {
    lockInternal();
  }, [lockInternal]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background" && state === "unlocked") {
        backgroundedAt.current = Date.now();
      }
      if (
        nextState === "active" &&
        state === "unlocked" &&
        backgroundedAt.current
      ) {
        const elapsed = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (elapsed > AUTO_LOCK_GRACE_MS) {
          lockInternal();
        }
      }
    });
    return () => subscription.remove();
  }, [state, lockInternal]);

  // Import keypair — encrypts + stores but does NOT unlock.
  // Caller goes through biometric setup, then finalizeSigner unlocks.
  const importWallet = useCallback(
    async (secretKey: Uint8Array, pin: string) => importKeypair(secretKey, pin),
    [],
  );

  // Called after biometric setup — persists keypair (create) or just unlocks
  // (import). The Privy SIWS link runs from the migration effect below once
  // `signer` lands, so an imported key joins a Privy user the same way a
  // pre-Privy wallet does after unlock.
  const finalizeSigner = useCallback(
    async (kp: Keypair, pin: string, opts?: { alreadyStored?: boolean }) => {
      if (!opts?.alreadyStored) {
        await storeKeypair(kp, pin);
      }
      const next = new LocalKeypairSigner(kp);
      const pk = kp.publicKey.toBase58();
      setSigner(next);
      setPublicKey(pk);
      setWalletSigner(next);
      setState("unlocked");
      const source: "created" | "imported" = opts?.alreadyStored
        ? "imported"
        : "created";
      identifyWallet(pk, source);
      track(
        source === "imported"
          ? WALLET_SETUP_EVENTS.walletImported
          : WALLET_SETUP_EVENTS.walletCreated,
        { source },
      );
      // Default-on iCloud backup: keep the Drive file in step with the new
      // wallet. Best-effort; the keychain mirror already ran in storeKeypair.
      void refreshCloudBackupIfEnabled();
    },
    [],
  );

  // MWA accounts finalize without PIN/biometric setup. The user's wallet app
  // owns all authorization UI going forward.
  const finalizeMwaSigner = useCallback(async (account: StoredMwaAccount) => {
    await storeMwaAccount(account);
    const next = new MwaSigner(
      account.authToken,
      account.publicKey,
      account.label,
    );
    setSigner(next);
    setPublicKey(account.publicKey);
    setWalletSigner(next);
    setState("vault-unlocked");
    identifyWallet(account.publicKey, "mwa");
    track(WALLET_SETUP_EVENTS.walletCreated, { source: "mwa" });
  }, []);

  // Deeplink (Phantom/Solflare on iOS) accounts finalize without
  // PIN/biometric setup, like MWA: the wallet app owns all approval UI.
  const finalizeDeeplinkSigner = useCallback(
    async (session: StoredDeeplinkSession) => {
      await storeDeeplinkSession(session);
      const next = new DeeplinkSigner(session);
      setSigner(next);
      setPublicKey(session.publicKey);
      setWalletSigner(next);
      setState("vault-unlocked");
      identifyWallet(session.publicKey, "deeplink");
      track(WALLET_SETUP_EVENTS.walletCreated, { source: session.provider });
    },
    [],
  );

  // Legacy direct Seed Vault connect — the onboarding fallback for binaries
  // that predate the MWA native module (pre-42 builds receiving current JS
  // via OTA). Like MWA, finalizes without PIN/biometric setup.
  const finalizeVaultSigner = useCallback(async (account: VaultAccount) => {
    await storeVaultAccount({
      authToken: account.authToken,
      derivationPath: account.derivationPath,
      publicKey: account.publicKey,
    });
    const next = new SeedVaultSigner(
      account.authToken,
      account.derivationPath,
      account.publicKey,
    );
    setSigner(next);
    setPublicKey(account.publicKey);
    setWalletSigner(next);
    setState("vault-unlocked");
    identifyWallet(account.publicKey, "vault");
    track(WALLET_SETUP_EVENTS.walletCreated, { source: "vault" });
  }, []);

  // Best-effort Loyal session from the Privy identity token. Earn routes still
  // accept per-request wallet signatures, so a failure here is not fatal.
  const exchangeSession = useCallback(
    async (address: string) => {
      if (!privy) return;
      try {
        const token = await privy.getIdentityToken();
        if (token) await exchangePrivySession(token, address);
      } catch (error) {
        console.warn("[privy] session exchange failed", error);
      }
    },
    [privy],
  );

  // Email / OAuth sign-in landed on a Privy user. Works from the `user` the
  // login call returned and the Privy client directly: the hook state
  // (`privy.user`, `privy.wallet`) still reflects the pre-login session in
  // this tick. Hydrates the embedded wallet when the user has one, creates
  // it for a brand-new user, and hands off to wallet connect when the only
  // linked wallets are external (Seed Vault, Phantom): minting a second
  // address next to the user's funds would leave the app signing with the
  // wrong one.
  const finalizePrivySigner = useCallback(
    async (user: PrivyUser, opts?: { useEmbedded?: boolean }) => {
      if (!privy) throw new Error("Privy is not configured.");
      // Same precedence as web (privy-session-sync.tsx): an external wallet
      // the user linked themselves is where their funds are, so it wins over
      // an embedded one unless the user picked the embedded one explicitly.
      // Never mint an embedded wallet for a user who has any Solana wallet:
      // it would sit empty next to their real address.
      const external = user.linked_accounts.find(
        (a) =>
          a.type === "wallet" &&
          a.chain_type === "solana" &&
          a.connector_type !== "embedded",
      );
      let account = getAllUserEmbeddedSolanaWallets(user)[0] ?? null;
      if (external && "address" in external && !opts?.useEmbedded) {
        throw new PrivyExternalWalletError(
          external.address,
          "wallet_client_type" in external ? external.wallet_client_type : undefined,
          account?.address,
        );
      }
      if (!account) {
        // A user who got an Ethereum embedded wallet on web must pass it here,
        // or Solana creation fails inside Privy's secure context.
        const created = await privy.client.embeddedWallet.createSolana({
          ethereumAccount: getUserEmbeddedEthereumWallet(user) ?? undefined,
        });
        account = getAllUserEmbeddedSolanaWallets(created.user)[0] ?? null;
        if (!account) throw new Error("Embedded wallet creation returned no wallet.");
      }
      const { entropyId, entropyIdVerifier } = getEntropyDetailsFromAccount(account);
      const provider = await privy.client.embeddedWallet.getSolanaProvider(
        account,
        entropyId,
        entropyIdVerifier,
      );
      const next = new PrivyEmbeddedSigner(provider, account.address);
      mmkv.setBoolean(PRIVY_EMBEDDED_KEY, true);
      void exchangeSession(account.address);
      setSigner(next);
      setPublicKey(account.address);
      setWalletSigner(next);
      setState("vault-unlocked");
      identifyWallet(account.address, "privy");
      track(WALLET_SETUP_EVENTS.walletCreated, { source: "privy" });
    },
    [privy, exchangeSession],
  );

  // Link an existing (legacy) signer to a Privy user via SIWS. Runs once per
  // app session, only while no Privy user is signed in. Local signers reach
  // here after unlock, so the user has just proven presence; hardware
  // signers get one approval prompt. Never blocks: see migrateSignerToPrivy.
  // Keyed by address so a reset → import in the same session links the new
  // key too, while StrictMode double-effects stay single-shot.
  const migrationAttempted = useRef<string | null>(null);
  useEffect(() => {
    if (!privy || !privy.isReady || privy.user || !signer) return;
    if (signer.kind === "privy") return;
    const address = signer.publicKey.toBase58();
    if (migrationAttempted.current === address) return;
    migrationAttempted.current = address;
    void (async () => {
      const result = await migrateSignerToPrivy(signer, privy.siws);
      setPrivyMigrationStatus(result);
      if (result === "done") {
        void exchangeSession(signer.publicKey.toBase58());
        track(WALLET_SETUP_EVENTS.walletCreated, { source: "privy_migration" });
      }
    })();
  }, [privy, signer, exchangeSession]);

  // After a restore path wrote the encrypted keypair directly to storage,
  // transition noWallet -> locked so the normal PIN flow takes over.
  const refreshFromStorage = useCallback(async () => {
    const exists = await hasStoredKeypair();
    if (!exists) return;
    setPublicKey(await getStoredPublicKey());
    setBiometricEnabledState(await isBiometricEnabled());
    setState("locked");
  }, []);

  const unlock = useCallback(async (pin: string) => {
    const kp = await loadKeypair(pin);
    if (!kp) throw new Error("Incorrect PIN");
    const next = new LocalKeypairSigner(kp);
    const pk = kp.publicKey.toBase58();
    setSigner(next);
    setPublicKey(pk);
    setWalletSigner(next);
    setState("unlocked");
    identifyWallet(pk, "imported");
    // Restored wallets (iCloud Keychain / Drive backup) skipped onboarding's
    // biometric setup — re-run it with the PIN we just verified (ASK-2205).
    // enableBiometrics no-ops without hardware/enrollment, like the create flow.
    if (consumeBiometricRestorePending()) {
      try {
        const enabled = await enableBiometrics(pin);
        setBiometricEnabledState(enabled);
      } catch (error) {
        console.warn("[wallet] biometric re-enable after restore failed", error);
      }
    }
  }, []);

  const unlockWithBiometrics = useCallback(async () => {
    const pin = await authenticateWithBiometrics();
    if (!pin) return false;
    try {
      const kp = await loadKeypair(pin);
      if (!kp) return false;
      const next = new LocalKeypairSigner(kp);
      const pk = kp.publicKey.toBase58();
      setSigner(next);
      setPublicKey(pk);
      setWalletSigner(next);
      setState("unlocked");
      identifyWallet(pk, "imported");
      return true;
    } catch {
      return false;
    }
  }, []);

  const setBiometricEnabled = useCallback(
    async (pin: string, enabled: boolean) => {
      if (enabled) {
        await enableBiometrics(pin);
        setBiometricEnabledState(true);
      } else {
        await disableBiometrics();
        setBiometricEnabledState(false);
      }
    },
    [],
  );

  const changePinAction = useCallback(
    async (newPin: string) => {
      if (!signer || !(signer instanceof LocalKeypairSigner)) {
        throw new Error("Wallet must be unlocked");
      }
      await changeKeypairPin(signer.keypair, newPin);
      if (biometricEnabled) {
        await enableBiometrics(newPin);
      }
      // The Drive backup holds the old-PIN blob after a PIN change — refresh
      // it so restore always works with the current PIN.
      void refreshCloudBackupIfEnabled();
    },
    [signer, biometricEnabled],
  );

  const resetWallet = useCallback(
    async (opts?: { keepCloudBackup?: boolean }) => {
      const keepCloudBackup = opts?.keepCloudBackup ?? false;
      // Deauthorize the external wallet first, if there is one. Swallow errors
      // — if the wallet rejects (already revoked, etc.), we still want local
      // cleanup to proceed.
      if (signer instanceof SeedVaultSigner) {
        try {
          await SeedVault.deauthorize(signer.authToken);
        } catch (error) {
          console.warn("[wallet] SeedVault.deauthorize failed", error);
        }
      }
      if (signer instanceof MwaSigner) {
        try {
          await deauthorizeMwaWallet(signer.authToken);
        } catch (error) {
          console.warn("[wallet] MWA deauthorize failed", error);
        }
      }
      if (signer instanceof DeeplinkSigner) {
        try {
          await disconnectDeeplinkWallet(signer.session);
        } catch (error) {
          console.warn("[wallet] deeplink disconnect failed", error);
        }
      }

      if (privy) {
        try {
          await privy.logout();
        } catch (error) {
          console.warn("[wallet] Privy logout failed", error);
        }
      }
      mmkv.setBoolean(PRIVY_MIGRATION_DONE_KEY, false);
      mmkv.setBoolean(PRIVY_EMBEDDED_KEY, false);

      await clearMwaAccount();
      await clearDeeplinkSession();
      await clearVaultAccount();
      await clearStoredKeypair({ keepSyncedKeychain: keepCloudBackup });
      if (!keepCloudBackup) {
        // "Delete everywhere" — a later fresh install must not offer to
        // restore a wallet the user deliberately deleted. "Remove from this
        // device" keeps the iCloud copies restorable (ASK-2206).
        await deleteCloudBackup();
      }
      await disableBiometrics();
      setSigner(null);
      setPublicKey(null);
      clearWalletSignerCache();
      setBiometricEnabledState(false);
      setState("noWallet");
      track(WALLET_SETUP_EVENTS.walletReset, {
        scope: keepCloudBackup ? "device" : "everywhere",
      });
      resetAnalytics();
    },
    [signer, privy],
  );

  const getSecretKeyHex = useCallback(() => {
    if (!signer || !(signer instanceof LocalKeypairSigner)) return null;
    return signer.getSecretKeyHex();
  }, [signer]);

  const startOnboardingReplay = useCallback(() => {
    setOnboardingReplayActive(true);
  }, []);

  const finishOnboardingReplay = useCallback(() => {
    setOnboardingReplayActive(false);
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      state,
      signer,
      publicKey,
      onboardingReplayActive,
      importWallet,
      finalizeSigner,
      finalizeMwaSigner,
      finalizeDeeplinkSigner,
      finalizeVaultSigner,
      finalizePrivySigner,
      privyMigrationStatus,
      unlock,
      unlockWithBiometrics,
      lock,
      biometricEnabled,
      setBiometricEnabled,
      changePin: changePinAction,
      resetWallet,
      refreshFromStorage,
      getSecretKeyHex,
      startOnboardingReplay,
      finishOnboardingReplay,
    }),
    [
      state,
      signer,
      publicKey,
      onboardingReplayActive,
      importWallet,
      finalizeSigner,
      finalizeMwaSigner,
      finalizeDeeplinkSigner,
      finalizeVaultSigner,
      finalizePrivySigner,
      privyMigrationStatus,
      unlock,
      unlockWithBiometrics,
      lock,
      biometricEnabled,
      setBiometricEnabled,
      changePinAction,
      resetWallet,
      refreshFromStorage,
      getSecretKeyHex,
      startOnboardingReplay,
      finishOnboardingReplay,
    ],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}
