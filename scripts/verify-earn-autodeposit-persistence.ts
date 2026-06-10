type Check = {
  name: string;
  ok: boolean;
  detail: string;
};

const ROOT = new URL("../", import.meta.url);

async function read(path: string): Promise<string> {
  return Bun.file(new URL(path, ROOT)).text();
}

function includesAll(text: string, needles: string[]): boolean {
  return needles.every((needle) => text.includes(needle));
}

function record(checks: Check[], name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

async function runPsql(query: string): Promise<string> {
  const databaseUrl = process.env.NEON_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("NEON_DATABASE_URL is required for --live.");
  }
  const parsed = new URL(databaseUrl);
  const database = parsed.pathname.replace(/^\//, "");
  const sslMode = parsed.searchParams.get("sslmode") ?? "require";

  const proc = Bun.spawn(
    ["psql", "-v", "ON_ERROR_STOP=1", "-At", "-F", "|", "-c", query],
    {
      env: {
        ...process.env,
        PGDATABASE: database,
        PGHOST: parsed.hostname,
        PGPASSWORD: decodeURIComponent(parsed.password),
        PGPORT: parsed.port || "5432",
        PGSSLMODE: sslMode,
        PGUSER: decodeURIComponent(parsed.username),
      },
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `psql exited with ${exitCode}.`);
  }

  return stdout.trim();
}

async function main() {
  const live = process.argv.includes("--live");
  const checks: Check[] = [];
  const [
    client,
    contracts,
    repository,
    setupRoute,
    closeRoute,
    hook,
    workspace,
    migration0005,
    migration0006,
    smartAccountClient,
  ] = await Promise.all([
    read("frontend/src/lib/yield-optimization/yield-neon-client.server.ts"),
    read(
      "frontend/src/lib/yield-optimization/earn-autodeposit-prepare-contracts.shared.ts"
    ),
    read(
      "frontend/src/lib/yield-optimization/earn-autodeposit-repository.server.ts"
    ),
    read(
      "frontend/src/app/api/smart-accounts/yield-optimization/autodeposit/setup/confirm/route.ts"
    ),
    read(
      "frontend/src/app/api/smart-accounts/yield-optimization/autodeposit/close/confirm/route.ts"
    ),
    read("frontend/src/hooks/use-smart-account-sidebar-data.ts"),
    read("frontend/src/components/wallet-workspace/app-wallet-workspace.tsx"),
    read(
      "frontend/src/lib/yield-optimization/migrations/0005_add_autodeposit_balance_sweep_config.sql"
    ),
    read(
      "frontend/src/lib/yield-optimization/migrations/0006_add_balance_sweep_policies.sql"
    ),
    read("packages/smart-account-vaults/src/client.ts"),
  ]);

  record(
    checks,
    "setup order",
    smartAccountClient.indexOf('stage: "initialize_subscription_authority"') <
      smartAccountClient.indexOf('stage: "create_recurring_delegation"') &&
      includesAll(smartAccountClient, [
        "createSubscriptionInitAuthorityInstruction",
        "...policyCreation.instructions",
        "readSubscriptionAuthorityInitId(authorityAccount)",
        "createSubscriptionCreateRecurringDelegationInstruction",
      ]),
    "Txn A initializes subscription authority plus policy; Txn B reads init_id before delegation."
  );

  record(
    checks,
    "keep amount wire",
    includesAll(contracts + hook + workspace, [
      "walletBalanceFloorRaw",
      "buildEarnAutodepositSetupConfirmRequestBody",
      "postConfirmedEarnAutodepositSetup",
      "parseTokenAmountLabelToRaw",
      "pendingEarnAutodepositDraft.keepAmountLabel",
    ]),
    "UI keepAmount is converted to raw units and posted to setup confirmation."
  );

  record(
    checks,
    "balance-sweep table models",
    includesAll(client, [
      "balanceSweepPolicies",
      "balanceSweepTargets",
      "balanceSweepWalletBalancesCurrent",
      "balanceSweepExecutions",
      "balanceSweepPolicyId",
      "walletBalanceFloorRaw",
      "subscriptionAuthority",
      "recurringDelegation",
      "periodLengthSeconds",
      "lifecycleStatus",
    ]),
    "Yield Neon client models the existing balance-sweep tables plus autodeposit columns."
  );

  record(
    checks,
    "migration columns and indexes",
    includesAll(migration0005 + migration0006, [
      "CREATE TABLE IF NOT EXISTS loyal_yield.balance_sweep_policies",
      "balance_sweep_policy_id",
      "balance_sweep_policies_policy_account_uidx",
      "balance_sweep_targets_policy_id_fkey",
      "ADD COLUMN IF NOT EXISTS subscription_authority",
      "ADD COLUMN IF NOT EXISTS recurring_delegation",
      "ADD COLUMN IF NOT EXISTS period_length_seconds",
      "ADD COLUMN IF NOT EXISTS wallet_balance_floor_raw",
      "ADD COLUMN IF NOT EXISTS lifecycle_status",
      "balance_sweep_targets_recurring_delegation_uidx",
      "balance_sweep_targets_lifecycle_status_idx",
    ]),
    "Migration extends balance_sweep_targets additively."
  );

  record(
    checks,
    "chain-confirmed setup persistence",
    includesAll(setupRoute + repository, [
      "resolveConfirmedSignatureSlot",
      "recordPendingAutodepositSetup",
      "recordConfirmedAutodepositDelegation",
      "upsertBalanceSweepPolicyFromSetup",
      "deriveSubscriptionAuthority",
      "deriveRecurringDelegation",
      "MONTH_PERIOD_SECONDS",
      'lifecycleStatus: "pending_delegation"',
      'lifecycleStatus: "active"',
      "active: false",
      "active: true",
    ]),
    "Setup confirm route validates chain status/canonical PDAs; repository only activates on delegation stage."
  );

  record(
    checks,
    "chain-confirmed close persistence",
    includesAll(closeRoute + repository, [
      "resolveConfirmedSignatureSlot",
      "recordClosedAutodepositTarget",
      "balanceSweepPolicies",
      'lifecycleStatus: "closed"',
      "active: false",
      "closeSignature",
      "closeSlot",
      "closedAt",
    ]),
    "Close confirm route validates confirmed signature before marking target closed."
  );

  record(
    checks,
    "latest wallet projection",
    includesAll(repository + client, [
      "balanceSweepWalletBalancesCurrent",
      "upsertBalanceSweepWalletBalanceCurrent",
      "targetId",
      "observedSlot",
      "observedSlot > input.observedSlot",
    ]),
    "Monitored wallet state is modeled as a latest Neon projection keyed by target_id."
  );

  record(
    checks,
    "append-only sweep executions",
    includesAll(repository + client, [
      "balanceSweepExecutions",
      "recordBalanceSweepExecution",
      "onConflictDoNothing",
      "dedupeKey",
      "sourceWalletAta",
      "destinationVaultAta",
    ]) && !repository.includes("userYieldPositionWithdrawals"),
    "Sweep execution writes are append-only and separate from user Earn withdrawals."
  );

  if (live) {
    const liveColumns = await runPsql(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'loyal_yield'
        AND table_name = 'balance_sweep_targets'
        AND column_name IN (
          'subscription_authority',
          'recurring_delegation',
          'period_length_seconds',
          'wallet_balance_floor_raw',
          'lifecycle_status',
          'close_signature',
          'close_slot',
          'closed_at'
        )
      ORDER BY column_name;
    `);
    const liveIndexes = await runPsql(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'loyal_yield'
        AND tablename = 'balance_sweep_targets'
        AND indexname IN (
          'balance_sweep_targets_recurring_delegation_uidx',
          'balance_sweep_targets_lifecycle_status_idx'
        )
      ORDER BY indexname;
    `);
    const liveConstraints = await runPsql(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'loyal_yield.balance_sweep_targets'::regclass
        AND conname IN (
          'balance_sweep_targets_lifecycle_status_chk',
          'balance_sweep_targets_wallet_balance_floor_raw_chk'
        )
      ORDER BY conname;
    `);
    const livePolicyColumns = await runPsql(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'loyal_yield'
        AND table_name = 'balance_sweep_policies'
        AND column_name IN (
          'id',
          'policy_account',
          'policy_seed',
          'policy_type',
          'authority',
          'vault_index',
          'vault_pubkey',
          'delegated_signers',
          'threshold',
          'max_amount_per_period',
          'active',
          'subscription_authority',
          'subscription_delegatee',
          'last_seen_slot',
          'last_seen_signature'
        )
      ORDER BY column_name;
    `);
    const livePolicyIndexes = await runPsql(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'loyal_yield'
        AND tablename = 'balance_sweep_policies'
        AND indexname IN (
          'balance_sweep_policies_policy_account_uidx',
          'balance_sweep_policies_active_authority_idx'
        )
      ORDER BY indexname;
    `);
    const livePolicyLinks = await runPsql(`
      SELECT COUNT(*)
      FROM loyal_yield.balance_sweep_targets AS target
      LEFT JOIN loyal_yield.balance_sweep_policies AS policy
        ON policy.id = target.balance_sweep_policy_id
      WHERE target.balance_sweep_policy_id IS NULL
        OR policy.id IS NULL
        OR policy.policy_account <> target.policy_account;
    `);

    record(
      checks,
      "live Neon columns",
      includesAll(liveColumns, [
        "subscription_authority",
        "recurring_delegation",
        "period_length_seconds",
        "wallet_balance_floor_raw",
        "lifecycle_status",
        "close_signature",
        "close_slot",
        "closed_at",
      ]),
      "Live loyal_yield.balance_sweep_targets has all autodeposit columns."
    );
    record(
      checks,
      "live Neon indexes",
      includesAll(liveIndexes, [
        "balance_sweep_targets_lifecycle_status_idx",
        "balance_sweep_targets_recurring_delegation_uidx",
      ]),
      "Live loyal_yield.balance_sweep_targets has autodeposit indexes."
    );
    record(
      checks,
      "live Neon constraints",
      includesAll(liveConstraints, [
        "balance_sweep_targets_lifecycle_status_chk",
        "balance_sweep_targets_wallet_balance_floor_raw_chk",
      ]),
      "Live loyal_yield.balance_sweep_targets has lifecycle/floor checks."
    );
    record(
      checks,
      "live Neon balance-sweep policies",
      includesAll(livePolicyColumns, [
        "policy_account",
        "policy_seed",
        "policy_type",
        "authority",
        "vault_index",
        "vault_pubkey",
        "delegated_signers",
        "threshold",
        "max_amount_per_period",
        "active",
        "subscription_authority",
        "subscription_delegatee",
        "last_seen_slot",
        "last_seen_signature",
      ]),
      "Live loyal_yield.balance_sweep_policies has first-class policy columns."
    );
    record(
      checks,
      "live Neon policy indexes",
      includesAll(livePolicyIndexes, [
        "balance_sweep_policies_active_authority_idx",
        "balance_sweep_policies_policy_account_uidx",
      ]),
      "Live loyal_yield.balance_sweep_policies has lookup/uniqueness indexes."
    );
    record(
      checks,
      "live Neon policy backfill",
      livePolicyLinks === "0",
      "Every live balance-sweep target links to a matching balance-sweep policy."
    );
  }

  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length} autodeposit persistence checks failed.`);
    process.exit(1);
  }
}

await main();
