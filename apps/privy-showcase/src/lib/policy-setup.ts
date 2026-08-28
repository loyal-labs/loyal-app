import { deriveRecurringDelegation, deriveSubscriptionAuthority } from "@loyal-labs/actions";
import { pda, type PreparedLoyalSmartAccountsOperation } from "@loyal-labs/loyal-smart-accounts";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import {
  Policy,
  policyDiscriminator,
  toBigInt,
} from "@loyal-labs/loyal-smart-accounts-core";
import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import {
  CANONICAL_USDC_MINT,
  DEMO_CLUSTER,
  EARN_VAULT_INDEX,
  SQUADS_PROGRAM_ID,
} from "./constants";
import type { DemoPolicyBundle, SponsorStage } from "./sponsor-protocol";

const AUTODEPOSIT_AMOUNT_RAW = 2_000_000n;
const AUTODEPOSIT_NONCE = 0n;
// One pull of 2 USDC per five-minute window, so the walkthrough can run
// repeatedly; the on-chain delegation enforces the cap either way.
const AUTODEPOSIT_PERIOD_SECONDS = 5n * 60n;
const AUTODEPOSIT_EXPIRY = 9_223_372_036_854_775_807n;
const EXIT_DAILY_LIMIT_RAW = 10_000_000n;

type SetupSender = (args: {
  autodepositPolicySeed?: bigint;
  label: string;
  prepared: PreparedLoyalSmartAccountsOperation<string>;
  stage: SponsorStage;
}) => Promise<void>;

export function clientFor(connection: Connection) {
  return createSmartAccountVaultsClient({
    connection,
    programId: SQUADS_PROGRAM_ID,
  });
}

export async function listPolicyDetails(
  connection: Connection,
  settings: PublicKey,
  commitment: "confirmed" | "finalized" = "finalized"
) {
  const rows = await connection.getProgramAccounts(SQUADS_PROGRAM_ID, {
    commitment,
    filters: [
      {
        memcmp: {
          offset: 0,
          bytes: bs58.encode(Uint8Array.from(policyDiscriminator)),
        },
      },
      { memcmp: { offset: 8, bytes: settings.toBase58() } },
    ],
  });
  return rows
    .map(({ account, pubkey }) => {
      const [policy] = Policy.fromAccountInfo(account);
      return { address: pubkey, policy, seed: toBigInt(policy.seed) };
    })
    .sort((left, right) => (left.seed > right.seed ? 1 : -1));
}

export async function listPolicyReferences(connection: Connection, settings: PublicKey) {
  const details = await listPolicyDetails(connection, settings);
  return details.map((entry) => ({
    address: entry.address.toBase58(),
    seed: entry.seed.toString(),
  }));
}

/** The Main-market route/setup pair, classified directly from chain state:
 *  the two ProgramInteraction policies that are not the autodeposit policy,
 *  each solely signed by the delegated key, at adjacent seeds. Discovery and
 *  teardown use this instead of the package's canonical-state resolver so an
 *  already-created pair keeps working when the resolver's expected format
 *  moves ahead of it. */
export async function findEarnPolicyPair(args: {
  autodepositAccount?: PublicKey | null;
  connection: Connection;
  details?: Awaited<ReturnType<typeof listPolicyDetails>>;
  policySigner: PublicKey;
  settings: PublicKey;
  wallet: PublicKey;
}): Promise<{
  route: { account: PublicKey; seed: bigint };
  setup: { account: PublicKey; seed: bigint };
} | null> {
  const details =
    args.details ?? (await listPolicyDetails(args.connection, args.settings));
  const autodepositAccount =
    args.autodepositAccount !== undefined
      ? args.autodepositAccount
      : (await findAutodeposit(args))?.account ?? null;
  const autodeposit = autodepositAccount ? { account: autodepositAccount } : null;
  const pair = details
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
    .map((entry) => ({ account: entry.address, seed: entry.seed }));
  if (pair.length === 0) return null;
  if (pair.length !== 2 || pair[1]!.seed !== pair[0]!.seed + 1n) {
    throw new Error(
      "The Main-market policies are not an exact route and setup pair."
    );
  }
  return { route: pair[0]!, setup: pair[1]! };
}

export async function findAutodeposit(args: {
  candidates?: Array<{ address: string; seed: string }>;
  connection: Connection;
  policySigner: PublicKey;
  settings: PublicKey;
  wallet: PublicKey;
}) {
  const client = clientFor(args.connection);
  const policies =
    args.candidates ?? (await listPolicyReferences(args.connection, args.settings));
  const vault = pda.getSmartAccountPda({
    accountIndex: EARN_VAULT_INDEX,
    programId: SQUADS_PROGRAM_ID,
    settingsPda: args.settings,
  })[0];
  const authority = deriveSubscriptionAuthority(args.wallet, CANONICAL_USDC_MINT);
  const recurringDelegation = deriveRecurringDelegation(
    authority,
    args.wallet,
    vault,
    AUTODEPOSIT_NONCE
  );
  const matches: Array<{ account: PublicKey; seed: bigint }> = [];
  for (const candidate of policies) {
    try {
      await client.assertEarnUsdcAutodepositCanonicalArtifacts({
        amountRaw: AUTODEPOSIT_AMOUNT_RAW,
        cluster: DEMO_CLUSTER,
        nonce: AUTODEPOSIT_NONCE,
        policy: new PublicKey(candidate.address),
        policySeed: BigInt(candidate.seed),
        policySigner: args.policySigner,
        recurringDelegation,
        settingsPda: args.settings,
        walletAddress: args.wallet,
      });
      matches.push({
        account: new PublicKey(candidate.address),
        seed: BigInt(candidate.seed),
      });
    } catch {
      // Exact canonical validation is the classifier; unrelated policies are ignored.
    }
  }
  if (matches.length > 1) throw new Error("Multiple canonical autodeposit policies exist.");
  return matches[0]
    ? { ...matches[0], nonce: AUTODEPOSIT_NONCE, recurringDelegation }
    : null;
}

export async function prepareEarnPolicyState(args: {
  connection: Connection;
  feePayer: PublicKey;
  policySigner: PublicKey;
  settings: PublicKey;
  wallet: PublicKey;
}) {
  return clientFor(args.connection).prepareEarnUsdcYieldRoutingPolicyState({
    cluster: DEMO_CLUSTER,
    feePayer: args.feePayer,
    memo: "Privy Loyal demo: Main-market policies",
    policyScope: "kamino_main_usdc",
    settingsPda: args.settings,
    signer: args.policySigner,
    walletAddress: args.wallet,
  });
}

export async function findExitPolicy(args: {
  connection: Connection;
  details?: Awaited<ReturnType<typeof listPolicyDetails>>;
  policySigner: PublicKey;
  settings: PublicKey;
  wallet: PublicKey;
}) {
  const details =
    args.details ?? (await listPolicyDetails(args.connection, args.settings));
  const matches = details
    .filter((entry) => {
      const policy = entry.policy;
      if (policy.policyState.__kind !== "SpendingLimit") return false;
      const rule = policy.policyState.fields[0];
      return (
        policy.threshold === 1 &&
        policy.timeLock === 0 &&
        policy.signers.length === 1 &&
        policy.signers[0]?.key.equals(args.policySigner) === true &&
        rule.sourceAccountIndex === EARN_VAULT_INDEX &&
        rule.destinations.length === 1 &&
        rule.destinations[0]?.equals(args.wallet) === true &&
        rule.spendingLimit.mint.equals(CANONICAL_USDC_MINT) &&
        toBigInt(rule.spendingLimit.quantityConstraints.maxPerPeriod) ===
          EXIT_DAILY_LIMIT_RAW &&
        rule.spendingLimit.timeConstraints.period.__kind === "Daily"
      );
    })
    .map((entry) => ({
      address: entry.address.toBase58(),
      seed: entry.seed.toString(),
    }));
  if (matches.length > 1) throw new Error("Multiple canonical wallet-exit policies exist.");
  return matches[0] ?? null;
}

export async function findExistingPolicies(args: {
  connection: Connection;
  feePayer: PublicKey;
  policySigner: PublicKey;
  settings: PublicKey;
  wallet: PublicKey;
}): Promise<DemoPolicyBundle | null> {
  const details = await listPolicyDetails(args.connection, args.settings);
  // Only delegated ProgramInteraction policies can be the autodeposit; the
  // canonical assert costs several reads per candidate, so narrow first.
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
  const autodeposit = await findAutodeposit({ ...args, candidates });
  let pair: Awaited<ReturnType<typeof findEarnPolicyPair>> = null;
  try {
    pair = await findEarnPolicyPair({
      ...args,
      autodepositAccount: autodeposit?.account ?? null,
      details,
    });
  } catch {
    // A lone or non-adjacent leftover from an interrupted reset. Discovery
    // reports "no bundle"; the residual-teardown probe routes the user to
    // finish the reset instead of setting up on top of the leftovers.
    pair = null;
  }
  const exit = await findExitPolicy({ ...args, details });
  if (!autodeposit || !pair || !exit) {
    return null;
  }
  if (details.length !== 4) {
    throw new Error(
      `Expected exactly four demo policies, found ${details.length}.`
    );
  }
  return {
    autodeposit: {
      account: autodeposit.account.toBase58(),
      nonce: autodeposit.nonce.toString(),
      recurringDelegation: autodeposit.recurringDelegation.toBase58(),
      seed: autodeposit.seed.toString(),
    },
    earnRoute: {
      account: pair.route.account.toBase58(),
      seed: pair.route.seed.toString(),
    },
    earnSetup: {
      account: pair.setup.account.toBase58(),
      seed: pair.setup.seed.toString(),
    },
    exit: {
      account: exit.address,
      seed: exit.seed,
    },
  };
}

async function createOrRepairAutodeposit(args: {
  connection: Connection;
  feePayer: PublicKey;
  policySigner: PublicKey;
  send: SetupSender;
  settings: PublicKey;
  wallet: PublicKey;
}) {
  const client = clientFor(args.connection);
  let selectedSeed: bigint | undefined;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const existing = await findAutodeposit(args);
    if (existing) return existing;

    const candidateSeeds = selectedSeed
      ? [selectedSeed]
      : (await listPolicyReferences(args.connection, args.settings)).map((policy) =>
          BigInt(policy.seed)
        );
    let setup = null;
    for (const policySeed of [...candidateSeeds, undefined]) {
      try {
        setup = await client.prepareEarnUsdcAutodepositSetup({
          amountRaw: AUTODEPOSIT_AMOUNT_RAW,
          cluster: DEMO_CLUSTER,
          expiryTimestamp: AUTODEPOSIT_EXPIRY,
          feePayer: args.wallet,
          nonce: AUTODEPOSIT_NONCE,
          periodLengthSeconds: AUTODEPOSIT_PERIOD_SECONDS,
          ...(policySeed === undefined ? {} : { policySeed }),
          policySigner: args.policySigner,
          settingsPda: args.settings,
          signer: args.wallet,
          startTimestamp: 0n,
          walletAddress: args.wallet,
        });
        break;
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes("collides with an existing non-Autodeposit policy") ||
            error.message.includes("already exist"))
        ) {
          continue;
        }
        throw error;
      }
    }
    if (!setup || setup.policy.seed === null) {
      throw new Error("Could not resolve the next autodeposit setup stage.");
    }
    selectedSeed = setup.policy.seed;
    const stage: Record<typeof setup.stage, SponsorStage> = {
      initialize_subscription_authority: "autodeposit-authority",
      create_policy: "autodeposit-policy",
      create_recurring_delegation: "autodeposit-delegation",
      approve_token_delegate: "autodeposit-approval",
    };
    await args.send({
      autodepositPolicySeed: selectedSeed,
      label: `Autodeposit: ${setup.stage.replaceAll("_", " ")}`,
      prepared: setup.prepared,
      stage: stage[setup.stage],
    });
  }
  throw new Error("Autodeposit setup did not converge after seven finalized stages.");
}

export async function createOrFindPolicies(args: {
  connection: Connection;
  feePayer: PublicKey;
  policySigner: PublicKey;
  send: SetupSender;
  sendBatch?: (
    entries: Array<{
      label: string;
      prepared: PreparedLoyalSmartAccountsOperation<string>;
      stage: SponsorStage;
    }>
  ) => Promise<void>;
  settings: PublicKey;
  wallet: PublicKey;
}): Promise<DemoPolicyBundle> {
  const existing = await findExistingPolicies(args);
  if (existing) return existing;
  const client = clientFor(args.connection);
  await createOrRepairAutodeposit(args);

  // The route, setup, and exit policies are independent creations, so they
  // can be prepared together and signed with one Privy approval.
  const batch: Array<{
    label: string;
    prepared: PreparedLoyalSmartAccountsOperation<string>;
    stage: SponsorStage;
  }> = [];
  const earn = await prepareEarnPolicyState(args);
  if (earn.policySetupPrepared) {
    batch.push({
      label: "Create Kamino Main route policy",
      prepared: earn.policySetupPrepared,
      stage: "earn-route-policy",
    });
  }
  if (earn.policyFinalizePrepared) {
    batch.push({
      label: "Create Kamino Main setup policy",
      prepared: earn.policyFinalizePrepared,
      stage: "earn-setup-policy",
    });
  }
  const exit = await findExitPolicy(args);
  if (!exit) {
    const existingSpending = await client.listSpendingLimitPolicies({
      settingsPda: args.settings,
    });
    if (existingSpending.length > 0) {
      throw new Error("An incompatible spending-limit policy already exists.");
    }
    const prepared = await client.prepareSetSpendingLimitPolicy({
      accountIndex: EARN_VAULT_INDEX,
      amount: EXIT_DAILY_LIMIT_RAW,
      creator: args.wallet,
      destinations: [args.wallet],
      feePayer: args.feePayer,
      memo: "Privy Loyal demo: return USDC only to originating wallet",
      mint: CANONICAL_USDC_MINT,
      period: "day",
      settingsPda: args.settings,
      signer: args.policySigner,
    });
    batch.push({
      label: "Create 10 USDC/day wallet exit limit",
      prepared: prepared.prepared,
      stage: "exit-policy",
    });
  }
  if (batch.length > 1 && args.sendBatch) {
    await args.sendBatch(batch);
  } else {
    for (const entry of batch) await args.send(entry);
  }

  let complete = await findExistingPolicies(args);
  if (!complete) {
    // Some resolver versions only surface the setup-policy creation after
    // the route policy exists; one follow-up covers that shape.
    const followUp = await prepareEarnPolicyState(args);
    if (followUp.policyFinalizePrepared) {
      await args.send({
        label: "Create Kamino Main setup policy",
        prepared: followUp.policyFinalizePrepared,
        stage: "earn-setup-policy",
      });
    }
    complete = await findExistingPolicies(args);
  }
  if (!complete) throw new Error("Policy setup finalized but exact discovery is incomplete.");
  return complete;
}
