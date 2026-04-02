import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Connection, Keypair } from "@solana/web3.js";
import type { WalletSigner } from "@loyal-labs/wallet-core/types";
import { createKeypairSigner } from "~/src/lib/keypair-signer";
import {
  clearStoredKeypair,
  generateKeypair,
  getStoredPublicKey,
  hasStoredKeypair,
  importKeypair,
  loadKeypair,
} from "~/src/lib/keypair-storage";
import { track } from "~/src/lib/analytics";
import {
  WALLET_SETUP_EVENTS,
  LOCK_METHODS,
} from "~/src/components/wallet/wallet-setup-analytics";
import {
  isBalanceHidden as isBalanceHiddenStorage,
  isWalletUnlocked as isWalletUnlockedStorage,
  lastActivityAt as lastActivityAtStorage,
  networkSelection,
  sessionKeypair as sessionKeypairStorage,
} from "~/src/lib/storage";

// ---------------------------------------------------------------------------
// RPC endpoints (inlined from @loyal-labs/solana-rpc — not available as a
// direct extension dependency yet)
// ---------------------------------------------------------------------------

type Network = "mainnet" | "devnet";

const RPC_ENDPOINTS: Record<Network, string> = {
  mainnet: "https://guendolen-nvqjc4-fast-mainnet.helius-rpc.com",
  devnet: "https://aurora-o23cd4-fast-devnet.helius-rpc.com",
};

function getRpcUrl(network: Network): string {
  return RPC_ENDPOINTS[network];
}

// ---------------------------------------------------------------------------
// Wallet state
// ---------------------------------------------------------------------------

export type WalletState = "loading" | "noWallet" | "locked" | "unlocked";

interface WalletContextValue {
  /** Current wallet lifecycle state */
  state: WalletState;
  /** Active signer — only available when state === "unlocked" */
  signer: WalletSigner | null;
  /** Solana RPC connection for the active network */
  connection: Connection;
  /** Currently selected network */
  network: Network;
  /** Whether the portfolio balance display is hidden */
  balanceHidden: boolean;
  /** Stored public key (available once keypair exists, even if locked) */
  publicKey: string | null;

  // Actions
  createWallet: (pin: string) => Promise<void>;
  importWallet: (secretKey: Uint8Array, pin: string) => Promise<void>;
  unlock: (pin: string) => Promise<void>;
  lock: () => void;
  /** Wipe stored keypair and return to the create wallet screen */
  resetWallet: (initialMode?: "create" | "import") => Promise<void>;
  /** The mode the create screen should open in after a reset */
  resetMode: "create" | "import";
  setNetwork: (network: Network) => Promise<void>;
  toggleBalanceHidden: () => Promise<void>;
  /** Returns the secret key as a byte array. Only available when unlocked. */
  getSecretKey: () => Uint8Array | null;
  /** Activate a previously-generated keypair (used after backup confirmation) */
  finalizeSigner: (keypair: Keypair) => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function useWalletContext(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWalletContext must be used within a WalletProvider");
  }
  return ctx;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WalletState>("loading");
  const [signer, setSigner] = useState<WalletSigner | null>(null);
  const [network, setNetworkState] = useState<Network>("mainnet");
  const [balanceHidden, setBalanceHidden] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  // Keep the active keypair in memory so we can rebuild the signer on network change
  const [activeKeypair, setActiveKeypair] =
    useState<Awaited<ReturnType<typeof loadKeypair>>>(null);

  // Derive connection from network
  const connection = useMemo(
    () => new Connection(getRpcUrl(network), "confirmed"),
    [network]
  );

  // Rebuild signer whenever connection or active keypair changes
  useEffect(() => {
    if (activeKeypair && state === "unlocked") {
      setSigner(createKeypairSigner(activeKeypair, connection));
    }
  }, [connection, activeKeypair, state]);

  // -----------------------------------------------------------------------
  // Initialise: read persisted storage on mount
  // -----------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const [hasKeypair, storedPk, net, hidden, switchKey] = await Promise.all([
        hasStoredKeypair(),
        getStoredPublicKey(),
        networkSelection.getValue(),
        isBalanceHiddenStorage.getValue(),
        sessionKeypairStorage.getValue(),
      ]);

      if (cancelled) return;

      setPublicKey(storedPk);
      setNetworkState(net);
      setBalanceHidden(hidden);

      // Auto-unlock from session keypair (persists across open/close within browser session)
      if (switchKey) {
        try {
          const keypair = Keypair.fromSecretKey(
            new Uint8Array(JSON.parse(switchKey))
          );
          buildSigner(keypair);
          return;
        } catch {
          // Fall through to normal locked state
        }
      }

      setState(hasKeypair ? "locked" : "noWallet");
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  // -----------------------------------------------------------------------
  // Watch storage changes (reactive across popup / side panel)
  // -----------------------------------------------------------------------

  useEffect(() => {
    const unwatchNetwork = networkSelection.watch((value) => {
      setNetworkState(value);
    });
    const unwatchBalance = isBalanceHiddenStorage.watch((value) => {
      setBalanceHidden(value);
    });
    // Background worker may set this to false on idle/timeout
    const unwatchUnlocked = isWalletUnlockedStorage.watch((value) => {
      if (!value && state === "unlocked") {
        track(WALLET_SETUP_EVENTS.walletLocked, {
          method: LOCK_METHODS.autoTimeout,
        });
        setSigner(null);
        setActiveKeypair(null);
        setState("locked");
      }
    });

    return () => {
      unwatchNetwork();
      unwatchBalance();
      unwatchUnlocked();
    };
  }, [state]);

  // -----------------------------------------------------------------------
  // Activity heartbeat — throttled, updates last-activity for auto-lock
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (state !== "unlocked") return;
    let lastSent = Date.now();
    const onActivity = () => {
      const now = Date.now();
      if (now - lastSent < 30_000) return; // throttle to once per 30s
      lastSent = now;
      void lastActivityAtStorage.setValue(now);
    };
    const events = ["click", "keydown", "scroll", "mousemove"] as const;
    for (const e of events)
      document.addEventListener(e, onActivity, { passive: true });
    return () => {
      for (const e of events) document.removeEventListener(e, onActivity);
    };
  }, [state]);

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  const buildSigner = useCallback(
    (keypair: Awaited<ReturnType<typeof loadKeypair>>) => {
      if (!keypair) return;
      const walletSigner = createKeypairSigner(keypair, connection);
      setSigner(walletSigner);
      setActiveKeypair(keypair);
      setPublicKey(keypair.publicKey.toBase58());
      setState("unlocked");
      void isWalletUnlockedStorage.setValue(true);
      void lastActivityAtStorage.setValue(Date.now());
      // Persist keypair in session storage so reopening doesn't require re-auth
      void sessionKeypairStorage.setValue(
        JSON.stringify(Array.from(keypair.secretKey))
      );
    },
    [connection]
  );

  const createWallet = useCallback(
    async (pin: string) => {
      const keypair = await generateKeypair(pin);
      buildSigner(keypair);
    },
    [buildSigner]
  );

  const importWallet = useCallback(
    async (secretKey: Uint8Array, pin: string) => {
      const keypair = await importKeypair(secretKey, pin);
      buildSigner(keypair);
    },
    [buildSigner]
  );

  const unlock = useCallback(
    async (pin: string) => {
      const keypair = await loadKeypair(pin);
      if (!keypair) {
        throw new Error("Invalid PIN or no stored keypair");
      }
      buildSigner(keypair);
    },
    [buildSigner]
  );

  const lock = useCallback(() => {
    track(WALLET_SETUP_EVENTS.walletLocked, { method: LOCK_METHODS.manual });
    setSigner(null);
    setActiveKeypair(null);
    setState("locked");
    void isWalletUnlockedStorage.setValue(false);
    void sessionKeypairStorage.setValue(null);
  }, []);

  const [resetMode, setResetMode] = useState<"create" | "import">("create");

  const resetWallet = useCallback(
    async (initialMode: "create" | "import" = "create") => {
      setSigner(null);
      setActiveKeypair(null);
      setPublicKey(null);
      setResetMode(initialMode);
      await clearStoredKeypair();
      await isWalletUnlockedStorage.setValue(false);
      await sessionKeypairStorage.setValue(null);
      setState("noWallet");
    },
    []
  );

  const setNetwork = useCallback(async (net: Network) => {
    await networkSelection.setValue(net);
    setNetworkState(net);
  }, []);

  const toggleBalanceHidden = useCallback(() => {
    setBalanceHidden((prev) => {
      const next = !prev;
      void isBalanceHiddenStorage.setValue(next);
      return next;
    });
  }, []);

  const getSecretKey = useCallback((): Uint8Array | null => {
    if (!activeKeypair) return null;
    return activeKeypair.secretKey;
  }, [activeKeypair]);

  const finalizeSigner = useCallback(
    (keypair: Keypair) => {
      buildSigner(keypair);
    },
    [buildSigner]
  );

  const value = useMemo<WalletContextValue>(
    () => ({
      state,
      signer,
      connection,
      network,
      balanceHidden,
      publicKey,
      createWallet,
      importWallet,
      unlock,
      lock,
      resetWallet,
      resetMode,
      setNetwork,
      toggleBalanceHidden,
      getSecretKey,
      finalizeSigner,
    }),
    [
      state,
      signer,
      connection,
      network,
      balanceHidden,
      publicKey,
      createWallet,
      importWallet,
      unlock,
      lock,
      resetWallet,
      resetMode,
      setNetwork,
      toggleBalanceHidden,
      getSecretKey,
      finalizeSigner,
    ]
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}
