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
import {
  demoToast,
  DemoToastHost,
  STAGE_TOAST_MESSAGES,
} from "@/components/demo-toast";
import { FlowDiagram } from "@/components/flow-diagram";
import { OrbAddress, orbUrl, shortSignature } from "@/components/orb-address";
import { ScrollReveals } from "@/components/scroll-reveals";
import { UsdcAmount } from "@/components/usdc-amount";
import { YieldSplit } from "@/components/yield-split";
import { CANONICAL_USDC_MINT } from "@/lib/constants";
import { formatUsdc, parseUsdc } from "@/lib/forms";
import {
  readDemoMoneyState,
  resolveDemoMoneyAccounts,
  resolveWalletUsdcAccount,
} from "@/lib/money-state";
import { createOrFindPolicies, findExistingPolicies } from "@/lib/policy-setup";
import {
  assertMainnetConnection,
  createMainnetConnection,
  waitForConfirmed,
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
const INITIAL_STATUS = "Continue with email to begin.";

type Evidence = {
  at: number;
  detail: string;
  label: string;
  signature?: string;
};

type MoveStep = { action: DemoMoveAction; label: string };

const PAYDAY_STEPS: MoveStep[] = [
  { action: "wallet_to_smart_account", label: "Move 2 USDC to smart account" },
  { action: "smart_account_to_kamino", label: "Move 2 USDC to Kamino" },
];
const PURCHASE_STEPS: MoveStep[] = [
  { action: "kamino_to_smart_account", label: "Move 1 USDC back to smart account" },
  { action: "smart_account_to_wallet", label: "Send 1 USDC to wallet" },
];

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}

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
  const [walletUsdcRaw, setWalletUsdcRaw] = useState(0n);
  const [smartAccountUsdcRaw, setSmartAccountUsdcRaw] = useState(0n);
  const [kaminoPositionRaw, setKaminoPositionRaw] = useState(0n);
  const [status, setStatus] = useState(INITIAL_STATUS);
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

  const pushEvidence = useCallback((entry: Omit<Evidence, "at">) => {
    setEvidence((current) => [{ ...entry, at: Date.now() }, ...current]);
  }, []);

  // Evidence lands as soon as a transaction is confirmed so the demo can
  // keep moving; this quietly upgrades the entry's wording once the same
  // signature reaches finalized commitment.
  const upgradeEvidenceWhenFinalized = useCallback(
    (signature: string) => {
      void waitForFinalized(connection, signature)
        .then(() => {
          setEvidence((current) =>
            current.map((item) =>
              item.signature === signature
                ? {
                    ...item,
                    detail: item.detail
                      .replace("Confirmed", "Finalized")
                      .replace("confirmed", "finalized"),
                  }
                : item
            )
          );
        })
        .catch(() => {});
    },
    [connection]
  );

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
            setStatus(
              `Account sponsorship is ready. Rule setup is blocked: ${body.configurationError}`
            );
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
    if (!wallet) return null;
    const walletKey = new PublicKey(wallet.address);
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
        const balance = await connection.getTokenAccountBalance(ata, "confirmed");
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
  }, [connection, settings, wallet]);

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
    if (!wallet || !sponsor) return;
    setAccountDiscoveryComplete(false);
    setStatus("Looking for an existing smart account…");
    const walletKey = new PublicKey(wallet.address);
    try {
      const found = await findExistingSmartAccount({ connection, wallet: walletKey });
      if (!found) {
        setSettings(null);
        setExistingPolicies(null);
        setStatus("Wallet connected. Next: create the smart account. Loyal sponsors it.");
        return;
      }
      setSettings(found.settings);
      if (!policySigner) {
        setExistingPolicies(null);
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
      setStatus(
        bundle
          ? "Smart account and all four rules found. Money can move, zero signatures needed."
          : "Smart account found. Next: turn on its four rules."
      );
    } finally {
      setAccountDiscoveryComplete(true);
    }
  }, [connection, policySigner, sponsor, wallet]);

  useEffect(() => {
    if (!authenticated || !walletsReady || !wallet) return;
    const subscriptionIds: number[] = [];
    const walletKey = new PublicKey(wallet.address);
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
          "confirmed"
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
    wallet,
    walletsReady,
  ]);

  useEffect(() => {
    if (!authenticated || !walletsReady || !wallet || !sponsor) return;
    void discoverAccountAndPolicies().catch((error) => {
      setStatusKind("error");
      setStatus(error instanceof Error ? error.message : "Discovery failed.");
    });
  }, [authenticated, discoverAccountAndPolicies, sponsor, wallet, walletsReady]);

  const run = useCallback(async (label: string, action: () => Promise<void>) => {
    setBusy(true);
    setStatusKind("info");
    setStatus(label);
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Action failed.";
      setStatusKind("error");
      setStatus(message);
      demoToast.error(message);
    } finally {
      setBusy(false);
      demoToast.settle();
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
      setStatus(`One-time setup: approve "${args.label}" in Privy…`);
      demoToast.loading(STAGE_TOAST_MESSAGES[args.stage]);
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
        detail: "Confirmed on mainnet-beta",
        label: args.label,
        signature: result.signature,
      });
      upgradeEvidenceWhenFinalized(result.signature);
    },
    [
      connection,
      ensureDemoSession,
      pushEvidence,
      signTransaction,
      sponsor,
      upgradeEvidenceWhenFinalized,
      wallet,
    ]
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
    demoToast.loading("Approve the withdrawal in Privy");
    const sent = await signAndSendTransaction({
      chain: "solana:mainnet",
      transaction: transaction.serialize(),
      wallet,
    });
    const signature = bs58.encode(sent.signature);
    setStatus("Withdrawal submitted. Waiting for mainnet confirmation…");
    demoToast.loading("Confirming");
    await waitForConfirmed(connection, signature);
    await loadBalances();
    pushEvidence({
      detail: "Privy wallet signed · confirmed on mainnet-beta",
      label: `Withdraw ${formatUsdc(amountRaw)} USDC`,
      signature,
    });
    upgradeEvidenceWhenFinalized(signature);
    setWithdrawOpen(false);
    setWithdrawAmount("");
    setWithdrawDestination("");
    setStatus(`Withdrawal confirmed to ${destination.toBase58()}.`);
    demoToast.success("Withdrawal confirmed");
  }

  async function createAccount() {
    if (!wallet || !sponsor) throw new Error("Continue with email first.");
    const walletKey = new PublicKey(wallet.address);
    const found = await findExistingSmartAccount({ connection, wallet: walletKey });
    if (found) {
      setSettings(found.settings);
      setStatus("Existing smart account found. No new account was created.");
      return;
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
    // The backend already reloaded and validated this exact confirmed Settings
    // account before returning success. Use that address immediately; the
    // signer-indexed discovery path will recover it on the next page load.
    setSettings(creation.settings);
    setAccountDiscoveryComplete(true);
    setStatus("Smart account created and confirmed. Next: turn on its four rules.");
    demoToast.success("Smart account created");
  }

  async function createPolicies() {
    if (!wallet || !sponsor || !policySigner || !settings) {
      throw new Error("Create or find the smart account first.");
    }
    const walletKey = new PublicKey(wallet.address);
    await ensureDemoSession();
    setStatus("Loyal is covering the one-time rule setup costs…");
    demoToast.begin("create-policies");
    demoToast.loading("Covering setup costs");
    const prefundResponse = await fetch("/api/sponsor", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "prefund",
        wallet: wallet.address,
        settings: settings.toBase58(),
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
        detail: "Confirmed on mainnet-beta",
        label: "Fund one-time policy setup costs",
        signature: prefund.signature,
      });
      upgradeEvidenceWhenFinalized(prefund.signature);
    }
    const bundle = await createOrFindPolicies({
      connection,
      feePayer: sponsor,
      policySigner,
      settings,
      wallet: walletKey,
      send: ({ autodepositPolicySeed, label, prepared, stage }) =>
        sendSetup({
          autodepositPolicySeed,
          label,
          prepared,
          settingsAddress: settings,
          stage,
        }),
    });
    setExistingPolicies(bundle);
    setStatus(
      "All four rules are live. From here, money moves with zero wallet signatures."
    );
    demoToast.success("All four rules are live");
  }

  const executeMove = useCallback(
    async (action: DemoMoveAction, label: string) => {
      if (!wallet || !settings || !existingPolicies) {
        throw new Error("Turn on the smart account and its four rules first.");
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
              detail: "One-time Kamino account setup · confirmed",
              label: "Prepare Kamino position",
              signature,
            });
            upgradeEvidenceWhenFinalized(signature);
          }
          pushEvidence({
            detail: "Policy-signed by Loyal · confirmed and reconciled",
            label,
            signature: result.signature,
          });
          upgradeEvidenceWhenFinalized(result.signature);
          break;
        }
        await loadBalances();
      } finally {
        setActiveMove(null);
      }
    },
    [
      ensureDemoSession,
      existingPolicies,
      loadBalances,
      pushEvidence,
      settings,
      upgradeEvidenceWhenFinalized,
      wallet,
    ]
  );

  const runSingleMove = (action: DemoMoveAction, label: string) =>
    run(`${label}…`, async () => {
      demoToast.loading(label);
      await executeMove(action, label);
      setStatus(`${label} confirmed on mainnet. Balances update live from chain.`);
      demoToast.success(`${label} · confirmed`);
    });

  const runScenario = (
    name: string,
    flow: "payday" | "purchase",
    steps: MoveStep[]
  ) =>
    run(`${name} starting…`, async () => {
      demoToast.begin(flow);
      for (let index = 0; index < steps.length; index++) {
        const step = steps[index]!;
        setStatus(`${name} · hop ${index + 1} of ${steps.length}: ${step.label}…`);
        demoToast.loading(step.label);
        await executeMove(step.action, step.label);
      }
      setStatus(`${name} complete. Both hops signed by the policy key, not the wallet.`);
      demoToast.success(`${name} complete`);
      celebrate(
        "Money moved itself",
        `${name} confirmed on mainnet with zero wallet signatures.`
      );
    });

  const setupReady = Boolean(settings && existingPolicies && policySigner && sponsor);
  const connectDone = Boolean(authenticated && wallet);
  const fundDone = walletUsdcRaw > 0n;
  const displayedStatus =
    status !== INITIAL_STATUS || !authenticated || !wallet
      ? status
      : settings && existingPolicies
        ? "Smart account and all four rules found. Money can move, zero signatures needed."
        : settings
          ? "Smart account found. Next: turn on its four rules."
          : "Wallet connected. Next: create the smart account. Loyal sponsors it.";

  return (
    <main>
      <DemoToastHost />
      <ScrollReveals />

      <section className="hero">
        <div className="shell">
          <nav className="topbar">
            <div className="brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="Loyal" src="/brand/Logotype.svg" />
              <em>×</em>
              <span>Privy</span>
            </div>
            <div className="network">
              <i /> Solana mainnet-beta
            </div>
          </nav>
          <div className="hero-grid">
            <header data-reveal="fade">
              <h1>Turn idle deposits into revenue</h1>
              <p className="lede">
                Your users&apos; stablecoins earn about 8% in Kamino. They get
                5%, you keep 3%. Loyal automates every move.
              </p>
              <div className="hero-cta">
                <button
                  data-primary-action
                  disabled={!ready || busy || authenticated}
                  onClick={login}
                >
                  {connectDone ? "Connected ✓" : "Continue with email"}
                </button>
              </div>
            </header>
            <div data-reveal="fade" data-reveal-delay="1">
              <YieldSplit />
            </div>
          </div>
        </div>
      </section>

      <div className="shell">
        <section
          className={`status${statusKind === "error" ? " error" : ""}`}
          role="status"
        >
          {busy && <i aria-hidden="true" className="spinner" />}
          <p>{displayedStatus}</p>
        </section>

        <section className="section">
          <div data-reveal="fade">
            <h2 className="section-title">Set up once</h2>
            <p className="section-sub">
              Three steps, one time per user. Loyal sponsors the account, the
              rules, and every network fee after this.
            </p>
          </div>
          <div className="setup-rail">
            <article
              className={`step-card${connectDone ? " done" : ""}`}
              data-reveal="fade"
              data-reveal-delay="1"
            >
              <span className="step-tag">
                <i className="step-num">1</i>
              </span>
              <h3>Your wallet</h3>
              {!connectDone ? (
                <p>
                  Continue with email above. Privy creates embedded Solana and
                  EVM wallets: no seed phrase, no extension.
                </p>
              ) : (
                <>
                  <p>Your embedded Solana wallet, live on mainnet.</p>
                  {wallet ? (
                    <div className="address-field">
                      <OrbAddress value={wallet.address} />
                    </div>
                  ) : (
                    <p className="step-hint">Creating Solana wallet…</p>
                  )}
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
                    <button className="ghost" disabled={busy} onClick={logout}>
                      Sign out
                    </button>
                  </div>
                  {withdrawOpen && (
                    <div className="withdraw-form">
                      <b>Send USDC to your Solana wallet</b>
                      <p>
                        Privy asks for one approval. Only canonical USDC is
                        sent; this embedded wallet pays the Solana network fee.
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
                </>
              )}
            </article>

            <article
              className={`step-card${fundDone ? " done" : ""}${!connectDone ? " locked" : ""}`}
              data-reveal="fade"
              data-reveal-delay="2"
            >
              <span className="step-tag">
                <i className="step-num">2</i>
              </span>
              <h3>Top up</h3>
              <p>
                Send Solana USDC to the address in step 1. The balance updates
                live from confirmed chain state.
              </p>
              <span className="big-balance">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt="" className="token-icon" src="/brand/usdc.png" />
                <UsdcAmount raw={walletUsdcRaw} unit="USDC" />
              </span>
              <p className="step-hint">
                {fundDone
                  ? "Funded. 2 USDC covers the full walkthrough."
                  : "Waiting for a deposit. In-app funding is left out on purpose."}
              </p>
            </article>

            <article
              className={`step-card${setupReady ? " done" : ""}${!connectDone ? " locked" : ""}`}
              data-reveal="fade"
              data-reveal-delay="3"
            >
              <span className="step-tag">
                <i className="step-num">3</i>
              </span>
              <h3>Turn on the rules</h3>
              <ul className="rule-list">
                <li className={existingPolicies ? "live" : ""}>
                  <i aria-hidden="true" className="rule-glyph pull">→</i>
                  Move money from wallet to smart account
                  {existingPolicies && <span className="rule-live-check">✓</span>}
                </li>
                <li className={existingPolicies ? "live" : ""}>
                  <i aria-hidden="true" className="rule-glyph earn">↑</i>
                  Deposit
                  {existingPolicies && <span className="rule-live-check">✓</span>}
                </li>
                <li className={existingPolicies ? "live" : ""}>
                  <i aria-hidden="true" className="rule-glyph earn">↓</i>
                  Withdraw
                  {existingPolicies && <span className="rule-live-check">✓</span>}
                </li>
                <li className={existingPolicies ? "live" : ""}>
                  <i aria-hidden="true" className="rule-glyph exit">←</i>
                  Send back
                  {existingPolicies && <span className="rule-live-check">✓</span>}
                </li>
              </ul>
              <div className="wallet-actions">
                <button
                  data-primary-action
                  disabled={!wallet || !sponsor || busy || !accountDiscoveryComplete || Boolean(settings)}
                  onClick={() => void run("Checking for an existing smart account…", createAccount)}
                >
                  {!accountDiscoveryComplete && connectDone
                    ? "Checking existing account…"
                    : settings
                      ? "Smart account ready ✓"
                      : "Create smart account"}
                </button>
                <button
                  className={existingPolicies ? "secondary" : undefined}
                  data-primary-action
                  disabled={!settings || !policySigner || busy || Boolean(existingPolicies) || walletUsdcRaw < 1n}
                  onClick={() => void run("Finding or creating the four rules…", createPolicies)}
                >
                  {existingPolicies ? "Rules live ✓" : "Create policies"}
                </button>
              </div>
              {!existingPolicies && settings && walletUsdcRaw < 1n && (
                <p className="step-hint">Needs USDC in the wallet first (step 2).</p>
              )}
            </article>
          </div>
        </section>

        <section className="section">
          <div className="flow-panel" data-reveal="fade">
            <div className="flow-head">
              <div>
                <h2 className="section-title">Watch money move</h2>
                <p className="section-sub">
                  Each hop is signed and fee-paid by Loyal&apos;s delegated
                  policy key, and lands only because one of the four rules
                  allows exactly that movement.
                </p>
              </div>
              {setupReady && <span className="zero-sig">0 wallet signatures from here</span>}
            </div>

            <FlowDiagram
              activeMove={activeMove}
              kaminoRaw={kaminoPositionRaw}
              smartAccountRaw={smartAccountUsdcRaw}
              walletRaw={walletUsdcRaw}
            />
            {balanceError && <p className="error-note">{balanceError}</p>}

            <div className="scenarios">
              <button
                className="scenario payday"
                data-primary-action
                disabled={!setupReady || busy || walletUsdcRaw < WALLET_TO_SMART_RAW}
                onClick={() =>
                  void runScenario("Payday sweep", "payday", PAYDAY_STEPS)
                }
              >
                <b>Run payday sweep</b>
                <span>
                  Wallet → smart account → Kamino. Two hops, zero signatures,
                  and idle cash starts earning.
                </span>
              </button>
              <button
                className="scenario purchase"
                data-primary-action
                disabled={!setupReady || busy || kaminoPositionRaw < KAMINO_TO_SMART_RAW}
                onClick={() =>
                  void runScenario(
                    "Just-in-time purchase",
                    "purchase",
                    PURCHASE_STEPS
                  )
                }
              >
                <b>Fund a purchase</b>
                <span>
                  Kamino → smart account → wallet. One dollar arrives right
                  when it&apos;s needed, after earning until the last moment.
                </span>
              </button>
            </div>

            <details className="advanced">
              <summary>Run each hop individually</summary>
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
            </details>
          </div>
        </section>

        <section className="section">
          <div data-reveal="fade">
            <h2 className="section-title">On-chain evidence</h2>
            <p className="section-sub">
              Every transaction settles on Solana mainnet-beta. Open any receipt
              on Orb Markets to verify it independently.
            </p>
          </div>
          <div className="evidence-addresses" data-reveal="fade" data-reveal-delay="1">
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
          <div data-reveal="fade" data-reveal-delay="2">
            {evidence.length === 0 ? (
              <p className="no-receipts">
                No transaction has been submitted in this session yet.
              </p>
            ) : (
              evidence.map((item, index) => (
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
              ))
            )}
          </div>
        </section>

        <footer className="foot">
          <p className="foot-line">
            Built by Loyal for Privy wallets. The backend accepts only four
            fixed, policy-constrained movements: never an arbitrary
            transaction, amount, mint, market, or destination.
          </p>
        </footer>
      </div>

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
