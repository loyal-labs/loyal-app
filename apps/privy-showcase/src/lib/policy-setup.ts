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
import {
  AUTODEPOSIT_AMOUNT_RAW,
  AUTODEPOSIT_EXPIRY,
  AUTODEPOSIT_NONCE,
  AUTODEPOSIT_PERIOD_SECONDS,
  AUTODEPOSIT_STAGE_BY_SDK_STAGE,
  type DemoPolicyBundle,
  EXIT_DAILY_LIMIT_RAW,
  type SponsorStage,
} from "./sponsor-protocol";

type SetupSender = (args: {
  autodepositPolicySeed?: bigint;
  label: string;
  prepared: PreparedLoyalSmartAccountsOperation<string>;
  stage: SponsorStage;
}) => Promise<void>;

function clientFor(connection: Connection) {
  return createSmartAccountVaultsClient({
    connection,
    programId: SQUADS_PROGRAM_ID,
  });
}

async function listPolicyReferences(connection: Connection, settings: PublicKey) {
  const rows = await connection.getProgramAccounts(SQUADS_PROGRAM_ID, {
    commitment: "confirmed",
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
      return { address: pubkey.toBase58(), seed: toBigInt(policy.seed).toString() };
    })
    .sort((left, right) => (BigInt(left.seed) > BigInt(right.seed) ? 1 : -1));
}

async function findAutodeposit(args: {
  connection: Connection;
  policySigner: PublicKey;
  settings: PublicKey;
  wallet: PublicKey;
}) {
  const client = clientFor(args.connection);
  const policies = await listPolicyReferences(args.connection, args.settings);
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

async function prepareEarnPolicyState(args: {
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

async function findExitPolicy(args: {
  connection: Connection;
  policySigner: PublicKey;
  settings: PublicKey;
  wallet: PublicKey;
}) {
  const policies = await clientFor(args.connection).listSpendingLimitPolicies({
    settingsPda: args.settings,
  });
  const matches = policies.filter(
    (policy) =>
      policy.accountIndex === EARN_VAULT_INDEX &&
      policy.mint === CANONICAL_USDC_MINT.toBase58() &&
      policy.amountRaw === EXIT_DAILY_LIMIT_RAW.toString() &&
      policy.period === "day" &&
      policy.destinations.length === 1 &&
      policy.destinations[0] === args.wallet.toBase58() &&
      policy.signers.length === 1 &&
      policy.signers[0] === args.policySigner.toBase58()
  );
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
  const [autodeposit, earn, exit, allPolicies] = await Promise.all([
    findAutodeposit(args),
    prepareEarnPolicyState(args),
    findExitPolicy(args),
    listPolicyReferences(args.connection, args.settings),
  ]);
  const setup = earn.setupPolicy;
  if (
    !autodeposit ||
    Boolean(earn.policySetupPrepared) ||
    Boolean(earn.policyFinalizePrepared) ||
    !setup ||
    !exit
  ) {
    return null;
  }
  if (allPolicies.length !== 4) {
    throw new Error(
      `Expected exactly four demo policies, found ${allPolicies.length}.`
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
      account: earn.policy.account.toBase58(),
      seed: earn.policy.seed.toString(),
    },
    earnSetup: {
      account: setup.account.toBase58(),
      seed: setup.seed.toString(),
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
    await args.send({
      autodepositPolicySeed: selectedSeed,
      label: `Autodeposit: ${setup.stage.replaceAll("_", " ")}`,
      prepared: setup.prepared,
      stage: AUTODEPOSIT_STAGE_BY_SDK_STAGE[setup.stage],
    });
  }
  throw new Error("Autodeposit setup did not converge after seven finalized stages.");
}

export async function createOrFindPolicies(args: {
  connection: Connection;
  feePayer: PublicKey;
  policySigner: PublicKey;
  send: SetupSender;
  settings: PublicKey;
  wallet: PublicKey;
}): Promise<DemoPolicyBundle> {
  const existing = await findExistingPolicies(args);
  if (existing) return existing;
  const client = clientFor(args.connection);
  await createOrRepairAutodeposit(args);

  let earn = await prepareEarnPolicyState(args);
  if (earn.policySetupPrepared) {
    await args.send({
      label: "Create Kamino Main route policy",
      prepared: earn.policySetupPrepared,
      stage: "earn-route-policy",
    });
    earn = await prepareEarnPolicyState(args);
  }
  if (earn.policyFinalizePrepared) {
    await args.send({
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
    await args.send({
      label: "Create 10 USDC/day wallet exit limit",
      prepared: prepared.prepared,
      stage: "exit-policy",
    });
  }

  const complete = await findExistingPolicies(args);
  if (!complete) throw new Error("Policy setup finalized but exact discovery is incomplete.");
  return complete;
}
