import { neon } from "@neondatabase/serverless";

const YIELD_DATABASE_URL_ENV_NAME = "NEON_DATABASE_URL";

function printHelpAndExit(): never {
  console.log(`Usage:
  op run --env-file=.env.1password -- sh -c 'bun run scripts/report-earn-deposit-onboarding-strands.ts'

Reports recoverable Earn deposit onboarding rows and stranded policy/vault state.
This script is read-only and never mutates live data.

Environment:
  NEON_DATABASE_URL         Yield Neon database URL.
`);
  process.exit(0);
}

function requireDatabaseUrl(): string {
  const databaseUrl = process.env[YIELD_DATABASE_URL_ENV_NAME];
  if (!databaseUrl) {
    throw new Error(`${YIELD_DATABASE_URL_ENV_NAME} is required.`);
  }
  return databaseUrl;
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelpAndExit();
  }

  const sql = neon(requireDatabaseUrl());
  const [onboardingRows, routePolicyPairs, routePoliciesWithoutState] =
    await Promise.all([
      sql`
        SELECT
          status,
          COUNT(*)::int AS count,
          MIN(updated_at) AS oldest_updated_at,
          MAX(updated_at) AS newest_updated_at
        FROM loyal_yield.earn_deposit_onboarding_attempts
        WHERE status <> 'complete'
        GROUP BY status
        ORDER BY status
      `,
      sql`
        SELECT COUNT(*)::int AS count
        FROM loyal_yield.route_policies route_policy
        LEFT JOIN loyal_yield.managed_vaults vault
          ON vault.active_policy_id = route_policy.id
        LEFT JOIN loyal_yield.user_yield_positions position
          ON position.policy_account = route_policy.policy_account
         AND position.status = 'active'
        WHERE route_policy.active = true
          AND vault.id IS NULL
          AND position.id IS NULL
      `,
      sql`
        SELECT
          route_policy.settings,
          route_policy.vault_index,
          route_policy.vault_pubkey,
          route_policy.policy_account,
          route_policy.policy_seed::text AS policy_seed,
          route_policy.last_seen_signature,
          route_policy.last_seen_slot::text AS last_seen_slot,
          route_policy.last_seen_at
        FROM loyal_yield.route_policies route_policy
        LEFT JOIN loyal_yield.managed_vaults vault
          ON vault.active_policy_id = route_policy.id
        LEFT JOIN loyal_yield.user_yield_positions position
          ON position.policy_account = route_policy.policy_account
         AND position.status = 'active'
        WHERE route_policy.active = true
          AND vault.id IS NULL
          AND position.id IS NULL
        ORDER BY route_policy.last_seen_at DESC
        LIMIT 25
      `,
    ]);

  console.log("Earn deposit onboarding recovery report");
  console.log("");
  console.log("Pending onboarding attempts by status:");
  console.table(onboardingRows);
  console.log("");
  console.log(
    "Active route policies without managed vault or active position:"
  );
  console.table(routePolicyPairs);
  console.log("");
  console.log("Newest stranded route-policy samples:");
  console.table(routePoliciesWithoutState);
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Failed to report onboarding rows."
  );
  process.exit(1);
});
