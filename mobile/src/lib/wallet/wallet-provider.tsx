import { Keypair } from "@solana/web3.js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { AppState } from "react-native";

import {
  clearWalletKeypairCache,
  setWalletKeypair,
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
  changePassword as changeKeypairPassword,
} from "./keypair-storage";

export type WalletState = "loading" | "noWallet" | "locked" | "unlocked";

interface WalletContextValue {
  state: WalletState;
  keypair: Keypair | null;
  publicKey: string | null;

  // Wallet setup
  createWallet: (password: string) => Keypair;
  importWallet: (secretKey: Uint8Array, password: string) => Promise<Keypair>;
  finalizeSigner: (keypair: Keypair, password: string, opts?: { alreadyStored?: boolean }) => Promise<void>;

  // Lock / unlock
  unlock: (password: string) => Promise<void>;
  unlockWithBiometrics: () => Promise<boolean>;
  lock: () => void;

  // Biometrics
  biometricEnabled: boolean;
  setBiometricEnabled: (password: string, enabled: boolean) => Promise<void>;

  // Management
  changePassword: (newPassword: string) => Promise<void>;
  resetWallet: () => Promise<void>;
  getSecretKeyHex: () => string | null;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>("loading");
  const [keypair, setKeypair] = useState<Keypair | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [biometricEnabled, setBiometricEnabledState] = useState(false);

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

  // Auto-lock wallet when the app goes to background.
  // Only on "background" — NOT "inactive" which fires transiently
  // during Face ID prompts and other system dialogs.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background" && state === "unlocked") {
        lock();
      }
    });
    return () => subscription.remove();
  }, [state, lock]);

  // Generate keypair in memory only — NOT persisted until finalizeSigner
  const createWallet = useCallback((_password: string) => {
    return generateKeypairInMemory();
  }, []);

  // Import keypair — encrypts + stores but does NOT unlock.
  // Caller goes through biometric setup, then finalizeSigner unlocks.
  const importWallet = useCallback(
    async (secretKey: Uint8Array, password: string) => {
      const kp = await importKeypair(secretKey, password);
      return kp;
    },
    [],
  );

  // Called after biometric setup — persists keypair (create) or just unlocks (import).
  // Import flow already stored the keypair in importWallet; create flow has not.
  const finalizeSigner = useCallback(
    async (kp: Keypair, password: string, opts?: { alreadyStored?: boolean }) => {
      if (!opts?.alreadyStored) {
        await storeKeypair(kp, password);
      }
      setKeypair(kp);
      setPublicKey(kp.publicKey.toBase58());
      setWalletKeypair(kp);
      setState("unlocked");
    },
    [],
  );

  const unlock = useCallback(async (password: string) => {
    const kp = await loadKeypair(password);
    if (!kp) throw new Error("Incorrect password");
    setKeypair(kp);
    setWalletKeypair(kp);
    setState("unlocked");
  }, []);

  const unlockWithBiometrics = useCallback(async () => {
    const password = await authenticateWithBiometrics();
    if (!password) return false;
    try {
      const kp = await loadKeypair(password);
      if (!kp) return false;
      setKeypair(kp);
      setWalletKeypair(kp);
      setState("unlocked");
      return true;
    } catch {
      return false;
    }
  }, []);

  const lock = useCallback(() => {
    setKeypair(null);
    clearWalletKeypairCache();
    setState("locked");
  }, []);

  const setBiometricEnabled = useCallback(
    async (password: string, enabled: boolean) => {
      if (enabled) {
        await enableBiometrics(password);
        setBiometricEnabledState(true);
      } else {
        await disableBiometrics();
        setBiometricEnabledState(false);
      }
    },
    [],
  );

  const changePasswordAction = useCallback(
    async (newPassword: string) => {
      if (!keypair) throw new Error("Wallet must be unlocked");
      await changeKeypairPassword(keypair, newPassword);
      if (biometricEnabled) {
        await enableBiometrics(newPassword);
      }
    },
    [keypair, biometricEnabled],
  );

  const resetWallet = useCallback(async () => {
    await clearStoredKeypair();
    await disableBiometrics();
    setKeypair(null);
    setPublicKey(null);
    clearWalletKeypairCache();
    setBiometricEnabledState(false);
    setState("noWallet");
  }, []);

  const getSecretKeyHex = useCallback(() => {
    if (!keypair) return null;
    return Array.from(keypair.secretKey)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }, [keypair]);

  const value = useMemo<WalletContextValue>(
    () => ({
      state,
      keypair,
      publicKey,
      createWallet,
      importWallet,
      finalizeSigner,
      unlock,
      unlockWithBiometrics,
      lock,
      biometricEnabled,
      setBiometricEnabled,
      changePassword: changePasswordAction,
      resetWallet,
      getSecretKeyHex,
    }),
    [
      state,
      keypair,
      publicKey,
      createWallet,
      importWallet,
      finalizeSigner,
      unlock,
      unlockWithBiometrics,
      lock,
      biometricEnabled,
      setBiometricEnabled,
      changePasswordAction,
      resetWallet,
      getSecretKeyHex,
    ],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}
