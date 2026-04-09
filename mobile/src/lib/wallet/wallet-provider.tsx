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
  clearStoredKeypair,
  generateKeypairInMemory,
  getStoredPublicKey,
  hasStoredKeypair,
  importKeypair,
  loadKeypair,
  storeKeypair,
  changePin as changeKeypairPin,
} from "./keypair-storage";
import { SeedVaultSigner } from "./seed-vault-signer";
import { LocalKeypairSigner, Signer } from "./signer";
import {
  clearVaultAccount,
  hasVaultAccount,
  loadVaultAccount,
  storeVaultAccount,
} from "./vault-account-storage";

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
  createWallet: (pin: string) => Keypair;
  importWallet: (secretKey: Uint8Array, pin: string) => Promise<Keypair>;
  finalizeSigner: (
    keypair: Keypair,
    pin: string,
    opts?: { alreadyStored?: boolean },
  ) => Promise<void>;
  finalizeVaultSigner: (account: VaultAccount) => Promise<void>;

  // Lock / unlock
  unlock: (pin: string) => Promise<void>;
  unlockWithBiometrics: () => Promise<boolean>;
  lock: () => void;

  // Biometrics
  biometricEnabled: boolean;
  setBiometricEnabled: (pin: string, enabled: boolean) => Promise<void>;

  // Management
  changePin: (newPin: string) => Promise<void>;
  resetWallet: () => Promise<void>;
  getSecretKeyHex: () => string | null;
  startOnboardingReplay: () => void;
  finishOnboardingReplay: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>("loading");
  const [signer, setSigner] = useState<Signer | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [biometricEnabled, setBiometricEnabledState] = useState(false);
  const [onboardingReplayActive, setOnboardingReplayActive] = useState(false);

  // Initialize — check if a wallet exists (vault metadata wins over local
  // encrypted storage; they are mutually exclusive on disk because resetWallet
  // clears both).
  useEffect(() => {
    (async () => {
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
      } else {
        setState("noWallet");
      }
    })();
  }, []);

  // Auto-lock with 30s grace period — local signers only.
  // Vault-backed signers do not auto-lock; the vault prompts for each signature
  // so there is no in-memory secret to protect.
  const backgroundedAt = useRef<number | null>(null);
  const AUTO_LOCK_GRACE_MS = 30_000;
  const lock = useCallback(() => {
    if (state === "vault-unlocked") return; // no-op for vault
    setSigner(null);
    clearWalletSignerCache();
    setState("locked");
  }, [state]);

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
          lock();
        }
      }
    });
    return () => subscription.remove();
  }, [state, lock]);

  // Generate keypair in memory only — NOT persisted until finalizeSigner
  const createWallet = useCallback((_pin: string) => {
    return generateKeypairInMemory();
  }, []);

  // Import keypair — encrypts + stores but does NOT unlock.
  // Caller goes through biometric setup, then finalizeSigner unlocks.
  const importWallet = useCallback(
    async (secretKey: Uint8Array, pin: string) => {
      const kp = await importKeypair(secretKey, pin);
      return kp;
    },
    [],
  );

  // Called after biometric setup — persists keypair (create) or just unlocks (import).
  // Import flow already stored the keypair in importWallet; create flow has not.
  const finalizeSigner = useCallback(
    async (kp: Keypair, pin: string, opts?: { alreadyStored?: boolean }) => {
      if (!opts?.alreadyStored) {
        await storeKeypair(kp, pin);
      }
      const next = new LocalKeypairSigner(kp);
      setSigner(next);
      setPublicKey(kp.publicKey.toBase58());
      setWalletSigner(next);
      setState("unlocked");
    },
    [],
  );

  // Seed Vault accounts finalize without PIN/biometric setup. The vault owns
  // all authorization UI going forward.
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
  }, []);

  const unlock = useCallback(async (pin: string) => {
    const kp = await loadKeypair(pin);
    if (!kp) throw new Error("Incorrect PIN");
    const next = new LocalKeypairSigner(kp);
    setSigner(next);
    setPublicKey(kp.publicKey.toBase58());
    setWalletSigner(next);
    setState("unlocked");
  }, []);

  const unlockWithBiometrics = useCallback(async () => {
    const pin = await authenticateWithBiometrics();
    if (!pin) return false;
    try {
      const kp = await loadKeypair(pin);
      if (!kp) return false;
      const next = new LocalKeypairSigner(kp);
      setSigner(next);
      setPublicKey(kp.publicKey.toBase58());
      setWalletSigner(next);
      setState("unlocked");
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
    },
    [signer, biometricEnabled],
  );

  const resetWallet = useCallback(async () => {
    // Deauthorize the vault first, if the current wallet is vault-backed.
    // Swallow errors — if the vault rejects (already revoked, etc.), we
    // still want local cleanup to proceed.
    if (signer instanceof SeedVaultSigner) {
      try {
        await SeedVault.deauthorize(signer.authToken);
      } catch (error) {
        console.warn("[wallet] SeedVault.deauthorize failed", error);
      }
    }

    await clearVaultAccount();
    await clearStoredKeypair();
    await disableBiometrics();
    setSigner(null);
    setPublicKey(null);
    clearWalletSignerCache();
    setBiometricEnabledState(false);
    setState("noWallet");
  }, [signer]);

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
      createWallet,
      importWallet,
      finalizeSigner,
      finalizeVaultSigner,
      unlock,
      unlockWithBiometrics,
      lock,
      biometricEnabled,
      setBiometricEnabled,
      changePin: changePinAction,
      resetWallet,
      getSecretKeyHex,
      startOnboardingReplay,
      finishOnboardingReplay,
    }),
    [
      state,
      signer,
      publicKey,
      onboardingReplayActive,
      createWallet,
      importWallet,
      finalizeSigner,
      finalizeVaultSigner,
      unlock,
      unlockWithBiometrics,
      lock,
      biometricEnabled,
      setBiometricEnabled,
      changePinAction,
      resetWallet,
      getSecretKeyHex,
      startOnboardingReplay,
      finishOnboardingReplay,
    ],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}
