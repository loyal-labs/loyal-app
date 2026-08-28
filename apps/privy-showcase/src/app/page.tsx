"use client";

import type { PreparedLoyalSmartAccountsOperation } from "@loyal-labs/loyal-smart-accounts";
import { compilePreparedOperation } from "@loyal-labs/loyal-smart-accounts-core";
import {
  getAccessToken,
  type WalletWithMetadata,
  usePrivy,
} from "@privy-io/react-auth";
import {
  useSignAndSendTransaction,
  useSignMessage,
  useSignTransaction,
  useWallets,
} from "@privy-io/react-auth/solana";
import {
  calculateKaminoRedeemableLiquidityAmountRaw,
  type KaminoReserveSnapshot,
  parseKaminoReserveSnapshot,
} from "@loyal-labs/smart-account-vaults";
import {
  AccountLayout,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlowDiagram } from "@/components/flow-diagram";
import { OrbAddress, orbUrl, shortSignature } from "@/components/orb-address";
import { YieldCalculator } from "@/components/yield-calculator";
import { CANONICAL_USDC_MINT } from "@/lib/constants";
import { formatUsdc, parseUsdc } from "@/lib/forms";
import {
  readDemoMoneyState,
  resolveDemoMoneyAccounts,
  resolveWalletUsdcAccount,
} from "@/lib/money-state";
import { createOrFindPolicies, findExistingPolicies } from "@/lib/policy-setup";
import { resolveNextTeardownStage, teardownDemo } from "@/lib/policy-teardown";
import {
  assertMainnetConnection,
  createMainnetConnection,
  waitForFinalized,
} from "@/lib/rpc";
import type {
  DemoMoveAction,
  DemoPolicyBundle,
  SponsorStage,
} from "@/lib/sponsor-protocol";
import {
  findExistingSmartAccount,
  prepareSmartAccountCreation,
} from "@/lib/smart-account";

const WALLET_TO_SMART_RAW = 2_000_000n;
const SMART_TO_KAMINO_RAW = 2_000_000n;
const KAMINO_TO_SMART_RAW = 1_000_000n;
const SMART_TO_WALLET_RAW = 1_000_000n;

type Evidence = {
  at: number;
  detail: string;
  label: string;
  signature?: string;
};

type MoveStep = { action: DemoMoveAction; label: string };

const LOOP_STEPS: MoveStep[] = [
  { action: "wallet_to_smart_account", label: "Move 2 USDC to smart account" },
  { action: "smart_account_to_kamino", label: "Move 2 USDC to Kamino" },
  { action: "kamino_to_smart_account", label: "Move 1 USDC back to smart account" },
  { action: "smart_account_to_wallet", label: "Send 1 USDC to wallet" },
];

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}

const pause = (ms: number) =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

export default function Home() {
  const { authenticated, login, logout, ready, user } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const { signMessage } = useSignMessage();
  const { signTransaction } = useSignTransaction();
  const wallet =
    wallets.find(
      (candidate) =>
        "isPrivyWallet" in candidate.standardWallet &&
        candidate.standardWallet.isPrivyWallet === true
    ) ?? null;
  // Effects key on the address string, not the wallet object: Privy's hooks
  // return fresh object identities every render, and object-keyed effects
  // re-fire discovery and subscriptions in a loop.
  const walletAddress = wallet?.address ?? null;
  const evmWalletAddress =
    user?.linkedAccounts.find(
      (account): account is WalletWithMetadata =>
        account.type === "wallet" &&
        account.chainType === "ethereum" &&
        (account.walletClientType === "privy" ||
          account.walletClientType === "privy-v2")
    )?.address ?? null;

  const connection = useMemo(() => createMainnetConnection(), []);
  const [sponsor, setSponsor] = useState<PublicKey | null>(null);
  const [policySigner, setPolicySigner] = useState<PublicKey | null>(null);
  const [settings, setSettings] = useState<PublicKey | null>(null);
  const [accountDiscoveryComplete, setAccountDiscoveryComplete] = useState(false);
  const [existingPolicies, setExistingPolicies] =
    useState<DemoPolicyBundle | null>(null);
  const [residualTeardown, setResidualTeardown] = useState(false);
  const [walletUsdcRaw, setWalletUsdcRaw] = useState(0n);
  const [smartAccountUsdcRaw, setSmartAccountUsdcRaw] = useState(0n);
  const [kaminoPositionRaw, setKaminoPositionRaw] = useState(0n);
  const [status, setStatus] = useState("");
  const [statusKind, setStatusKind] = useState<"error" | "info">("info");
  const [busy, setBusy] = useState(false);
  const [activeMove, setActiveMove] = useState<DemoMoveAction | null>(null);
  const [celebration, setCelebration] = useState<{
    detail: string;
    title: string;
  } | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawDestination, setWithdrawDestination] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const kaminoCollateralRawRef = useRef(0n);
  const kaminoReserveSnapshotRef = useRef<KaminoReserveSnapshot | null>(null);
  const celebrationTimeoutRef = useRef(0);
  const discoveredKeyRef = useRef<string | null>(null);

  const pushEvidence = useCallback((entry: Omit<Evidence, "at">) => {
    setEvidence((current) => [{ ...entry, at: Date.now() }, ...current]);
  }, []);

  const celebrate = useCallback((title: string, detail: string) => {
    window.clearTimeout(celebrationTimeoutRef.current);
    setCelebration({ detail, title });
    celebrationTimeoutRef.current = window.setTimeout(
      () => setCelebration(null),
      5_000
    );
  }, []);

  useEffect(() => () => window.clearTimeout(celebrationTimeoutRef.current), []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/sponsor", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as {
          configurationError?: string;
          error?: string;
          policySigner?: string;
          sponsor?: string;
        };
        if (!response.ok || !body.sponsor) {
          throw new Error(body.error ?? "Loyal backend keys are unavailable.");
        }
        if (!cancelled) {
          setSponsor(new PublicKey(body.sponsor));
          if (body.policySigner) setPolicySigner(new PublicKey(body.policySigner));
          if (body.configurationError) {
            setStatusKind("error");
            setStatus(`Rule setup is blocked: ${body.configurationError}`);
          }
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setStatusKind("error");
          setStatus(error instanceof Error ? error.message : "Backend is unavailable.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadBalances = useCallback(async (): Promise<{
    kaminoUsdcRaw: bigint;
    smartAccountUsdcRaw: bigint;
    walletUsdcRaw: bigint;
  } | null> => {
    if (!walletAddress) return null;
    const walletKey = new PublicKey(walletAddress);
    try {
      if (settings) {
        const money = await readDemoMoneyState({ connection, settings, wallet: walletKey });
        setWalletUsdcRaw(money.walletUsdcRaw);
        setSmartAccountUsdcRaw(money.smartAccountUsdcRaw);
        setKaminoPositionRaw(money.kaminoUsdcRaw);
        kaminoCollateralRawRef.current = money.kaminoCollateralRaw;
        kaminoReserveSnapshotRef.current = money.kaminoReserveSnapshot;
        setBalanceError(null);
        return {
          kaminoUsdcRaw: money.kaminoUsdcRaw,
          smartAccountUsdcRaw: money.smartAccountUsdcRaw,
          walletUsdcRaw: money.walletUsdcRaw,
        };
      }
      const ata = resolveWalletUsdcAccount(walletKey);
      let walletBalanceRaw = 0n;
      try {
        const balance = await connection.getTokenAccountBalance(ata, "finalized");
        walletBalanceRaw = BigInt(balance.value.amount);
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            error.message.toLowerCase().includes("could not find account")
          )
        ) {
          throw error;
        }
      }
      setWalletUsdcRaw(walletBalanceRaw);
      setSmartAccountUsdcRaw(0n);
      setKaminoPositionRaw(0n);
      kaminoCollateralRawRef.current = 0n;
      kaminoReserveSnapshotRef.current = null;
      setBalanceError(null);
      return {
        kaminoUsdcRaw: 0n,
        smartAccountUsdcRaw: 0n,
        walletUsdcRaw: walletBalanceRaw,
      };
    } catch {
      setBalanceError("Finalized balances are unavailable. Check the mainnet RPC.");
      return null;
    }
  }, [connection, settings, walletAddress]);

  const updateKaminoPosition = useCallback(() => {
    const snapshot = kaminoReserveSnapshotRef.current;
    if (!snapshot) return;
    setKaminoPositionRaw(
      calculateKaminoRedeemableLiquidityAmountRaw({
        collateralAmountRaw: kaminoCollateralRawRef.current,
        snapshot,
      })
    );
  }, []);

  const discoverAccountAndPolicies = useCallback(async () => {
    if (!walletAddress || !sponsor) return;
    setAccountDiscoveryComplete(false);
    const walletKey = new PublicKey(walletAddress);
    try {
      const found = await findExistingSmartAccount({ connection, wallet: walletKey });
      if (!found) {
        setSettings(null);
        setExistingPolicies(null);
        return;
      }
      setSettings(found.settings);
      if (!policySigner) {
        setExistingPolicies(null);
        setStatusKind("error");
        setStatus("Smart account found. The delegated policy key is not configured.");
        return;
      }
      const bundle = await findExistingPolicies({
        connection,
        feePayer: sponsor,
        policySigner,
        settings: found.settings,
        wallet: walletKey,
      });
      setExistingPolicies(bundle);
      if (bundle) {
        setResidualTeardown(false);
      } else {
        // No complete rule set. If demo-owned leftovers remain (an
        // interrupted reset), setup must not run on top of them; the scene
        // offers to finish the reset instead.
        const leftover = await resolveNextTeardownStage({
          connection,
          policySigner,
          settings: found.settings,
          sponsor,
          wallet: walletKey,
        });
        setResidualTeardown(leftover !== null);
      }
    } finally {
      setAccountDiscoveryComplete(true);
    }
  }, [connection, policySigner, sponsor, walletAddress]);

  useEffect(() => {
    if (!authenticated || !walletsReady || !walletAddress) return;
    const subscriptionIds: number[] = [];
    const walletKey = new PublicKey(walletAddress);
    const watchedAccounts = settings
      ? (() => {
          const accounts = resolveDemoMoneyAccounts({ settings, wallet: walletKey });
          return [
            {
              address: accounts.walletUsdcAta,
              apply: (data: Buffer) =>
                setWalletUsdcRaw(AccountLayout.decode(data).amount),
            },
            {
              address: accounts.smartAccountUsdcAta,
              apply: (data: Buffer) =>
                setSmartAccountUsdcRaw(AccountLayout.decode(data).amount),
            },
            ...(accounts.kaminoCollateralAta
              ? [
                  {
                    address: accounts.kaminoCollateralAta,
                    apply: (data: Buffer) => {
                      kaminoCollateralRawRef.current =
                        AccountLayout.decode(data).amount;
                      updateKaminoPosition();
                    },
                  },
                ]
              : []),
            {
              address: accounts.kaminoReserve,
              apply: (data: Buffer) => {
                kaminoReserveSnapshotRef.current =
                  parseKaminoReserveSnapshot(data);
                updateKaminoPosition();
              },
            },
          ];
        })()
      : [
          {
            address: resolveWalletUsdcAccount(walletKey),
            apply: (data: Buffer) =>
              setWalletUsdcRaw(AccountLayout.decode(data).amount),
          },
        ];

    void loadBalances();
    for (const account of new Map(
      watchedAccounts.map((entry) => [entry.address.toBase58(), entry])
    ).values()) {
      subscriptionIds.push(
        connection.onAccountChange(
          account.address,
          (accountInfo) => {
            try {
              account.apply(accountInfo.data);
              setBalanceError(null);
            } catch {
              setBalanceError("A live balance update could not be decoded.");
            }
          },
          "finalized"
        )
      );
    }

    return () => {
      for (const subscriptionId of subscriptionIds) {
        void connection.removeAccountChangeListener(subscriptionId);
      }
    };
  }, [
    authenticated,
    connection,
    loadBalances,
    settings,
    updateKaminoPosition,
    walletAddress,
    walletsReady,
  ]);

  useEffect(() => {
    if (!authenticated || !walletsReady || !walletAddress || !sponsor) return;
    const key = `${walletAddress}|${sponsor.toBase58()}|${policySigner?.toBase58() ?? ""}`;
    if (discoveredKeyRef.current === key) return;
    discoveredKeyRef.current = key;
    void discoverAccountAndPolicies().catch((error) => {
      discoveredKeyRef.current = null;
      setStatusKind("error");
      setStatus(error instanceof Error ? error.message : "Discovery failed.");
    });
  }, [
    authenticated,
    discoverAccountAndPolicies,
    policySigner,
    sponsor,
    walletAddress,
    walletsReady,
  ]);

  const run = useCallback(async (label: string, action: () => Promise<void>) => {
    setBusy(true);
    setStatusKind("info");
    setStatus(label);
    try {
      await action();
    } catch (error) {
      setStatusKind("error");
      const message = error instanceof Error ? error.message : "Action failed.";
      setStatus(
        message === "Failed to fetch" || message === "Load failed"
          ? "The network request did not complete. Try again."
          : message.includes("custom program error: 0x190")
            ? "The recurring pull already ran in this window. Reset the demo and set up again for a fresh window."
            : message
      );
    } finally {
      setBusy(false);
    }
  }, []);

  const ensureDemoSession = useCallback(async () => {
    if (!wallet) throw new Error("Continue with email first.");
    const statusResponse = await fetch("/api/sponsor", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "session-status", wallet: wallet.address }),
    });
    if (statusResponse.ok) return;
    const accessToken = await getAccessToken();
    if (!accessToken) throw new Error("The Privy access token is unavailable.");
    setStatus("Approve one wallet challenge to authorize this demo session…");
    const challengeResponse = await fetch("/api/sponsor", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "privy-access-token": accessToken,
      },
      body: JSON.stringify({ kind: "challenge", wallet: wallet.address }),
    });
    const challenge = (await challengeResponse.json()) as {
      challengeId?: string;
      error?: string;
      message?: string;
    };
    if (!challengeResponse.ok || !challenge.challengeId || !challenge.message) {
      throw new Error(challenge.error ?? "Wallet authorization challenge failed.");
    }
    const signed = await signMessage({
      message: new TextEncoder().encode(challenge.message),
      wallet,
    });
    const verifyResponse = await fetch("/api/sponsor", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "privy-access-token": accessToken,
      },
      body: JSON.stringify({
        kind: "verify",
        challengeId: challenge.challengeId,
        signature: bytesToBase64(signed.signature),
        wallet: wallet.address,
      }),
    });
    const verified = (await verifyResponse.json()) as {
      authenticated?: boolean;
      error?: string;
    };
    if (!verifyResponse.ok || !verified.authenticated) {
      throw new Error(verified.error ?? "Wallet authorization failed.");
    }
  }, [signMessage, wallet]);

  /** Sign several independent prepared operations with one Privy approval,
   *  then submit them. Uses the wallet-standard variadic signTransaction
   *  (the "sign all" surface); falls back to one approval per transaction
   *  when the connected wallet does not expose it. */
  const sendSetupBatch = useCallback(
    async (
      entries: Array<{
        label: string;
        prepared: PreparedLoyalSmartAccountsOperation<string>;
        stage: SponsorStage;
      }>,
      settingsAddress: PublicKey
    ) => {
      if (!wallet) throw new Error("Privy wallet is unavailable.");
      await ensureDemoSession();
      await assertMainnetConnection(connection);
      const latest = await connection.getLatestBlockhash("confirmed");
      const transactions = entries.map((entry) =>
        compilePreparedOperation({
          blockhash: latest.blockhash,
          prepared: entry.prepared,
        })
      );
      setStatus(
        `Approve ${entries.length} steps once in Privy: ${entries
          .map((entry) => entry.label.replace("Reset: ", ""))
          .join(", ")}…`
      );
      const feature = (
        wallet.standardWallet.features as Record<string, unknown>
      )["solana:signTransaction"] as
        | {
            signTransaction: (
              ...inputs: Array<{ account: unknown; transaction: Uint8Array }>
            ) => Promise<ReadonlyArray<{ signedTransaction: Uint8Array }>>;
          }
        | undefined;
      const account = wallet.standardWallet.accounts[0];
      let signed: Uint8Array[];
      if (feature && account) {
        const outputs = await feature.signTransaction(
          ...transactions.map((transaction) => ({
            account,
            transaction: transaction.serialize(),
          }))
        );
        signed = outputs.map((output) => output.signedTransaction);
      } else {
        signed = [];
        for (const transaction of transactions) {
          const result = await signTransaction({
            chain: "solana:mainnet",
            transaction: transaction.serialize(),
            wallet,
          });
          signed.push(result.signedTransaction);
        }
      }
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index]!;
        setStatus(`${entry.label}…`);
        const response = await fetch("/api/sponsor", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "setup",
            transaction: bytesToBase64(signed[index]!),
            wallet: wallet.address,
            settings: settingsAddress.toBase58(),
            stage: entry.stage,
          }),
        });
        const result = (await response.json()) as {
          error?: string;
          signature?: string;
        };
        if (!response.ok || !result.signature) {
          throw new Error(result.error ?? `${entry.label} failed safely.`);
        }
        pushEvidence({
          detail: entry.stage.startsWith("teardown-")
            ? "Confirmed on mainnet-beta"
            : "Finalized on mainnet-beta",
          label: entry.label,
          signature: result.signature,
        });
      }
    },
    [
      connection,
      ensureDemoSession,
      pushEvidence,
      signTransaction,
      wallet,
    ]
  );

  const sendSetup = useCallback(
    async (args: {
      autodepositPolicySeed?: bigint;
      label: string;
      prepared: PreparedLoyalSmartAccountsOperation<string>;
      settingsAddress: PublicKey;
      stage: SponsorStage;
    }) => {
      if (!wallet || !sponsor) throw new Error("Privy wallet or sponsor is unavailable.");
      await ensureDemoSession();
      await assertMainnetConnection(connection);
      const latest = await connection.getLatestBlockhash("confirmed");
      const transaction = compilePreparedOperation({
        blockhash: latest.blockhash,
        prepared: args.prepared,
      });
      setStatus(`Approve "${args.label}" in Privy…`);
      const signed = await signTransaction({
        chain: "solana:mainnet",
        transaction: transaction.serialize(),
        wallet,
      });
      const response = await fetch("/api/sponsor", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          kind: "setup",
          transaction: bytesToBase64(signed.signedTransaction),
          wallet: wallet.address,
          settings: args.settingsAddress.toBase58(),
          stage: args.stage,
          ...(args.autodepositPolicySeed === undefined
            ? {}
            : { autodepositPolicySeed: args.autodepositPolicySeed.toString() }),
        }),
      });
      const result = (await response.json()) as { error?: string; signature?: string };
      if (!response.ok || !result.signature) {
        throw new Error(result.error ?? `${args.label} failed safely.`);
      }
      pushEvidence({
        detail: "Finalized on mainnet-beta",
        label: args.label,
        signature: result.signature,
      });
    },
    [connection, ensureDemoSession, pushEvidence, signTransaction, sponsor, wallet]
  );

  async function withdrawWalletUsdc() {
    if (!wallet) throw new Error("Continue with email first.");
    const walletKey = new PublicKey(wallet.address);
    let destination: PublicKey;
    try {
      destination = new PublicKey(withdrawDestination.trim());
    } catch {
      throw new Error("Enter a valid destination Solana address.");
    }
    if (destination.equals(walletKey)) {
      throw new Error("Enter another Solana wallet as the withdrawal destination.");
    }
    const amountRaw = parseUsdc(withdrawAmount.trim());
    if (amountRaw > walletUsdcRaw) {
      throw new Error("Withdrawal amount exceeds the Privy wallet balance.");
    }

    await assertMainnetConnection(connection);
    const sourceUsdc = resolveWalletUsdcAccount(walletKey);
    const destinationUsdc = getAssociatedTokenAddressSync(
      CANONICAL_USDC_MINT,
      destination,
      false,
      TOKEN_PROGRAM_ID
    );
    const latest = await connection.getLatestBlockhash("confirmed");
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: walletKey,
        recentBlockhash: latest.blockhash,
        instructions: [
          createAssociatedTokenAccountIdempotentInstruction(
            walletKey,
            destinationUsdc,
            destination,
            CANONICAL_USDC_MINT,
            TOKEN_PROGRAM_ID
          ),
          createTransferCheckedInstruction(
            sourceUsdc,
            CANONICAL_USDC_MINT,
            destinationUsdc,
            walletKey,
            amountRaw,
            6,
            [],
            TOKEN_PROGRAM_ID
          ),
        ],
      }).compileToV0Message()
    );
    setStatus("Approve the canonical USDC withdrawal in Privy…");
    const sent = await signAndSendTransaction({
      chain: "solana:mainnet",
      transaction: transaction.serialize(),
      wallet,
    });
    const signature = bs58.encode(sent.signature);
    setStatus("Withdrawal submitted. Waiting for mainnet finalization…");
    await waitForFinalized(connection, signature);
    await loadBalances();
    pushEvidence({
      detail: "Privy wallet signed · finalized on mainnet-beta",
      label: `Withdraw ${formatUsdc(amountRaw)} USDC`,
      signature,
    });
    setWithdrawOpen(false);
    setWithdrawAmount("");
    setWithdrawDestination("");
  }

  async function createAccountInner(): Promise<PublicKey> {
    if (!wallet || !sponsor) throw new Error("Continue with email first.");
    const walletKey = new PublicKey(wallet.address);
    const found = await findExistingSmartAccount({ connection, wallet: walletKey });
    if (found) {
      setSettings(found.settings);
      return found.settings;
    }
    const creation = await prepareSmartAccountCreation({
      connection,
      sponsor,
      wallet: walletKey,
    });
    await sendSetup({
      label: "Create sponsored smart account",
      prepared: creation.prepared,
      settingsAddress: creation.settings,
      stage: "settings",
    });
    // The backend already reloaded and validated this exact finalized Settings
    // account before returning success. Use that address immediately; the
    // signer-indexed discovery path will recover it on the next page load.
    setSettings(creation.settings);
    setAccountDiscoveryComplete(true);
    return creation.settings;
  }

  async function createPoliciesInner(settingsAddress: PublicKey) {
    if (!wallet || !sponsor || !policySigner) {
      throw new Error("Continue with email first.");
    }
    const walletKey = new PublicKey(wallet.address);
    await ensureDemoSession();
    setStatus("Loyal is covering the one-time rule setup costs…");
    const prefundResponse = await fetch("/api/sponsor", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "prefund",
        wallet: wallet.address,
        settings: settingsAddress.toBase58(),
      }),
    });
    const prefund = (await prefundResponse.json()) as {
      error?: string;
      signature?: string;
    };
    if (!prefundResponse.ok) {
      throw new Error(prefund.error ?? "Rule setup funding failed safely.");
    }
    if (prefund.signature) {
      pushEvidence({
        detail: "Finalized on mainnet-beta",
        label: "Fund one-time policy setup costs",
        signature: prefund.signature,
      });
    }
    const bundle = await createOrFindPolicies({
      connection,
      feePayer: sponsor,
      policySigner,
      send: ({ autodepositPolicySeed, label, prepared, stage }) =>
        sendSetup({
          autodepositPolicySeed,
          label,
          prepared,
          settingsAddress,
          stage,
        }),
      sendBatch: (entries) => sendSetupBatch(entries, settingsAddress),
      settings: settingsAddress,
      wallet: walletKey,
    });
    setExistingPolicies(bundle);
  }

  // The single progressive setup action: find or create the smart account,
  // then find or create the four rules, in one continuous run. Privy's
  // approval prompts are the only interruptions.
  const runSetup = () =>
    run("Setting up the account…", async () => {
      const settingsAddress = settings ?? (await createAccountInner());
      if (!existingPolicies) await createPoliciesInner(settingsAddress);
      setStatusKind("info");
      setStatus("");
    });

  const executeMove = useCallback(
    async (action: DemoMoveAction, label: string) => {
      if (!wallet || !settings || !existingPolicies) {
        throw new Error("Set up the account first.");
      }
      await ensureDemoSession();
      setActiveMove(action);
      try {
        let snapshot = await loadBalances();
        if (!snapshot) {
          throw new Error("Finalized balances are unavailable. Check the mainnet RPC.");
        }
        for (let attempt = 0; ; attempt++) {
          const response = await fetch("/api/sponsor", {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              kind: "move",
              action,
              wallet: wallet.address,
              settings: settings.toBase58(),
              policies: existingPolicies,
              expected: {
                walletUsdcRaw: snapshot.walletUsdcRaw.toString(),
                smartAccountUsdcRaw: snapshot.smartAccountUsdcRaw.toString(),
                kaminoUsdcRaw: snapshot.kaminoUsdcRaw.toString(),
              },
            }),
          });
          if (response.status === 409 && attempt === 0) {
            // The finalized state moved between our read and the backend's.
            // Re-read once and retry; the backend rejected before submitting.
            snapshot = await loadBalances();
            if (!snapshot) {
              throw new Error("Finalized balances are unavailable. Check the mainnet RPC.");
            }
            continue;
          }
          const result = (await response.json()) as {
            error?: string;
            signature?: string;
            supportingSignatures?: string[];
          };
          if (!response.ok || !result.signature) {
            throw new Error(result.error ?? `${label} failed safely.`);
          }
          for (const signature of result.supportingSignatures ?? []) {
            pushEvidence({
              detail: "One-time Kamino account setup · finalized",
              label: "Prepare Kamino position",
              signature,
            });
          }
          pushEvidence({
            detail: "Policy-signed by Loyal · finalized and reconciled",
            label,
            signature: result.signature,
          });
          break;
        }
        await loadBalances();
      } catch (error) {
        // A failed move often means on-chain state drifted from this tab's
        // view (a reset elsewhere, an exhausted window). Re-discover so the
        // primary action reflects what the chain actually allows.
        void discoverAccountAndPolicies().catch(() => {});
        throw error;
      } finally {
        setActiveMove(null);
      }
    },
    [
      discoverAccountAndPolicies,
      ensureDemoSession,
      existingPolicies,
      loadBalances,
      pushEvidence,
      settings,
      wallet,
    ]
  );

  const runSingleMove = (action: DemoMoveAction, label: string) =>
    run(`${label}…`, async () => {
      await executeMove(action, label);
      setStatus("");
    });

  // The performance: the full loop, in, earn, out, back, with a beat between
  // hops so the eye can follow the money.
  const runLoop = () =>
    run("Running the loop…", async () => {
      for (let index = 0; index < LOOP_STEPS.length; index++) {
        const step = LOOP_STEPS[index]!;
        setStatus(`Hop ${index + 1} of ${LOOP_STEPS.length}: ${step.label}…`);
        await executeMove(step.action, step.label);
        if (index < LOOP_STEPS.length - 1) await pause(900);
      }
      setStatus("");
      celebrate(
        "Money moved itself",
        "The full loop finalized on mainnet with zero wallet signatures."
      );
    });

  const runReset = () =>
    run("Resetting the demo…", async () => {
      if (!wallet || !settings || !policySigner || !sponsor) return;
      await teardownDemo({
        connection,
        policySigner,
        sponsor,
        sendBatch: (entries) => sendSetupBatch(entries, settings),
        settings,
        wallet: new PublicKey(wallet.address),
      });
      setExistingPolicies(null);
      setResidualTeardown(false);
      await loadBalances();
      setStatus("");
      celebrate(
        "Demo reset",
        "Kamino drained, all four rules closed, rents returned to the wallet."
      );
    }).then(() => discoverAccountAndPolicies().catch(() => {}));

  const setupReady = Boolean(settings && existingPolicies && policySigner && sponsor);
  const connectDone = Boolean(authenticated && wallet);
  const fundDone = walletUsdcRaw > 0n;

  return (
    <main>
      <section className="scene">
        <div className="shell">
          <nav className="topbar">
            <div className="brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="Loyal" src="/brand/Logotype.svg" />
              <em>×</em>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="Nerona" className="brand-partner" src="/brand/nerona.svg" />
            </div>
          </nav>

          <header className="scene-head">
            <h1>Money that moves itself</h1>
            <p className="lede">
              At $10 million of user balances this loop pays you about $300,000
              a year. Users earn 5%, you keep 3% of roughly 8% Kamino yield.
              Rates float; the split is set in your contract.
            </p>
          </header>

          <div className="flow-panel">
            {setupReady && (
              <span className="zero-sig">0 wallet signatures from here</span>
            )}
            <FlowDiagram
              activeMove={activeMove}
              kaminoRaw={kaminoPositionRaw}
              smartAccountRaw={smartAccountUsdcRaw}
              walletRaw={walletUsdcRaw}
            />
            {balanceError && <p className="error-note">{balanceError}</p>}
          </div>

          <div className="scene-action">
            {!connectDone ? (
              <button
                data-primary-action
                disabled={!ready || busy || authenticated}
                onClick={login}
              >
                Continue with email
              </button>
            ) : !setupReady ? (
              !fundDone ? (
                <div className="fund-wait">
                  {wallet ? (
                    <div className="address-field">
                      <OrbAddress value={wallet.address} />
                    </div>
                  ) : (
                    <p className="scene-caption">Creating Solana wallet…</p>
                  )}
                  <p className="scene-caption">
                    Send USDC to this address to start. 2 USDC covers the loop.
                  </p>
                </div>
              ) : residualTeardown ? (
                <button
                  data-primary-action
                  disabled={busy || !settings || !policySigner}
                  onClick={() => void runReset()}
                >
                  Finish the reset
                </button>
              ) : (
                <button
                  data-primary-action
                  disabled={busy || !sponsor || !policySigner || !accountDiscoveryComplete || walletUsdcRaw < 1n}
                  onClick={() => void runSetup()}
                >
                  {!accountDiscoveryComplete
                    ? "Checking existing account…"
                    : "Set up the account"}
                </button>
              )
            ) : (
              <button
                data-primary-action
                disabled={busy || walletUsdcRaw < WALLET_TO_SMART_RAW}
                onClick={() => void runLoop()}
              >
                Run the loop
              </button>
            )}
            {connectDone && fundDone && !setupReady && !busy && residualTeardown && (
              <p className="scene-caption">
                A previous reset stopped partway. A couple of approvals finish
                it, then setup can run clean.
              </p>
            )}
            {connectDone && fundDone && !setupReady && !busy && !residualTeardown && (
              <p className="scene-caption">
                One continuous setup. Privy asks for each approval; Loyal pays
                every fee.
              </p>
            )}
            {setupReady && !busy && walletUsdcRaw >= WALLET_TO_SMART_RAW && (
              <p className="scene-caption">
                In, earn, out, back. Four moves, zero signatures.
              </p>
            )}
            {setupReady && !busy && walletUsdcRaw < WALLET_TO_SMART_RAW && (
              <p className="scene-caption">
                Needs at least 2 USDC in the wallet to run again.
              </p>
            )}
            {(busy || statusKind === "error") && status && (
              <p className={`scene-caption${statusKind === "error" ? " error" : ""}`}>
                {busy && <i aria-hidden="true" className="spinner" />}
                {status}
              </p>
            )}
          </div>

          {evidence.length > 0 && (
            <div className="sediment">
              {evidence.map((item, index) => (
                <div className="receipt" key={`${item.label}-${item.at}-${index}`}>
                  <time>
                    {new Date(item.at).toLocaleTimeString([], { hour12: false })}
                  </time>
                  <div className="receipt-main">
                    <b>{item.label}</b>
                    <span>{item.detail}</span>
                  </div>
                  {item.signature && (
                    <a href={orbUrl(item.signature, "tx")} rel="noreferrer" target="_blank">
                      {shortSignature(item.signature)} ↗
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}

          <details className="advanced engineer">
            <summary>Engineer view</summary>
            <div className="evidence-addresses">
              <span>
                <small>Solana Privy wallet</small>
                {wallet ? (
                  <div className="address-field">
                    <OrbAddress value={wallet.address} />
                  </div>
                ) : (
                  <span className="placeholder">Continue with email</span>
                )}
              </span>
              <span>
                <small>EVM Privy wallet</small>
                {evmWalletAddress ? (
                  <div className="address-field">
                    <OrbAddress value={evmWalletAddress} />
                  </div>
                ) : (
                  <span className="placeholder">Continue with email</span>
                )}
              </span>
              <span>
                <small>Smart account (Settings)</small>
                {settings ? (
                  <div className="address-field">
                    <OrbAddress value={settings.toBase58()} />
                  </div>
                ) : (
                  <span className="placeholder">Not created yet</span>
                )}
              </span>
              <span>
                <small>Delegated policy signer</small>
                {policySigner ? (
                  <div className="address-field">
                    <OrbAddress value={policySigner.toBase58()} />
                  </div>
                ) : (
                  <span className="placeholder">Backend unavailable</span>
                )}
              </span>
            </div>
            <div className="move-actions">
              <div>
                <b>Wallet → smart account</b>
                <p>A pre-approved pull moves exactly 2 USDC. No Privy popup.</p>
                <button
                  data-primary-action
                  disabled={!setupReady || busy || walletUsdcRaw < WALLET_TO_SMART_RAW}
                  onClick={() =>
                    void runSingleMove("wallet_to_smart_account", "Move 2 USDC to smart account")
                  }
                >
                  Move 2 USDC to smart account
                </button>
              </div>
              <div>
                <b>Smart account → Kamino</b>
                <p>The deposit rule routes the idle 2 USDC into Main Market only.</p>
                <button
                  data-primary-action
                  disabled={!setupReady || busy || smartAccountUsdcRaw < SMART_TO_KAMINO_RAW}
                  onClick={() =>
                    void runSingleMove("smart_account_to_kamino", "Move 2 USDC to Kamino")
                  }
                >
                  Move 2 USDC to Kamino
                </button>
              </div>
              <div>
                <b>Kamino → smart account</b>
                <p>The withdraw rule brings 1 USDC back, never straight to the wallet.</p>
                <button
                  data-primary-action
                  disabled={!setupReady || busy || kaminoPositionRaw < KAMINO_TO_SMART_RAW}
                  onClick={() =>
                    void runSingleMove("kamino_to_smart_account", "Move 1 USDC back to smart account")
                  }
                >
                  Move 1 USDC back to smart account
                </button>
              </div>
              <div>
                <b>Smart account → wallet</b>
                <p>The exit rule permits only the originating wallet, at most 10 USDC/day.</p>
                <button
                  data-primary-action
                  disabled={!setupReady || busy || smartAccountUsdcRaw < SMART_TO_WALLET_RAW}
                  onClick={() =>
                    void runSingleMove("smart_account_to_wallet", "Send 1 USDC to wallet")
                  }
                >
                  Send 1 USDC to wallet
                </button>
              </div>
            </div>
            <div className="wallet-actions">
              <button
                className="secondary"
                data-primary-action
                disabled={!wallet || busy || walletUsdcRaw === 0n}
                onClick={() => {
                  setWithdrawAmount(formatUsdc(walletUsdcRaw));
                  setWithdrawOpen(true);
                }}
              >
                Withdraw USDC
              </button>
              <button
                className="secondary"
                data-primary-action
                disabled={!wallet || !settings || !policySigner || busy}
                onClick={() => void runReset()}
              >
                Reset the demo
              </button>
              <button className="ghost" disabled={busy} onClick={logout}>
                Sign out
              </button>
            </div>
            {withdrawOpen && (
              <div className="withdraw-form">
                <b>Send USDC to your Solana wallet</b>
                <p>
                  Privy asks for one approval. Only canonical USDC is sent;
                  this embedded wallet pays the Solana network fee.
                </p>
                <label>
                  Destination Solana address
                  <input
                    autoComplete="off"
                    disabled={busy}
                    onChange={(event) => setWithdrawDestination(event.target.value)}
                    placeholder="Your external wallet address"
                    value={withdrawDestination}
                  />
                </label>
                <label>
                  Amount in USDC
                  <input
                    autoComplete="off"
                    disabled={busy}
                    inputMode="decimal"
                    onChange={(event) => setWithdrawAmount(event.target.value)}
                    placeholder="0.00"
                    value={withdrawAmount}
                  />
                </label>
                <small>Available: {formatUsdc(walletUsdcRaw)} USDC</small>
                <div className="withdraw-actions">
                  <button
                    disabled={busy || !withdrawDestination.trim() || !withdrawAmount.trim()}
                    onClick={() =>
                      void run("Preparing canonical USDC withdrawal…", withdrawWalletUsdc)
                    }
                  >
                    Send USDC
                  </button>
                  <button
                    className="ghost"
                    disabled={busy}
                    onClick={() => setWithdrawOpen(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            <p className="foot-line">
              Every receipt opens on Orb Markets. The backend accepts only four
              fixed, pre-approved movements, never an arbitrary transaction,
              amount, token, venue, or destination.
            </p>
          </details>

          <YieldCalculator />
        </div>
      </section>

      {celebration && (
        <div className="celebrate" role="status">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="" src="/brand/success.svg" />
          <div>
            <b>{celebration.title}</b>
            <span>{celebration.detail}</span>
          </div>
        </div>
      )}
    </main>
  );
}
