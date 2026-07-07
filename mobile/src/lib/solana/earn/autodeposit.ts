import { normalizeLoyalCluster } from "@loyal-labs/actions";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import { PublicKey } from "@solana/web3.js";

import { track } from "@/lib/analytics/analytics";
import { EARN_EVENTS } from "@/lib/analytics/earn-events";
import { getConnection } from "@/lib/solana/rpc/connection";
import type { Signer } from "@/lib/wallet/signer";

import {
  confirmEarnAutodepositClose,
  confirmEarnAutodepositSetup,
  EarnApiError,
  fetchEarnAutodepositState,
  requestEarnAutodepositSweepExecute,
  toggleEarnAutodeposit,
  updateEarnAutodepositFloor,
} from "./earn-api";
import { signEarnAuth, withEarnAuth } from "./earn-auth";
import {
  signAndSendPreparedOperation,
  signAndSendPreparedOperations,
} from "./send-prepared";
import {
  serializePreparedEarnAutodepositClose,
  serializePreparedEarnAutodepositSetup,
} from "./wire";

const USDC_DECIMALS = 6;
// Per-period recurring-delegation cap, matching the web default
// (DEFAULT_EARN_AUTODEPOSIT_AMOUNT_LABEL = "10,000" USDC). The cap bounds how
// much the sweep delegate can pull per month; the threshold (floor) is what the
// user actually sets.
const DEFAULT_AMOUNT_PER_PERIOD_RAW = (
  BigInt(10_000) *
  BigInt(10) ** BigInt(USDC_DECIMALS)
).toString();
// At most three setup stages (init authority -> create policy -> create
// recurring delegation); guard against a stage that never advances.
const MAX_SETUP_STAGES = 4;

function thresholdUsdToRaw(thresholdUsd: number): string {
  if (!Number.isFinite(thresholdUsd) || thresholdUsd < 0) {
    throw new Error("Autodeposit threshold must be zero or greater.");
  }
  return BigInt(Math.round(thresholdUsd * 10 ** USDC_DECIMALS)).toString();
}

// The confirm routes re-check the signature with getSignatureStatuses on
// their own RPC right after the device saw the tx confirm — the same
// propagation race as send-prepared.ts, but server-side. A transient
// "unconfirmed_signature" 400 is retried briefly instead of surfacing: the
// on-chain state has already moved, so losing the confirm strands the DB row
// (setup stuck pending / a deleted autodeposit that still shows).
const CONFIRM_RETRY_ATTEMPTS = 4;
const CONFIRM_RETRY_DELAY_MS = 1500;

async function withUnconfirmedRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const transient =
        error instanceof EarnApiError &&
        error.code === "unconfirmed_signature";
      if (!transient || attempt >= CONFIRM_RETRY_ATTEMPTS) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, CONFIRM_RETRY_DELAY_MS),
      );
    }
  }
}

// Deployment inputs for the device-side SDK prepare, resolved from the
// unauthenticated `/state` read (which also carries the resume metadata of a
// half-finished setup).
type AutodepositPrepareContext = {
  cluster: ReturnType<typeof normalizeLoyalCluster>;
  policySigner: PublicKey;
  programId: PublicKey;
  settingsPda: PublicKey;
};

async function loadAutodepositPrepareContext(walletAddress: string): Promise<{
  context: AutodepositPrepareContext;
  state: Awaited<ReturnType<typeof fetchEarnAutodepositState>>;
}> {
  const state = await fetchEarnAutodepositState(walletAddress);
  if (!state.settingsPda) {
    throw new Error("No provisioned smart account for this wallet.");
  }
  if (!state.prepareContext) {
    throw new Error(
      "Autodeposit isn't available right now — the backend didn't provide prepare parameters.",
    );
  }
  return {
    context: {
      cluster: normalizeLoyalCluster(state.prepareContext.cluster),
      policySigner: new PublicKey(state.prepareContext.policySigner),
      programId: new PublicKey(state.prepareContext.programId),
      settingsPda: new PublicKey(state.settingsPda),
    },
    state,
  };
}

// Create an Autodeposit: stands up the on-chain recurring-delegation policy that
// sweeps wallet USDC above `thresholdUsd` into Earn. The setup instructions are
// built ON-DEVICE with the smart-account-vaults SDK (mirroring the web client);
// only the per-stage confirms still hit the backend. Multi-stage — the SDK's
// chain-driven stage machine returns the one-time subscription-authority init as
// its own round when needed, then create_policy AND create_recurring_delegation
// together, so the device signs both in ONE wallet prompt and sends them before
// confirming. One auth message covers all confirms. The nonce is fixed for the
// whole flow; the policy seed is threaded across rounds, and a half-finished
// setup resumes from the seed/nonce/window recorded in `/state`.
export async function executeEarnAutodepositSetup(args: {
  signer: Signer;
  thresholdUsd: number;
}): Promise<void> {
  const walletBalanceFloorRaw = thresholdUsdToRaw(args.thresholdUsd);
  const walletAddress = args.signer.publicKey;
  const connection = getConnection();

  const { context, state } = await loadAutodepositPrepareContext(
    walletAddress.toBase58(),
  );
  const client = createSmartAccountVaultsClient({
    connection,
    programId: context.programId,
  });

  // Resume a half-finished setup: reusing the recorded seed + nonce makes the
  // SDK return only the missing stage for the SAME policy/delegation pair
  // (mirrors the backend `setup/prepare` resume logic).
  const target = state.autodeposit;
  const resume =
    target &&
    (target.lifecycleStatus === "pending_delegation" ||
      target.lifecycleStatus === "pending_policy") &&
    target.policySeed &&
    target.recurringDelegationNonce
      ? target
      : null;
  const nonce = resume
    ? BigInt(resume.recurringDelegationNonce!)
    : BigInt(Date.now());
  let policySeed = resume ? BigInt(resume.policySeed!) : undefined;
  const periodLengthSeconds = resume?.periodLengthSeconds
    ? BigInt(resume.periodLengthSeconds)
    : undefined;
  const startTimestamp = resume?.startTimestamp
    ? BigInt(resume.startTimestamp)
    : undefined;
  const expiryTimestamp = resume?.recurringDelegationExpiryTimestamp
    ? BigInt(resume.recurringDelegationExpiryTimestamp)
    : undefined;

  const flowAuth = await signEarnAuth(
    args.signer,
    "earn-autodeposit-setup-confirm",
  );

  for (let round = 0; round < MAX_SETUP_STAGES; round++) {
    const stages = await client.prepareEarnUsdcAutodepositSetupBatch({
      amountRaw: BigInt(DEFAULT_AMOUNT_PER_PERIOD_RAW),
      cluster: context.cluster,
      expiryTimestamp,
      feePayer: walletAddress,
      minimumDelegatorBalanceRaw: BigInt(walletBalanceFloorRaw),
      nonce,
      periodLengthSeconds,
      policySeed,
      policySigner: context.policySigner,
      settingsPda: context.settingsPda,
      signer: walletAddress,
      startTimestamp,
      walletAddress,
    });
    if (stages.length === 0) {
      throw new Error("Failed to prepare Autodeposit setup.");
    }

    // The SDK reports the exact rent the stage accounts need. If the wallet
    // can't cover it, fail with the amount to top up instead of letting the
    // transaction dump a raw simulation error (the sheet's SOL gate normally
    // catches this earlier, but it fails open while balances load).
    const requiredLamports = stages.reduce(
      (total, stage) =>
        total + BigInt(stage.nativeSolRequirement.requiredLamports),
      BigInt(0),
    );
    if (requiredLamports > BigInt(0)) {
      const balanceLamports = BigInt(
        await connection.getBalance(walletAddress),
      );
      if (balanceLamports < requiredLamports) {
        const deficitSol =
          Number(requiredLamports - balanceLamports) / 1_000_000_000;
        throw new Error(
          `Not enough SOL to create the Autodeposit — deposit at least ${(
            Math.ceil(deficitSol * 1e4) / 1e4
          ).toFixed(4)} SOL and try again.`,
        );
      }
    }

    // The policy + delegation txs don't depend on each other's state, so both
    // go out before either confirmation — the second tx can't expire waiting
    // behind the first (mirrors the web "send-all-before-confirm" mode).
    const sent = await signAndSendPreparedOperations({
      connection,
      signer: args.signer,
      operations: stages.map((stage) => stage.prepared),
      sendMode: "send-all-before-confirm",
    });

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      await withUnconfirmedRetry(() =>
        withEarnAuth(
          args.signer,
          flowAuth,
          "earn-autodeposit-setup-confirm",
          (auth) =>
            confirmEarnAutodepositSetup({
              auth,
              preparedSetup: serializePreparedEarnAutodepositSetup(stage),
              setupSignature: sent[i].signature,
              confirmedSlot: sent[i].confirmedSlot,
              walletBalanceFloorRaw,
            }),
        ),
      );

      // Thread the (generated) policy seed into the next round so every stage
      // targets the same policy/delegation — but ONLY from stages that
      // resolved it against settings. The initialize_subscription_authority
      // stage returns a PLACEHOLDER seed of 1 (it early-returns before the
      // settings read); threading it would collide with whatever policy
      // already occupies seed 1 — on a deposit-first wallet that's the Kamino
      // routing policy, and the stage machine would then skip create_policy
      // entirely, stranding the setup without an autodeposit policy.
      if (stage.stage !== "initialize_subscription_authority") {
        const seed = stage.policy.seed ?? stage.persistence.policySeed;
        if (seed !== null && seed !== undefined) {
          policySeed = BigInt(seed);
        }
      }
    }
    if (stages[stages.length - 1].stage === "create_recurring_delegation") {
      track(EARN_EVENTS.autodepositEnabled, {
        source: "setup",
        threshold_usd: args.thresholdUsd,
      });
      return;
    }
  }

  throw new Error("Autodeposit setup did not complete after all stages.");
}

// Change the threshold on an existing Autodeposit. DB-only on the backend (no
// on-chain change), but still wallet-signature authenticated.
export async function updateEarnAutodepositThreshold(args: {
  signer: Signer;
  thresholdUsd: number;
  policyAccount: string;
  recurringDelegation: string;
  vaultIndex: number;
}): Promise<void> {
  const auth = await signEarnAuth(
    args.signer,
    "earn-autodeposit-floor-confirm",
  );
  await updateEarnAutodepositFloor({
    auth,
    policyAccount: args.policyAccount,
    recurringDelegation: args.recurringDelegation,
    vaultIndex: args.vaultIndex,
    walletBalanceFloorRaw: thresholdUsdToRaw(args.thresholdUsd),
  });
}

// Enable/disable an existing Autodeposit (the delegation stays in place; the
// sweep worker honors `active`). DB-only on the backend.
export async function setEarnAutodepositActive(args: {
  signer: Signer;
  active: boolean;
  policyAccount: string;
  recurringDelegation: string;
  vaultIndex: number;
}): Promise<void> {
  const auth = await signEarnAuth(
    args.signer,
    "earn-autodeposit-toggle-confirm",
  );
  await toggleEarnAutodeposit({
    auth,
    active: args.active,
    policyAccount: args.policyAccount,
    recurringDelegation: args.recurringDelegation,
    vaultIndex: args.vaultIndex,
  });
  track(
    args.active
      ? EARN_EVENTS.autodepositEnabled
      : EARN_EVENTS.autodepositDisabled,
    { source: "toggle" },
  );
}

// Delete an Autodeposit: tears down the on-chain recurring delegation (one
// signed tx, built on-device with the SDK) and records the closed target via
// the backend confirm.
export async function executeEarnAutodepositClose(args: {
  signer: Signer;
  policy: string;
  recurringDelegation: string;
}): Promise<void> {
  const walletAddress = args.signer.publicKey;
  const connection = getConnection();

  const { context } = await loadAutodepositPrepareContext(
    walletAddress.toBase58(),
  );
  const client = createSmartAccountVaultsClient({
    connection,
    programId: context.programId,
  });
  const preparedClose = await client.prepareEarnUsdcAutodepositClose({
    cluster: context.cluster,
    feePayer: walletAddress,
    policy: new PublicKey(args.policy),
    policySigner: context.policySigner,
    recurringDelegation: new PublicKey(args.recurringDelegation),
    settingsPda: context.settingsPda,
    signer: walletAddress,
    walletAddress,
  });

  const sent = await signAndSendPreparedOperation({
    connection,
    signer: args.signer,
    operation: preparedClose.prepared,
  });

  const flowAuth = await signEarnAuth(
    args.signer,
    "earn-autodeposit-close-confirm",
  );
  await withUnconfirmedRetry(() =>
    withEarnAuth(
      args.signer,
      flowAuth,
      "earn-autodeposit-close-confirm",
      (auth) =>
        confirmEarnAutodepositClose({
          auth,
          preparedClose: serializePreparedEarnAutodepositClose(preparedClose),
          closeSignature: sent.signature,
          confirmedSlot: sent.confirmedSlot,
        }),
    ),
  );
  track(EARN_EVENTS.autodepositDisabled, { source: "deleted" });
}

// Trigger the pending scheduled Autodeposit sweep to run now instead of waiting
// out its ~1h window. DB-only on the backend (it advances `eligibleAfter` so the
// sweep worker picks it up); no on-chain signing beyond the auth signature.
export async function executeEarnAutodepositScheduledSweep(args: {
  signer: Signer;
}): Promise<void> {
  const auth = await signEarnAuth(
    args.signer,
    "earn-autodeposit-sweep-execute",
  );
  await requestEarnAutodepositSweepExecute({ auth });
}
