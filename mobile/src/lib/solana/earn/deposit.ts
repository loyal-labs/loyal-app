import { normalizeLoyalCluster } from "@loyal-labs/actions";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import { PublicKey } from "@solana/web3.js";

import { env } from "@/config/env";
import { track } from "@/lib/analytics/analytics";
import { EARN_EVENTS } from "@/lib/analytics/earn-events";
import { getConnection } from "@/lib/solana/rpc/connection";
import type { Signer } from "@/lib/wallet/signer";

import {
  confirmEarnDeposit,
  confirmEarnDepositSponsored,
  fetchEarnDepositPrepareContext,
  prepareEarnDeposit,
  type EarnAuthFields,
  type WirePreparedEarnDeposit,
} from "./earn-api";
import { signEarnAuth, withEarnAuth } from "./earn-auth";
import {
  signAndSendPreparedOperations,
  signPreparedOperationsForSponsor,
} from "./send-prepared";
import {
  hydratePreparedOperation,
  serializePreparedEarnUsdcDeposit,
  type HydratedPreparedOperation,
} from "./wire";

const USDC_DECIMALS = 6;

function usdToUsdcRaw(amountUsd: number): string {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new Error("Deposit amount must be greater than 0.");
  }
  return BigInt(Math.round(amountUsd * 10 ** USDC_DECIMALS)).toString();
}

export type EarnDepositResult = {
  depositSignature: string;
};

// The flow's stage transactions in send order. First-deposit policy stages
// are null for top-ups.
type EarnDepositStages = {
  policySetup: HydratedPreparedOperation | null;
  policyFinalize: HydratedPreparedOperation | null;
  deposit: HydratedPreparedOperation;
};

// Shared back half of the self-paid flow: sign every stage in ONE wallet
// prompt (Seed Vault batches them), send strictly in order (the policy stages
// must land before the deposit), then record into the web read-model via the
// confirm call — best-effort with retries, never undoing a confirmed on-chain
// deposit because the DB write failed (the backend earn-deposit-reconcile
// cron adopts any deposit whose confirm is still lost).
async function signSendAndConfirmDeposit(args: {
  signer: Signer;
  prepareAuth: EarnAuthFields;
  amountUsd: number;
  stages: EarnDepositStages;
  // Echoed to `deposit/confirm` verbatim — the server-prepared wire object or
  // the device-prepared serialization (identical shapes).
  wirePreparedDeposit: WirePreparedEarnDeposit;
}): Promise<EarnDepositResult> {
  const connection = getConnection();
  const operations = [
    args.stages.policySetup,
    args.stages.policyFinalize,
    args.stages.deposit,
  ].filter((operation) => operation != null);
  const sent = await signAndSendPreparedOperations({
    connection,
    signer: args.signer,
    operations,
  });
  let cursor = 0;
  const policy = args.stages.policySetup ? sent[cursor++] : undefined;
  const setupPolicy = args.stages.policyFinalize ? sent[cursor++] : undefined;
  const deposit = sent[cursor];

  // Retried because a confirm loss makes the deposit invisible in the app
  // until the reconcile cron adopts it (launch night: ~10% of confirms were
  // lost to RPC-lag rejections; the server now retries its reads too, but
  // network drops on this call remain). Each attempt is idempotent
  // server-side.
  const CONFIRM_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= CONFIRM_ATTEMPTS; attempt += 1) {
    try {
      await withEarnAuth(
        args.signer,
        args.prepareAuth,
        "earn-deposit-confirm",
        (auth) =>
          confirmEarnDeposit({
            auth,
            preparedDeposit: args.wirePreparedDeposit,
            depositSignature: deposit.signature,
            confirmedSlot: deposit.confirmedSlot,
            policySignature: policy?.signature,
            policyConfirmedSlot: policy?.confirmedSlot,
            setupPolicySignature: setupPolicy?.signature,
            setupPolicyConfirmedSlot: setupPolicy?.confirmedSlot,
          }),
      );
      break;
    } catch (error) {
      if (attempt === CONFIRM_ATTEMPTS) {
        console.warn(
          "[earn-deposit] confirm failed after retries; the earn-deposit-reconcile cron will adopt this deposit",
          error,
        );
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }

  // Tracked here (not in the sheets) so every deposit entry point counts once.
  track(EARN_EVENTS.earnDeposit, { amount_usd: args.amountUsd });

  return { depositSignature: deposit.signature };
}

// Hydrate a server-prepared deposit's stages for the self-paid sign-and-send.
function hydrateWireStages(
  preparedDeposit: WirePreparedEarnDeposit,
): EarnDepositStages {
  return {
    policySetup: preparedDeposit.policySetupPrepared
      ? hydratePreparedOperation(preparedDeposit.policySetupPrepared)
      : null,
    policyFinalize: preparedDeposit.policyFinalizePrepared
      ? hydratePreparedOperation(preparedDeposit.policyFinalizePrepared)
      : null,
    deposit: hydratePreparedOperation(preparedDeposit.prepared),
  };
}

// Real on-chain Earn deposit into the caller's smart account (same position
// as web). The deposit transactions are built ON-DEVICE with the
// smart-account-vaults SDK (mirroring the autodeposit setup/close flows): the
// backend `prepare-context` call only authenticates, provisions, and returns
// the DB-side inputs, so the ~16-RPC-call instruction build runs on the
// device's own RPC/IP allowance instead of the server's shared rate-limited
// pipe. A first-ever deposit also creates the yield-routing policy
// (policySetup) and Kamino obligation (policyFinalize) as separate signed
// transactions; a top-up is just the deposit. The deposited USDC routes into
// Kamino Safe via the Earn vault.
export async function executeEarnDeposit(args: {
  signer: Signer;
  amountUsd: number;
}): Promise<EarnDepositResult> {
  const amountRaw = usdToUsdcRaw(args.amountUsd);
  const walletAddress = args.signer.publicKey;
  const prepareAuth = await signEarnAuth(args.signer, "earn-deposit-prepare");

  // Sponsored flow (flagged): the transactions are compiled with the sponsor
  // as fee payer, so the server must build them — keep the legacy server
  // prepare. Sign every stage but send nothing; the sponsored confirm
  // endpoint sponsor-signs, sends, confirms, and records in one call. Falls
  // back to the self-paid flow when the backend returns no sponsor (flag off
  // server-side, older deploy, or sponsor key unconfigured).
  if (env.earnSponsoredDeposits) {
    const prepared = await prepareEarnDeposit({
      auth: prepareAuth,
      amountRaw,
      sponsored: true,
    });
    const preparedDeposit = prepared.preparedDeposit;
    // Which sponsor the backend derived from EARN_POLICY_SPONSOR_PK (null =
    // sponsor not configured → self-paid fallback). Kept as a plain log: the
    // fee payer of every sponsored tx, essential when debugging sponsor
    // issues.
    console.log(
      "[earn-deposit] sponsorFeePayer:",
      prepared.sponsorFeePayer ?? null,
    );
    if (prepared.sponsorFeePayer) {
      // Same stage order as the self-paid flow; first-deposit policy stages
      // are absent for top-ups, so map signed transactions back with a cursor.
      const signed = await signPreparedOperationsForSponsor({
        connection: getConnection(),
        signer: args.signer,
        feePayer: new PublicKey(prepared.sponsorFeePayer),
        operations: [
          preparedDeposit.policySetupPrepared,
          preparedDeposit.policyFinalizePrepared,
          preparedDeposit.prepared,
        ]
          .filter((stage) => stage != null)
          .map(hydratePreparedOperation),
      });
      let cursor = 0;
      const policyTransaction = preparedDeposit.policySetupPrepared
        ? signed[cursor++]
        : undefined;
      const setupPolicyTransaction = preparedDeposit.policyFinalizePrepared
        ? signed[cursor++]
        : undefined;
      const depositTransaction = signed[cursor];
      const confirmations = await withEarnAuth(
        args.signer,
        prepareAuth,
        "earn-deposit-confirm",
        (auth) =>
          confirmEarnDepositSponsored({
            auth,
            preparedDeposit,
            depositTransaction,
            policyTransaction,
            setupPolicyTransaction,
          }),
      );
      track(EARN_EVENTS.earnDeposit, { amount_usd: args.amountUsd });
      return { depositSignature: confirmations.deposit.signature };
    }
    return signSendAndConfirmDeposit({
      signer: args.signer,
      prepareAuth,
      amountUsd: args.amountUsd,
      stages: hydrateWireStages(preparedDeposit),
      wirePreparedDeposit: preparedDeposit,
    });
  }

  const context = await fetchEarnDepositPrepareContext({
    auth: prepareAuth,
    amountRaw,
  });
  if (!context) {
    // Backend predates `prepare-context` — legacy server-side prepare.
    const prepared = await prepareEarnDeposit({ auth: prepareAuth, amountRaw });
    return signSendAndConfirmDeposit({
      signer: args.signer,
      prepareAuth,
      amountUsd: args.amountUsd,
      stages: hydrateWireStages(prepared.preparedDeposit),
      wirePreparedDeposit: prepared.preparedDeposit,
    });
  }

  const client = createSmartAccountVaultsClient({
    connection: getConnection(),
    programId: new PublicKey(context.programId),
  });
  const preparedDeposit = await client.prepareEarnUsdcDeposit({
    amountRaw: BigInt(amountRaw),
    cluster: normalizeLoyalCluster(context.cluster),
    feePayer: walletAddress,
    initializeYieldRoutingPolicy: !context.yieldRoutingPolicy,
    policySigner: new PublicKey(context.policySigner),
    revokeStrayUsdcDelegate: context.revokeStrayUsdcDelegate,
    settingsPda: new PublicKey(context.settingsPda),
    walletAddress,
    ...(context.target
      ? {
          target: {
            liquidityMint: new PublicKey(context.target.liquidityMint),
            market: new PublicKey(context.target.market),
            reserve: new PublicKey(context.target.reserve),
            supplyApyBps: context.target.supplyApyBps
              ? BigInt(context.target.supplyApyBps)
              : null,
          },
        }
      : {}),
    ...(context.yieldRoutingPolicy
      ? {
          yieldRoutingPolicy: {
            account: new PublicKey(context.yieldRoutingPolicy.account),
            seed: BigInt(context.yieldRoutingPolicy.seed),
            ...(context.yieldRoutingPolicy.setupPolicy
              ? {
                  setupPolicy: {
                    account: new PublicKey(
                      context.yieldRoutingPolicy.setupPolicy.account,
                    ),
                    seed: BigInt(context.yieldRoutingPolicy.setupPolicy.seed),
                  },
                }
              : {}),
          },
        }
      : {}),
  });
  return signSendAndConfirmDeposit({
    signer: args.signer,
    prepareAuth,
    amountUsd: args.amountUsd,
    stages: {
      policySetup: preparedDeposit.policySetupPrepared ?? null,
      policyFinalize: preparedDeposit.policyFinalizePrepared ?? null,
      deposit: preparedDeposit.prepared,
    },
    wirePreparedDeposit: serializePreparedEarnUsdcDeposit(preparedDeposit),
  });
}
