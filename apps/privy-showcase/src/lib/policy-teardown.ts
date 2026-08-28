import type { PreparedLoyalSmartAccountsOperation } from "@loyal-labs/loyal-smart-accounts";
import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { DEMO_CLUSTER } from "./constants";
import { readDemoMoneyState } from "./money-state";
import {
  clientFor,
  findAutodeposit,
  findExitPolicy,
  listPolicyDetails,
} from "./policy-setup";
import type { SponsorStage } from "./sponsor-protocol";

export const TEARDOWN_STAGES = [
  "teardown-withdraw",
  "teardown-cleanup",
  "teardown-autodeposit",
  "teardown-exit",
  "teardown-refund",
] as const;

export type TeardownStage = (typeof TEARDOWN_STAGES)[number];

type TeardownContext = {
  connection: Connection;
  policySigner: PublicKey;
  settings: PublicKey;
  sponsor: PublicKey;
  wallet: PublicKey;
};

type PolicyRef = { account: PublicKey; rentCollector: PublicKey; seed: bigint };

/** Everything teardown needs, read once. Policies were created with mixed
 *  rent payers (autodeposit stages are wallet-paid, the rest sponsor-paid),
 *  and the program refunds a policy's rent only to its stored rentCollector,
 *  so each close must use that exact account as its fee payer. */
export type TeardownSnapshot = {
  autodeposit:
    | (PolicyRef & { nonce: bigint; recurringDelegation: PublicKey })
    | null;
  earnResidual: PolicyRef[];
  exit: PolicyRef | null;
  kaminoCollateralRaw: bigint;
  kaminoUsdcRaw: bigint;
  policyCount: number;
  vaultUsdcRaw: bigint;
};

export async function readTeardownSnapshot(
  args: TeardownContext
): Promise<TeardownSnapshot> {
  // Confirmed commitment, deliberately: the reset submits several
  // transactions back to back waiting only for confirmation, so the browser
  // and the sponsor must both read the between-transactions state.
  const details = await listPolicyDetails(args.connection, args.settings, "confirmed");
  const candidates = details
    .filter(
      (entry) =>
        entry.policy.policyState.__kind === "ProgramInteraction" &&
        entry.policy.signers.length === 1 &&
        entry.policy.signers[0]?.key.equals(args.policySigner) === true
    )
    .map((entry) => ({
      address: entry.address.toBase58(),
      seed: entry.seed.toString(),
    }));
  const autodeposit =
    details.length > 0 ? await findAutodeposit({ ...args, candidates }) : null;
  const exit = await findExitPolicy({ ...args, details });
  const money = await readDemoMoneyState(args);
  const collectorOf = (account: PublicKey) =>
    details.find((entry) => entry.address.equals(account))!.policy.rentCollector;
  const earnResidual = details
    .filter((entry) => entry.policy.policyState.__kind === "ProgramInteraction")
    .filter(
      (entry) => !autodeposit || !entry.address.equals(autodeposit.account)
    )
    .filter(
      (entry) =>
        entry.policy.threshold === 1 &&
        entry.policy.timeLock === 0 &&
        entry.policy.signers.length === 1 &&
        entry.policy.signers[0]?.key.equals(args.policySigner) === true
    )
    .map((entry) => ({
      account: entry.address,
      rentCollector: entry.policy.rentCollector,
      seed: entry.seed,
    }));
  return {
    autodeposit: autodeposit
      ? { ...autodeposit, rentCollector: collectorOf(autodeposit.account) }
      : null,
    earnResidual,
    exit: exit
      ? {
          account: new PublicKey(exit.address),
          rentCollector: collectorOf(new PublicKey(exit.address)),
          seed: BigInt(exit.seed),
        }
      : null,
    kaminoCollateralRaw: money.kaminoCollateralRaw,
    kaminoUsdcRaw: money.kaminoUsdcRaw,
    policyCount: details.length,
    vaultUsdcRaw: money.smartAccountUsdcRaw,
  };
}

export const TEARDOWN_LABELS: Record<TeardownStage, string> = {
  "teardown-withdraw": "Reset: withdraw everything from Kamino",
  "teardown-cleanup": "Reset: close the Main-market rules",
  "teardown-autodeposit": "Reset: close the autodeposit rule",
  "teardown-exit": "Reset: close the wallet exit rule",
  "teardown-refund": "Reset: drain the smart account",
};

/** The next batch of teardown work. Every entry is an independent
 *  transaction, so the whole plan can be signed with one Privy approval.
 *  Cleanup appears once per rent-collector group: two policies with
 *  different collectors can never share a close transaction. */
export function planTeardown(
  snapshot: TeardownSnapshot
): Array<{ label: string; stage: TeardownStage }> {
  const plan: Array<{ label: string; stage: TeardownStage }> = [];
  if (snapshot.kaminoCollateralRaw > 0n) {
    plan.push({ label: TEARDOWN_LABELS["teardown-withdraw"], stage: "teardown-withdraw" });
  } else if (snapshot.vaultUsdcRaw > 0n) {
    plan.push({ label: TEARDOWN_LABELS["teardown-refund"], stage: "teardown-refund" });
  }
  const collectorGroups = new Set(
    snapshot.earnResidual.map((policy) => policy.rentCollector.toBase58())
  );
  for (let index = 0; index < collectorGroups.size; index += 1) {
    plan.push({ label: TEARDOWN_LABELS["teardown-cleanup"], stage: "teardown-cleanup" });
  }
  if (snapshot.autodeposit) {
    plan.push({ label: TEARDOWN_LABELS["teardown-autodeposit"], stage: "teardown-autodeposit" });
  }
  if (snapshot.exit) {
    plan.push({ label: TEARDOWN_LABELS["teardown-exit"], stage: "teardown-exit" });
  }
  return plan;
}

export async function resolveNextTeardownStage(
  args: TeardownContext
): Promise<TeardownStage | null> {
  const plan = planTeardown(await readTeardownSnapshot(args));
  return plan[0]?.stage ?? null;
}

/** Prepare one teardown stage. `skipCleanupGroups` selects the Nth
 *  rent-collector group for repeated cleanup entries in one plan; the
 *  sponsor, re-deriving one request at a time, always uses 0 because
 *  earlier groups have already closed by the time it verifies the next. */
export async function prepareTeardownStage(
  stage: TeardownStage,
  args: TeardownContext,
  snapshot?: TeardownSnapshot,
  skipCleanupGroups = 0
): Promise<PreparedLoyalSmartAccountsOperation<string>> {
  const client = clientFor(args.connection);
  const state = snapshot ?? (await readTeardownSnapshot(args));

  if (stage === "teardown-withdraw") {
    if (state.kaminoCollateralRaw === 0n) {
      throw new Error("There is no Kamino position to withdraw.");
    }
    const withdraw = await client.prepareEarnUsdcWithdraw({
      amountRaw: state.kaminoUsdcRaw,
      cluster: DEMO_CLUSTER,
      feePayer: args.wallet,
      memo: "Privy Loyal demo: reset, full Kamino exit",
      mode: "full",
      policySigner: args.policySigner,
      settingsPda: args.settings,
      walletAddress: args.wallet,
    });
    return withdraw.prepared;
  }

  if (stage === "teardown-refund") {
    const refund = await client.prepareEarnVaultAccountsRefund({
      cluster: DEMO_CLUSTER,
      feePayer: args.wallet,
      memo: "Privy Loyal demo: reset, drain the smart account",
      settingsPda: args.settings,
      walletAddress: args.wallet,
    });
    return refund.prepared;
  }

  if (stage === "teardown-cleanup") {
    if (state.earnResidual.length === 0) {
      throw new Error("The Main-market rules are already closed.");
    }
    const groups: PolicyRef[][] = [];
    for (const policy of state.earnResidual) {
      const group = groups.find((candidate) =>
        candidate[0]!.rentCollector.equals(policy.rentCollector)
      );
      if (group) group.push(policy);
      else groups.push([policy]);
    }
    const group = groups[skipCleanupGroups];
    if (!group) throw new Error("The Main-market rules are already closed.");
    return client.prepareClosePoliciesSync({
      feePayer: group[0]!.rentCollector,
      memo: "Privy Loyal demo: reset, close Main-market rules",
      policies: group.map((policy) => policy.account),
      settingsPda: args.settings,
      signers: [args.wallet],
    });
  }

  if (stage === "teardown-autodeposit") {
    if (!state.autodeposit) throw new Error("The autodeposit rule is already closed.");
    const close = await client.prepareEarnUsdcAutodepositClose({
      cluster: DEMO_CLUSTER,
      feePayer: state.autodeposit.rentCollector,
      memo: "Privy Loyal demo: reset, close autodeposit",
      policy: state.autodeposit.account,
      policySigner: args.policySigner,
      recurringDelegation: state.autodeposit.recurringDelegation,
      settingsPda: args.settings,
      signer: args.wallet,
      walletAddress: args.wallet,
    });
    return close.prepared;
  }

  if (!state.exit) throw new Error("The wallet exit rule is already closed.");
  return client.prepareClosePoliciesSync({
    feePayer: state.exit.rentCollector,
    memo: "Privy Loyal demo: reset, close wallet exit rule",
    policies: [state.exit.account],
    settingsPda: args.settings,
    signers: [args.wallet],
  });
}

/** Run the full reset: exit Kamino, drain the vault, close every rule with
 *  its own rent collector as payer, all signed in one Privy approval when
 *  the wallet supports batch signing. The smart account itself stays. */
export async function teardownDemo(
  args: TeardownContext & {
    sendBatch: (
      entries: Array<{
        label: string;
        prepared: PreparedLoyalSmartAccountsOperation<string>;
        stage: SponsorStage;
      }>
    ) => Promise<void>;
  }
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = await readTeardownSnapshot(args);
    const plan = planTeardown(snapshot);
    if (plan.length === 0) {
      if (snapshot.policyCount > 0) {
        throw new Error(
          `Reset finished but ${snapshot.policyCount} unrelated policies remain.`
        );
      }
      return;
    }
    const entries = [];
    let cleanupIndex = 0;
    for (const item of plan) {
      const groupIndex = item.stage === "teardown-cleanup" ? cleanupIndex++ : 0;
      entries.push({
        label: item.label,
        prepared: await prepareTeardownStage(item.stage, args, snapshot, groupIndex),
        stage: item.stage as SponsorStage,
      });
    }
    await args.sendBatch(entries);
  }
  throw new Error("Reset did not converge after three rounds.");
}
