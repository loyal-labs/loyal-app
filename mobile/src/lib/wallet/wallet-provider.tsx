import { Keypair } from "@solana/web3.js";
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
import { LocalKeypairSigner, Signer } from "./signer";

export type WalletState = "loading" | "noWallet" | "locked" | "unlocked";

interface WalletContextValue {
  state: WalletState;
  signer: Signer | null;
  publicKey: string | null;
  onboardingReplayActive: boolean;

  // Wallet setup
  createWallet: (pin: string) => Keypair;
  importWallet: (secretKey: Uint8Array, pin: string) => Promise<Keypair>;
  finalizeSigner: (keypair: Keypair, pin: string, opts?: { alreadyStored?: boolean }) => Promise<void>;

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

  // Initialize — check if a wallet exists
  useEffect(() => {
    (async () => {
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

  // Auto-lock with 30s grace period.
  // Record when app went to background; lock only if >30s when it returns.
  const backgroundedAt = useRef<number | null>(null);
  const AUTO_LOCK_GRACE_MS = 30_000;
  const lock = useCallback(() => {
    setSigner(null);
    clearWalletSignerCache();
    setState("locked");
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background" && state === "unlocked") {
        backgroundedAt.current = Date.now();
      }
      if (nextState === "active" && state === "unlocked" && backgroundedAt.current) {
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
    await clearStoredKeypair();
    await disableBiometrics();
    setSigner(null);
    setPublicKey(null);
    clearWalletSignerCache();
    setBiometricEnabledState(false);
    setState("noWallet");
  }, []);

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
