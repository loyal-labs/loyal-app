import { normalizeLoyalCluster } from "@loyal-labs/actions";
import {
  createSmartAccountVaultsClient,
  isEarnPolicyUpdateRequiredError,
} from "@loyal-labs/smart-account-vaults";
import { PublicKey } from "@solana/web3.js";

import { track } from "@/lib/analytics/analytics";
import { EARN_EVENTS } from "@/lib/analytics/earn-events";
import { getConnection } from "@/lib/solana/rpc/connection";
import { assertNativeSolRequirement } from "@/lib/wallet/insufficient-sol-error";
import type { Signer } from "@/lib/wallet/signer";
import {
  type LifecycleFlow,
  startLifecycleFlow,
} from "@/services/observability";

import { withConnectionRetry } from "./connection-retry";
import { fetchEarnDepositPrepareContext } from "./earn-api";
import {
  EARN_PRODUCT_DECIMALS,
  tokenProgramForEarnMint,
} from "./earn-product-mints";
import { signEarnAuth } from "./earn-auth";
import { signAndSendPreparedOperations } from "./send-prepared";
import type { HydratedPreparedOperation } from "./wire";

const DEPOSIT_NETWORK_MESSAGE =
  "We couldn't reach the network to prepare the deposit. No funds moved — check your connection and try again.";

// Every Earn product stablecoin is 6-decimal, so one conversion covers them all.
function usdToStableRaw(amountUsd: number): string {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new Error("Deposit amount must be greater than 0.");
  }
  return BigInt(Math.round(amountUsd * 10 ** EARN_PRODUCT_DECIMALS)).toString();
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

// Sign every client-built stage in one wallet prompt and send them strictly
// in order. Finalized LaserStream account changes project the result; this
// path never posts a second, client-authored accounting record.
async function signSendAndConfirmDeposit(args: {
  signer: Signer;
  amountUsd: number;
  stages: EarnDepositStages;
  flow: LifecycleFlow<"earn.deposit">;
}): Promise<EarnDepositResult> {
  assertNativeSolRequirement(args.wirePreparedDeposit.nativeSolRequirement);

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
  }).catch((error) => {
    args.flow.failFrom("wallet_submit_confirm", error);
    throw error;
  });
  args.flow.observe("wallet_submit_confirm", {
    chainState: "confirmed",
    executionMode: operations.length > 1 ? "batch" : "single",
  });
  const deposit = sent.at(-1);
  if (!deposit) {
    throw new Error("Earn deposit produced no submitted transaction.");
  }
  // Tracked here (not in the sheets) so every deposit entry point counts once.
  track(EARN_EVENTS.earnDeposit, { amount_usd: args.amountUsd });

  args.flow.complete("ui_commit");
  return { depositSignature: deposit.signature };
}

// Policies are immutable permission records, so a legacy (classic-token-only)
// Earn route policy is "updated" by creating a NEW owner-neutral route+setup
// pair at the next seed — two signed transactions, one wallet prompt (the
// Seed Vault batches them). The legacy pair stays on-chain and only strands
// its rent. LaserStream discovers the replacement pair from finalized chain
// updates before it projects the following deposit.
async function runEarnPolicyUpdate(args: {
  client: ReturnType<typeof createSmartAccountVaultsClient>;
  context: { cluster: string; policySigner: string; settingsPda: string };
  signer: Signer;
}): Promise<void> {
  const preparedPolicy = await withConnectionRetry(
    "deposit policy update prepare",
    DEPOSIT_NETWORK_MESSAGE,
    () =>
      args.client.prepareEarnUsdcYieldRoutingPolicy({
        cluster: normalizeLoyalCluster(args.context.cluster),
        feePayer: args.signer.publicKey,
        settingsPda: new PublicKey(args.context.settingsPda),
        signer: new PublicKey(args.context.policySigner),
        walletAddress: args.signer.publicKey,
      })
  );
  // Route policy create must land before the setup finalize; strict order is
  // what signAndSendPreparedOperations guarantees.
  await signAndSendPreparedOperations({
    connection: getConnection(),
    signer: args.signer,
    operations: [
      preparedPolicy.prepared,
      preparedPolicy.finalizePrepared,
    ].filter((operation) => operation != null),
  });
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
  // The Earn product stablecoin being deposited (base58 mint, from the
  // deposit sheet's coin selector).
  mint: string;
  // The caller's loading-metric flow id, so the metric point and this flow's
  // events share one `loyal.flow.id`.
  flowId?: string;
}): Promise<EarnDepositResult> {
  const flow = startLifecycleFlow({
    ...(args.flowId ? { flowId: args.flowId } : {}),
    flowName: "earn.deposit",
    flowVariant: "initial",
    // Deposit runs the same SDK prepare through the same retry helper as
    // withdrawal, so a bug surfaces here the same way: as `unexpected_error`,
    // whose message and stack only reach the sanitized error ingest when this
    // is set (ASK-2018). Without it the withdrawal twin was diagnosable and
    // this was not, for no reason beyond which flow the exception landed in.
    reportUnexpectedErrors: true,
    walletAddress: args.signer.publicKey.toBase58(),
  });
  flow.start("prepare");
  try {
    return await runEarnDeposit(args, flow);
  } catch (error) {
    // Latched to a no-op when an inner stage already failed the flow.
    flow.failFrom("prepare", error);
    throw error;
  }
}

async function runEarnDeposit(
  args: {
    signer: Signer;
    amountUsd: number;
    mint: string;
  },
  flow: LifecycleFlow<"earn.deposit">
): Promise<EarnDepositResult> {
  const amountRaw = usdToStableRaw(args.amountUsd);
  const walletAddress = args.signer.publicKey;
  const prepareAuth = await signEarnAuth(args.signer, "earn-deposit-prepare");

  const context = await withConnectionRetry(
    "deposit prepare-context",
    DEPOSIT_NETWORK_MESSAGE,
    () =>
      fetchEarnDepositPrepareContext({
        auth: prepareAuth,
        amountRaw,
        mint: args.mint,
        flowId: flow.flowId,
      })
  );
  if (!context) {
    throw new Error(
      "This app version requires the read-only Earn context endpoint."
    );
  }

  if (context.yieldRoutingPolicy) {
    flow.setVariant("top_up");
  }
  const client = createSmartAccountVaultsClient({
    connection: getConnection(),
    programId: new PublicKey(context.programId),
  });
  // After a policy update the DB-known route (the legacy pair) is stale, so
  // the retry prepares WITHOUT the known route: the SDK's policy scan sorts
  // compatible pairs first and picks up the freshly created one from chain.
  const prepareOnDevice = (options: { scanPolicies: boolean }) =>
    withConnectionRetry("deposit device prepare", DEPOSIT_NETWORK_MESSAGE, () =>
      client.prepareEarnUsdcDeposit({
        amountRaw: BigInt(amountRaw),
        cluster: normalizeLoyalCluster(context.cluster),
        feePayer: walletAddress,
        initializeYieldRoutingPolicy:
          options.scanPolicies || !context.yieldRoutingPolicy,
        policySigner: new PublicKey(context.policySigner),
        revokeStrayUsdcDelegate: context.revokeStrayUsdcDelegate,
        settingsPda: new PublicKey(context.settingsPda),
        walletAddress,
        ...(context.target
          ? {
              target: {
                liquidityMint: new PublicKey(context.target.liquidityMint),
                liquidityTokenProgram: new PublicKey(
                  context.target.liquidityTokenProgram ??
                    tokenProgramForEarnMint(
                      context.target.liquidityMint
                    ).toBase58()
                ),
                market: new PublicKey(context.target.market),
                reserve: new PublicKey(context.target.reserve),
                supplyApyBps: context.target.supplyApyBps
                  ? BigInt(context.target.supplyApyBps)
                  : null,
              },
            }
          : {}),
        ...(!options.scanPolicies && context.yieldRoutingPolicy
          ? {
              yieldRoutingPolicy: {
                account: new PublicKey(context.yieldRoutingPolicy.account),
                seed: BigInt(context.yieldRoutingPolicy.seed),
                ...(context.yieldRoutingPolicy.setupPolicy
                  ? {
                      setupPolicy: {
                        account: new PublicKey(
                          context.yieldRoutingPolicy.setupPolicy.account
                        ),
                        seed: BigInt(
                          context.yieldRoutingPolicy.setupPolicy.seed
                        ),
                      },
                    }
                  : {}),
              },
            }
          : {}),
      })
    );
  let preparedDeposit;
  try {
    preparedDeposit = await prepareOnDevice({ scanPolicies: false });
  } catch (error) {
    // A route policy from before Token-2022 support pins the liquidity mint's
    // owner to the classic token program and cannot authorize CASH/USDG/PYUSD
    // deposits. The remedy runs inline (mirroring web's forced policy setup):
    // create a new owner-neutral pair, then re-prepare once — a second
    // update-required error propagates normally.
    if (!isEarnPolicyUpdateRequiredError(error)) {
      throw error;
    }
    console.log("[earn-deposit] route policy predates Token-2022; updating");
    await runEarnPolicyUpdate({ client, context, signer: args.signer });
    preparedDeposit = await prepareOnDevice({ scanPolicies: true });
  }
  flow.observe("prepare", {
    policyMode: context.yieldRoutingPolicy ? "reuse" : "create",
  });
  return signSendAndConfirmDeposit({
    signer: args.signer,
    amountUsd: args.amountUsd,
    stages: {
      policySetup: preparedDeposit.policySetupPrepared ?? null,
      policyFinalize: preparedDeposit.policyFinalizePrepared ?? null,
      deposit: preparedDeposit.prepared,
    },
    flow,
  });
}
