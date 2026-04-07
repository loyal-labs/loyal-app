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
  generateKeypair,
  getStoredPublicKey,
  hasStoredKeypair,
  importKeypair,
  loadKeypair,
  changePassword as changeKeypairPassword,
} from "./keypair-storage";

export type WalletState = "loading" | "noWallet" | "locked" | "unlocked";

interface WalletContextValue {
  state: WalletState;
  keypair: Keypair | null;
  publicKey: string | null;

  // Wallet setup
  createWallet: (password: string) => Promise<Keypair>;
  importWallet: (secretKey: Uint8Array, password: string) => Promise<Keypair>;
  finalizeSigner: (keypair: Keypair, password: string) => void;

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

  const createWallet = useCallback(async (password: string) => {
    const kp = await generateKeypair(password);
    return kp;
  }, []);

  const importWallet = useCallback(
    async (secretKey: Uint8Array, password: string) => {
      const kp = await importKeypair(secretKey, password);
      setKeypair(kp);
      setPublicKey(kp.publicKey.toBase58());
      setWalletKeypair(kp);
      setState("unlocked");
      return kp;
    },
    [],
  );

  // Called after backup confirmation (create flow only)
  const finalizeSigner = useCallback(
    (kp: Keypair, _password: string) => {
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
