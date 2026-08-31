"use client";

import { useIdentityToken, usePrivy } from "@privy-io/react-auth";
import {
  useSignAndSendTransaction,
  useSignMessage,
  useSignTransaction,
  useWallets,
} from "@privy-io/react-auth/solana";
import {
  createSmartAccountVaultsClient,
  sendPreparedWithWallet,
} from "@loyal-labs/smart-account-vaults";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CANONICAL_USDC_MINT,
  DEMO_CLUSTER,
  SQUADS_PROGRAM_ID,
} from "@/lib/constants";
import {
  findSmartAccountsForSigner,
  type DiscoveredSmartAccount,
} from "@/lib/discovery";
import { formatUsdc, parseUsdc } from "@/lib/forms";
import {
  assertMainnetConnection,
  createMainnetConnection,
  createPrivyWalletAdapter,
  waitForFinalized,
} from "@/lib/rpc";
import { createSmartAccountWithCollisionRecovery } from "@/lib/smart-account";
import {
  encodeSweepIntent,
  sweepIntentSchema,
  type SweepIntent,
} from "@/lib/sweep-intent";
import { getPrivyWithdrawalBoundary } from "@/lib/withdrawal";

type SetupRecord = {
  complete: boolean;
  settings: string;
  policy: string;
  policySeed: string;
  recurringDelegation: string;
  delegationNonce: string;
  amountRaw: string;
  minimumBalanceRaw: string;
  periodLengthSeconds: string;
  startTimestamp: string;
  expiryTimestamp: string;
  vault: string;
  walletUsdcAta: string;
  vaultUsdcAta: string;
};

type Evidence = { label: string; signature?: string; detail: string };

export default function Home() {
  const { ready, authenticated, login, logout } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { ready: walletsReady, wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const { signMessage } = useSignMessage();
  const wallet =
    wallets.find(
      (candidate) =>
        "isPrivyWallet" in candidate.standardWallet &&
        candidate.standardWallet.isPrivyWallet === true
    ) ?? null;
  const connection = useMemo(() => createMainnetConnection(), []);
  const [matches, setMatches] = useState<DiscoveredSmartAccount[]>([]);
  const [selected, setSelected] = useState("");
  const [policySigner, setPolicySigner] = useState("");
  const [setup, setSetup] = useState<SetupRecord | null>(null);
  const [cap, setCap] = useState("10");
  const [floor, setFloor] = useState("5");
  const [periodDays, setPeriodDays] = useState("30");
  const [expiryDays, setExpiryDays] = useState("365");
  const [withdrawAmount, setWithdrawAmount] = useState("1");
  const [status, setStatus] = useState("Sign in with email to begin.");
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState<Evidence[]>([]);

  const adapter = useMemo(() => {
    if (!wallet) return null;
    return createPrivyWalletAdapter({
      address: wallet.address,
      signTransaction: async (transaction) =>
        (
          await signTransaction({
            transaction,
            wallet,
            chain: "solana:mainnet",
          })
        ).signedTransaction,
      signAndSendTransaction: async (transaction) =>
        (
          await signAndSendTransaction({
            transaction,
            wallet,
            chain: "solana:mainnet",
          })
        ).signature,
    });
  }, [signAndSendTransaction, signTransaction, wallet]);

  const run = useCallback(
    async (label: string, action: () => Promise<void>) => {
      setBusy(true);
      setStatus(label);
      try {
        await action();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Action failed.");
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const scan = useCallback(async () => {
    if (!wallet) return;
    setStatus("Scanning finalized Squads Settings accounts…");
    await assertMainnetConnection(connection);
    const found = await findSmartAccountsForSigner(
      connection,
      new PublicKey(wallet.address)
    );
    setMatches(found);
    setSelected((current) => {
      if (found.some((account) => account.settings.toBase58() === current)) {
        return current;
      }
      return (
        found.find((account) => account.eligible)?.settings.toBase58() ||
        found[0]?.settings.toBase58() ||
        ""
      );
    });
    setStatus(
      found.length
        ? `Found ${found.length} Squads signer match${
            found.length === 1 ? "" : "s"
          }.`
        : "No Squads smart account found for this Privy wallet."
    );
  }, [connection, wallet]);

  useEffect(() => {
    fetch("/api/sweep/config")
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok) throw new Error(json.error);
        setPolicySigner(json.policySigner);
      })
      .catch((error) =>
        setStatus(
          error instanceof Error ? error.message : "Backend signer unavailable."
        )
      );
  }, []);

  useEffect(() => {
    if (authenticated && walletsReady && wallet) void scan();
  }, [authenticated, scan, wallet, walletsReady]);

  useEffect(() => {
    if (!wallet || !selected) return;
    const raw = localStorage.getItem(
      `privy-showcase:${wallet.address}:${selected}`
    );
    if (!raw) {
      setSetup(null);
      return;
    }
    try {
      setSetup(JSON.parse(raw) as SetupRecord);
    } catch {
      setSetup(null);
    }
  }, [selected, wallet]);

  const explorer = (
    addressOrSignature: string,
    kind: "address" | "tx" = "address"
  ) => `https://explorer.solana.com/${kind}/${addressOrSignature}`;

  async function sendPrepared(
    prepared: Parameters<typeof sendPreparedWithWallet>[0]["prepared"]
  ) {
    if (!adapter) throw new Error("Privy wallet is unavailable.");
    await assertMainnetConnection(connection);
    const signature = await sendPreparedWithWallet({
      connection,
      wallet: adapter,
      prepared,
      confirm: false,
    });
    await waitForFinalized(connection, signature);
    return signature;
  }

  async function checkOrCreate() {
    if (!adapter) throw new Error("Sign in with email first.");
    const result = await createSmartAccountWithCollisionRecovery({
      connection,
      wallet: adapter,
    });
    await scan();
    setSelected(result.settings.toBase58());
    setEvidence((items) => [
      {
        label: result.discovered ? "Settings discovered" : "Settings created",
        signature: result.signature ?? undefined,
        detail: result.settings.toBase58(),
      },
      ...items,
    ]);
  }

  async function createAutodeposit() {
    if (!adapter || !wallet || !selected || !policySigner)
      throw new Error("Wallet, Settings, and backend signer are required.");
    const walletKey = new PublicKey(wallet.address);
    const settings = new PublicKey(selected);
    const signer = new PublicKey(policySigner);
    const amountRaw = setup ? BigInt(setup.amountRaw) : parseUsdc(cap);
    const minimumBalanceRaw = setup
      ? BigInt(setup.minimumBalanceRaw)
      : parseUsdc(floor);
    const periodLengthSeconds = setup
      ? BigInt(setup.periodLengthSeconds)
      : BigInt(Math.floor(Number(periodDays) * 86_400));
    const now = setup
      ? BigInt(setup.startTimestamp)
      : BigInt(Math.floor(Date.now() / 1000));
    const expiryTimestamp = setup
      ? BigInt(setup.expiryTimestamp)
      : now + BigInt(Math.floor(Number(expiryDays) * 86_400));
    const nonce = setup ? BigInt(setup.delegationNonce) : BigInt(Date.now());
    let policySeed = setup ? BigInt(setup.policySeed) : undefined;
    const vaults = createSmartAccountVaultsClient({
      connection,
      programId: SQUADS_PROGRAM_ID,
    });
    let finalRecord: SetupRecord | null = null;

    if (setup && !setup.complete) {
      try {
        await vaults.assertEarnUsdcAutodepositCanonicalArtifacts({
          settingsPda: settings,
          walletAddress: walletKey,
          policySigner: signer,
          policy: new PublicKey(setup.policy),
          policySeed: BigInt(setup.policySeed),
          recurringDelegation: new PublicKey(setup.recurringDelegation),
          nonce,
          amountRaw,
          cluster: DEMO_CLUSTER,
        });
        const completed = { ...setup, complete: true };
        localStorage.setItem(
          `privy-showcase:${wallet.address}:${selected}`,
          JSON.stringify(completed)
        );
        setSetup(completed);
        setStatus(
          "Autodeposit artifacts were already finalized; setup resumed by verification."
        );
        return;
      } catch {
        // At least one stage is missing. Resume with the saved nonce and seed.
      }
    }

    for (let pass = 0; pass < 4; pass += 1) {
      const preparedBatch = await vaults.prepareEarnUsdcAutodepositSetupBatch({
        settingsPda: settings,
        walletAddress: walletKey,
        feePayer: walletKey,
        signer: walletKey,
        policySigner: signer,
        amountRaw,
        minimumDelegatorBalanceRaw: minimumBalanceRaw,
        cluster: DEMO_CLUSTER,
        nonce,
        policySeed,
        periodLengthSeconds,
        startTimestamp: now,
        expiryTimestamp,
        memo: "Privy showcase autodeposit setup",
      });
      for (const prepared of preparedBatch) {
        const plannedRecord: SetupRecord = {
          complete: false,
          settings: selected,
          policy: prepared.policy.account!.toBase58(),
          policySeed: prepared.policy.seed!.toString(),
          recurringDelegation:
            prepared.subscription.recurringDelegation.toBase58(),
          delegationNonce: prepared.subscription.nonce.toString(),
          amountRaw: amountRaw.toString(),
          minimumBalanceRaw: minimumBalanceRaw.toString(),
          periodLengthSeconds: periodLengthSeconds.toString(),
          startTimestamp: now.toString(),
          expiryTimestamp: expiryTimestamp.toString(),
          vault: prepared.vault.pubkey.toBase58(),
          walletUsdcAta: prepared.persistence.walletUsdcAta,
          vaultUsdcAta: prepared.vault.usdcAta.toBase58(),
        };
        localStorage.setItem(
          `privy-showcase:${wallet.address}:${selected}`,
          JSON.stringify(plannedRecord)
        );
        setSetup(plannedRecord);
        setStatus(`Signing ${prepared.stage.replaceAll("_", " ")} with Privy…`);
        const signature = await sendPrepared(prepared.prepared);
        setEvidence((items) => [
          {
            label: prepared.stage.replaceAll("_", " "),
            signature,
            detail: "Finalized on mainnet-beta",
          },
          ...items,
        ]);
        policySeed = prepared.policy.seed ?? policySeed;
        finalRecord = {
          complete: false,
          settings: selected,
          policy: prepared.policy.account!.toBase58(),
          policySeed: prepared.policy.seed!.toString(),
          recurringDelegation:
            prepared.subscription.recurringDelegation.toBase58(),
          delegationNonce: prepared.subscription.nonce.toString(),
          amountRaw: amountRaw.toString(),
          minimumBalanceRaw: minimumBalanceRaw.toString(),
          periodLengthSeconds: periodLengthSeconds.toString(),
          startTimestamp: now.toString(),
          expiryTimestamp: expiryTimestamp.toString(),
          vault: prepared.vault.pubkey.toBase58(),
          walletUsdcAta: prepared.persistence.walletUsdcAta,
          vaultUsdcAta: prepared.vault.usdcAta.toBase58(),
        };
      }
      if (
        preparedBatch.some(
          (prepared) => prepared.stage === "create_recurring_delegation"
        )
      )
        break;
    }
    if (!finalRecord)
      throw new Error("Autodeposit setup did not produce canonical artifacts.");
    await vaults.assertEarnUsdcAutodepositCanonicalArtifacts({
      settingsPda: settings,
      walletAddress: walletKey,
      policySigner: signer,
      policy: new PublicKey(finalRecord.policy),
      policySeed: BigInt(finalRecord.policySeed),
      recurringDelegation: new PublicKey(finalRecord.recurringDelegation),
      nonce: BigInt(finalRecord.delegationNonce),
      amountRaw,
      cluster: DEMO_CLUSTER,
    });
    finalRecord.complete = true;
    localStorage.setItem(
      `privy-showcase:${wallet.address}:${selected}`,
      JSON.stringify(finalRecord)
    );
    setSetup(finalRecord);
    setStatus(
      "Autodeposit authority, policy, approval, and recurring delegation are finalized and verified."
    );
  }

  async function executeSweep() {
    if (!wallet || !identityToken || !setup?.complete)
      throw new Error(
        "A Privy identity token and completed setup are required."
      );
    const requestedAmountRaw = parseUsdc(cap).toString();
    const challenge = await fetch("/api/sweep/challenge", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "privy-id-token": identityToken,
      },
      body: JSON.stringify({
        wallet: wallet.address,
        settings: setup.settings,
        policy: setup.policy,
        policySeed: setup.policySeed,
        recurringDelegation: setup.recurringDelegation,
        delegationNonce: setup.delegationNonce,
        requestedAmountRaw,
        minimumBalanceRaw: setup.minimumBalanceRaw,
      }),
    });
    const challengeJson = await challenge.json();
    if (!challenge.ok) throw new Error(challengeJson.error);
    const intent = sweepIntentSchema.parse(challengeJson.intent) as SweepIntent;
    const signature = (
      await signMessage({ message: encodeSweepIntent(intent), wallet })
    ).signature;
    const response = await fetch("/api/sweep/execute", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "privy-id-token": identityToken,
      },
      body: JSON.stringify({ intent, signature: bs58.encode(signature) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    setEvidence((items) => [
      {
        label: `Delegated sweep ${formatUsdc(BigInt(result.amountRaw))} USDC`,
        signature: result.signature,
        detail: `Wallet ${formatUsdc(
          BigInt(result.wallet.beforeRaw)
        )} → ${formatUsdc(BigInt(result.wallet.afterRaw))}; vault ${formatUsdc(
          BigInt(result.vault.beforeRaw)
        )} → ${formatUsdc(BigInt(result.vault.afterRaw))}`,
      },
      ...items,
    ]);
    setStatus(
      "Delegated backend signer swept the signed, bounded amount and reconciled finalized balances."
    );
  }

  async function withdraw() {
    if (!adapter || !wallet || !setup?.complete || !policySigner)
      throw new Error("Completed setup is required.");
    const walletKey = new PublicKey(wallet.address);
    const amountRaw = parseUsdc(withdrawAmount);
    const boundary = getPrivyWithdrawalBoundary({
      settings: new PublicKey(setup.settings),
      wallet: walletKey,
      amountRaw,
    });
    if (boundary.sourceAta.toBase58() !== setup.vaultUsdcAta) {
      throw new Error(
        "Stored withdrawal source is not the canonical vault-index-1 USDC ATA."
      );
    }
    const vaults = createSmartAccountVaultsClient({
      connection,
      programId: SQUADS_PROGRAM_ID,
    });
    const withdrawal = await vaults.prepareEarnUsdcWithdraw({
      settingsPda: new PublicKey(setup.settings),
      walletAddress: walletKey,
      policySigner: new PublicKey(policySigner),
      feePayer: walletKey,
      amountRaw,
      mode: "partial",
      cluster: DEMO_CLUSTER,
      closePoliciesOnFullWithdrawal: false,
      source: {
        type: "idle",
        id: "privy-showcase-vault-usdc",
        amountRaw,
        mint: CANONICAL_USDC_MINT,
        tokenAccount: boundary.sourceAta,
        tokenProgramId: TOKEN_PROGRAM_ID,
      },
      yieldRoutingPolicy: {
        account: new PublicKey(setup.policy),
        seed: BigInt(setup.policySeed),
      },
      memo: "Privy showcase withdraw to originating wallet",
    });
    const signature = await sendPrepared(withdrawal.prepared);
    setEvidence((items) => [
      {
        label: `Withdrew ${withdrawAmount} USDC`,
        signature,
        detail: `Only to ${wallet.address}`,
      },
      ...items,
    ]);
    setStatus("Withdrawal finalized to the same Privy wallet ATA.");
  }

  async function closeAutodeposit() {
    if (!adapter || !wallet || !setup?.complete || !policySigner)
      throw new Error("Completed setup is required.");
    const vaults = createSmartAccountVaultsClient({
      connection,
      programId: SQUADS_PROGRAM_ID,
    });
    const close = await vaults.prepareEarnUsdcAutodepositClose({
      settingsPda: new PublicKey(setup.settings),
      walletAddress: new PublicKey(wallet.address),
      feePayer: new PublicKey(wallet.address),
      signer: new PublicKey(wallet.address),
      policySigner: new PublicKey(policySigner),
      policy: new PublicKey(setup.policy),
      recurringDelegation: new PublicKey(setup.recurringDelegation),
      cluster: DEMO_CLUSTER,
      memo: "Privy showcase close autodeposit",
    });
    const signature = await sendPrepared(close.prepared);
    localStorage.removeItem(`privy-showcase:${wallet.address}:${selected}`);
    setSetup(null);
    setEvidence((items) => [
      {
        label: "Autodeposit closed",
        signature,
        detail: "Delegation revoked and sweep policy closed",
      },
      ...items,
    ]);
    setStatus(
      "Autodeposit closed. Vault funds remain available for a separate withdrawal."
    );
  }

  return (
    <main>
      <header>
        <div>
          <span className="eyebrow">PRIVY × LOYAL</span>
          <h1>
            Embedded wallet.
            <br />
            Autonomous vault.
          </h1>
        </div>
        <div className="network">
          <i /> Solana mainnet-beta
        </div>
      </header>
      <p className="lede">
        Email creates a Privy embedded Solana wallet. That wallet owns a Squads
        smart account, authorizes bounded USDC autodeposits, and always keeps
        withdrawal control.
      </p>

      <section className="status">
        <span>{busy ? "WORKING" : "STATUS"}</span>
        <p>{status}</p>
      </section>

      <div className="grid">
        <article>
          <div className="step">01</div>
          <h2>Privy wallet</h2>
          <p className="muted">
            Email-only authentication creates the embedded Solana signer.
          </p>
          {!authenticated ? (
            <button disabled={!ready || busy} onClick={login}>
              Continue with email
            </button>
          ) : (
            <>
              <code>{wallet?.address ?? "Loading embedded wallet…"}</code>
              <button className="secondary" onClick={logout}>
                Sign out
              </button>
            </>
          )}
        </article>

        <article>
          <div className="step">02</div>
          <h2>Squads smart account</h2>
          <p className="muted">
            A discriminator-filtered RPC scan finds every Settings account
            containing this signer.
          </p>
          <button
            disabled={!adapter || busy}
            onClick={() => void run("Checking Squads accounts…", checkOrCreate)}
          >
            Check or create
          </button>
          {matches.length > 0 && (
            <select
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              {matches.map((match) => (
                <option
                  key={match.settings.toBase58()}
                  value={match.settings.toBase58()}
                >
                  {match.eligible ? "Eligible" : "Signer only"} ·{" "}
                  {match.settings.toBase58()}
                </option>
              ))}
            </select>
          )}
          {selected && (
            <>
              <p className="muted">
                {matches.find((match) => match.settings.toBase58() === selected)
                  ?.eligibilityReason ??
                  "Newly created account will be eligible."}
              </p>
              <a href={explorer(selected)} target="_blank">
                View Settings ↗
              </a>
            </>
          )}
        </article>

        <article className="wide">
          <div className="step">03</div>
          <h2>Autodeposit policy</h2>
          <div className="fields">
            <label>
              Cap per period
              <input value={cap} onChange={(e) => setCap(e.target.value)} />
              <small>USDC</small>
            </label>
            <label>
              Keep in wallet
              <input value={floor} onChange={(e) => setFloor(e.target.value)} />
              <small>USDC · app-enforced</small>
            </label>
            <label>
              Period
              <input
                value={periodDays}
                onChange={(e) => setPeriodDays(e.target.value)}
              />
              <small>days</small>
            </label>
            <label>
              Expires
              <input
                value={expiryDays}
                onChange={(e) => setExpiryDays(e.target.value)}
              />
              <small>days from now</small>
            </label>
          </div>
          <div className="boundary">
            <b>On-chain:</b> signer, mainnet USDC, wallet source, vault-1
            destination, recurring cap. <b>Application:</b> wallet balance
            floor.
          </div>
          <button
            disabled={
              !selected ||
              !policySigner ||
              busy ||
              setup?.complete ||
              matches.some(
                (match) =>
                  match.settings.toBase58() === selected && !match.eligible
              )
            }
            onClick={() =>
              void run("Preparing autodeposit…", createAutodeposit)
            }
          >
            {setup?.complete
              ? "Autodeposit verified"
              : setup
              ? "Resume autodeposit"
              : "Create autodeposit"}
          </button>
          {setup && (
            <div className="facts">
              <span>
                Policy <code>{setup.policy}</code>
              </span>
              <span>
                Delegation <code>{setup.recurringDelegation}</code>
              </span>
              <span>
                Source wallet USDC ATA <code>{setup.walletUsdcAta}</code>
              </span>
              <span>
                Destination vault-1 USDC ATA <code>{setup.vaultUsdcAta}</code>
              </span>
              <span>
                Backend policy signer <code>{policySigner}</code>
              </span>
              <span>
                Mint <code>{CANONICAL_USDC_MINT.toBase58()}</code>
              </span>
              <span>
                Period cap{" "}
                <code>{formatUsdc(BigInt(setup.amountRaw))} USDC</code>
              </span>
              <span>
                Period{" "}
                <code>
                  {Number(BigInt(setup.periodLengthSeconds)) / 86_400} days
                </code>
              </span>
              <span>
                Expiry{" "}
                <code>
                  {new Date(
                    Number(BigInt(setup.expiryTimestamp)) * 1_000
                  ).toISOString()}
                </code>
              </span>
              <span>
                Application-enforced wallet floor{" "}
                <code>{formatUsdc(BigInt(setup.minimumBalanceRaw))} USDC</code>
              </span>
              <span>
                Vault owner <code>{setup.vault}</code>
              </span>
            </div>
          )}
        </article>

        <article>
          <div className="step">04</div>
          <h2>Execute sweep</h2>
          <p className="muted">
            Pressing this signs a one-minute, single-use intent. The backend
            policy signer can execute only the verified policy.
          </p>
          <button
            disabled={!setup?.complete || !identityToken || busy}
            onClick={() =>
              void run("Authorizing delegated sweep…", executeSweep)
            }
          >
            Sweep now
          </button>
        </article>

        <article>
          <div className="step">05</div>
          <h2>Wallet-controlled exit</h2>
          <label>
            Withdraw
            <input
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
            />
            <small>USDC</small>
          </label>
          <button
            disabled={!setup?.complete || busy}
            onClick={() => void run("Withdrawing from vault…", withdraw)}
          >
            Withdraw to Privy wallet
          </button>
          <button
            className="secondary"
            disabled={!setup?.complete || busy}
            onClick={() => void run("Closing autodeposit…", closeAutodeposit)}
          >
            Close autodeposit only
          </button>
        </article>
      </div>

      <section className="evidence">
        <h2>Finalized evidence</h2>
        {evidence.length === 0 ? (
          <p className="muted">
            No mainnet transaction has been submitted by the verifier.
          </p>
        ) : (
          evidence.map((item, index) => (
            <div key={`${item.label}-${index}`}>
              <b>{item.label}</b>
              <span>{item.detail}</span>
              {item.signature && (
                <a href={explorer(item.signature, "tx")} target="_blank">
                  {item.signature} ↗
                </a>
              )}
            </div>
          ))
        )}
      </section>
    </main>
  );
}
