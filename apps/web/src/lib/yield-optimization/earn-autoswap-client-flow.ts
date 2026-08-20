import {
  createSmartAccountVaultsClient,
  type SmartAccountPreparedEarnCrossMintSwapPolicy,
} from "@loyal-labs/smart-account-vaults";
import type { PublicKey } from "@solana/web3.js";

type AutoswapClient = Pick<
  ReturnType<typeof createSmartAccountVaultsClient>,
  "prepareClosePoliciesSync" | "prepareEarnCrossMintSwapPolicies"
>;

type PreparedPolicy = NonNullable<
  SmartAccountPreparedEarnCrossMintSwapPolicy["prepared"]
>;

export async function executeEarnAutoswapSetupClient(args: {
  client: AutoswapClient;
  input: Parameters<AutoswapClient["prepareEarnCrossMintSwapPolicies"]>[0];
  sendPrepared: (
    prepared: PreparedPolicy,
    context: {
      policyNumber: number;
      sourceShard: "classic" | "token_2022";
    }
  ) => Promise<string>;
}): Promise<{ completedPolicies: number }> {
  const installed = new Set<"classic" | "token_2022">();

  // Settings.nextPolicySeed advances after each PolicyCreate. Re-read Settings
  // and re-plan after every confirmed send instead of trusting a stale second
  // transaction prepared before the first one landed.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const preparedSet = await args.client.prepareEarnCrossMintSwapPolicies(
      args.input
    );
    for (const policy of preparedSet.policies) {
      if (policy.existing) {
        installed.add(policy.sourceShard);
      }
    }
    if (installed.size === 2) {
      return { completedPolicies: 2 };
    }

    const nextPolicy = preparedSet.policies
      .filter(
        (policy): policy is typeof policy & { prepared: PreparedPolicy } =>
          Boolean(policy.prepared) && !installed.has(policy.sourceShard)
      )
      .sort((left, right) =>
        left.policy.seed < right.policy.seed ? -1 : 1
      )[0];
    if (!nextPolicy) {
      break;
    }
    await args.sendPrepared(nextPolicy.prepared, {
      policyNumber: installed.size + 1,
      sourceShard: nextPolicy.sourceShard,
    });
    installed.add(nextPolicy.sourceShard);
    if (installed.size === 2) {
      return { completedPolicies: 2 };
    }
  }

  throw new Error(
    "Autoswap setup did not resolve both policy shards. Refresh and try again."
  );
}

export async function prepareEarnAutoswapDeletionClient(args: {
  client: AutoswapClient;
  feePayer: PublicKey;
  policies: PublicKey[];
  settingsPda: PublicKey;
  signer: PublicKey;
}) {
  if (args.policies.length === 0) {
    return null;
  }
  return args.client.prepareClosePoliciesSync({
    feePayer: args.feePayer,
    policies: args.policies,
    settingsPda: args.settingsPda,
    signers: [args.signer],
  });
}
