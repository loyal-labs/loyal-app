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
    floorRoute,
    toggleRoute,
    earnStateRoute,
    hook,
    loadStateMapper,
    workspace,
    portfolioContent,
    migration0005,
    migration0006,
    migration0007,
    migration0009,
    migration0015,
    migration0021,
    migration0022,
    migration0023,
    smartAccountClient,
  ] = await Promise.all([
    read("apps/web/src/lib/yield-optimization/yield-neon-client.server.ts"),
    read(
      "apps/web/src/lib/yield-optimization/earn-autodeposit-prepare-contracts.shared.ts"
    ),
    read(
      "apps/web/src/lib/yield-optimization/earn-autodeposit-repository.server.ts"
    ),
    read(
      "apps/web/src/app/api/smart-accounts/yield-optimization/autodeposit/setup/confirm/route.ts"
    ),
    read(
      "apps/web/src/app/api/smart-accounts/yield-optimization/autodeposit/close/confirm/route.ts"
    ),
    read(
      "apps/web/src/app/api/smart-accounts/yield-optimization/autodeposit/floor/confirm/route.ts"
    ),
    read(
      "apps/web/src/app/api/smart-accounts/yield-optimization/autodeposit/toggle/confirm/route.ts"
    ),
    read(
      "apps/web/src/app/api/smart-accounts/yield-optimization/earn-state/route.ts"
    ),
    read("apps/web/src/hooks/use-smart-account-sidebar-data.ts"),
    read(
      "apps/web/src/lib/yield-optimization/earn-autodeposit-loaded-state.shared.ts"
    ),
    read("apps/web/src/components/wallet-workspace/app-wallet-workspace.tsx"),
    read("apps/web/src/components/wallet-sidebar/portfolio-content.tsx"),
    read(
      "apps/web/src/lib/yield-optimization/migrations/0005_add_autodeposit_balance_sweep_config.sql"
    ),
    read(
      "apps/web/src/lib/yield-optimization/migrations/0006_add_balance_sweep_policies.sql"
    ),
    read(
      "apps/web/src/lib/yield-optimization/migrations/0007_add_balance_sweep_target_start_timestamp.sql"
    ),
    read(
      "apps/web/src/lib/yield-optimization/migrations/0009_add_floor_rebaseline_surplus_classification.sql"
    ),
    read(
      "apps/web/src/lib/yield-optimization/migrations/0015_add_balance_sweep_target_token_accounts.sql"
    ),
    read(
      "apps/web/src/lib/yield-optimization/migrations/0021_allow_pending_policy_autodeposit_targets.sql"
    ),
    read(
      "apps/web/src/lib/yield-optimization/migrations/0022_earn_realtime_events.sql"
    ),
    read(
      "apps/web/src/lib/yield-optimization/migrations/0023_autodeposit_execution_slot_realtime.sql"
    ),
    read("packages/smart-account-vaults/src/client.ts"),
  ]);

  record(
    checks,
    "setup order",
    smartAccountClient.indexOf('stage: "initialize_subscription_authority"') <
      smartAccountClient.indexOf('stage: "create_policy"') &&
      smartAccountClient.indexOf('stage: "create_policy"') <
        smartAccountClient.lastIndexOf(
          'stage: "create_recurring_delegation"'
        ) &&
      includesAll(smartAccountClient, [
        "createSubscriptionInitAuthorityInstruction",
        'operation: "earnUsdcAutodepositCreatePolicy"',
        'stage: "create_policy"',
        "instructions: [...policyCreation.instructions]",
        "readSubscriptionAuthorityInitId(authorityAccount)",
        "createSubscriptionCreateRecurringDelegationInstruction",
        'operation: "earnUsdcAutodepositCreateRecurringDelegation"',
      ]),
    "Txn A initializes subscription authority; Txn B creates policy; Txn C reads init_id before creating recurring delegation."
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
      "destinationTokenAta",
      "mint",
      "sourceTokenAta",
      "walletBalanceFloorRaw",
      "tokenMint",
      "walletTokenAta",
      "vaultTokenAta",
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
    includesAll(
      migration0005 +
        migration0006 +
        migration0007 +
        migration0015 +
        migration0021,
      [
        "CREATE TABLE IF NOT EXISTS loyal_yield.balance_sweep_policies",
        "balance_sweep_policy_id",
        "balance_sweep_policies_policy_account_uidx",
        "balance_sweep_targets_policy_id_fkey",
        "ADD COLUMN IF NOT EXISTS subscription_authority",
        "ADD COLUMN IF NOT EXISTS recurring_delegation",
        "ADD COLUMN IF NOT EXISTS period_length_seconds",
        "ADD COLUMN IF NOT EXISTS start_timestamp",
        "ADD COLUMN IF NOT EXISTS token_mint",
        "ADD COLUMN IF NOT EXISTS wallet_token_ata",
        "ADD COLUMN IF NOT EXISTS vault_token_ata",
        "ADD COLUMN IF NOT EXISTS source_token_ata",
        "ADD COLUMN IF NOT EXISTS destination_token_ata",
        "ADD COLUMN IF NOT EXISTS mint",
        "ADD PRIMARY KEY (target_id, mint)",
        "ADD COLUMN IF NOT EXISTS wallet_balance_floor_raw",
        "ADD COLUMN IF NOT EXISTS lifecycle_status",
        "pending_policy",
        "balance_sweep_executions_target_mint_slot_idx",
        "balance_sweep_targets_recurring_delegation_uidx",
        "balance_sweep_targets_lifecycle_status_idx",
        "balance_sweep_targets_active_wallet_token_ata_idx",
        "balance_sweep_targets_wallet_token_idx",
        "balance_sweep_wallet_balance_events_target_mint_event_idx",
        "balance_sweep_wallet_balances_wallet_token_idx",
      ]
    ),
    "Migration extends balance-sweep token-account tables additively."
  );

  record(
    checks,
    "floor rebaseline migration",
    includesAll(migration0009 + client, [
      "ADD VALUE IF NOT EXISTS 'floor_rebaseline'",
      "balance_sweep_floor_rebaseline_event_id_seq",
      "INCREMENT BY -1",
      "MAXVALUE -1000000000000",
      '"floor_rebaseline"',
    ]),
    "Migration adds a distinct negative synthetic-event sequence and typed floor-rebaseline classification."
  );

  record(
    checks,
    "earn realtime migration sync",
    includesAll(migration0022 + migration0023, [
      "realtime_events_smart_account_address_id_idx",
      "realtime_events_event_type_id_idx",
      "realtime_private_scope_requires_identity",
      "realtime_relation_has_columns",
      "CREATE OR REPLACE FUNCTION loyal_yield.emit_realtime_event",
      "private realtime event %.% requires wallet_address, settings_pda, or smart_account_address",
      "emit_autodeposit_scheduled_slot_realtime_event",
      "earn.autodeposit.sweep_requested",
      "earn.autodeposit.sweep_selected",
      "emit_autodeposit_execution_realtime_event",
      "balance_sweep_executions_realtime_event",
      "emit_user_yield_position_realtime_event",
      "user_yield_positions_realtime_event",
      "emit_user_yield_holding_event_realtime_event",
      "user_yield_position_holding_events_realtime_event",
      "emit_earn_onboarding_realtime_event",
      "earn_deposit_onboarding_attempts_realtime_event",
      "LEFT JOIN loyal_yield.balance_sweep_lot_claims AS claim",
      "claim.status = 'selected'",
      "claim.execution_id IS NULL",
    ]),
    "Frontend migration set mirrors routing realtime event and execution-slot trigger migrations."
  );

  record(
    checks,
    "chain-confirmed setup persistence",
    includesAll(setupRoute + repository, [
      "resolveConfirmedSignatureSlot",
      "recordPendingAutodepositSetup",
      "recordConfirmedAutodepositDelegation",
      "readBootstrapWalletBalanceSnapshot",
      "scheduleBootstrapEarnAutodepositSweep",
      "bootstrapSweep",
      'status: "failed"',
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
    "bootstrap scheduled sweep persistence",
    includesAll(repository + setupRoute + contracts, [
      "EarnAutodepositBootstrapWalletBalanceSnapshot",
      "createBootstrapWalletBalanceEventId",
      "upsertBalanceSweepWalletBalanceCurrent",
      "balanceSweepWalletBalanceEvents",
      "balanceSweepSurplusLots",
      "sourceEventId",
      "initial_surplus",
      "confirmed_snapshot",
      "resolveEarnAutodepositSweepEligibleAfter",
      "originalAmountRaw: surplusRaw",
      "remainingAmountRaw: surplusRaw",
      "onConflictDoNothing",
      "wallet_balance_at_or_below_floor",
      "wallet_usdc_ata_missing",
      "wallet_usdc_ata_invalid_data",
      "wallet_usdc_ata_non_usdc",
      "EarnAutodepositSetupConfirmResponse",
      "bootstrapSweep?:",
    ]),
    "Final setup can schedule exactly one initial-surplus lot from a confirmed wallet USDC ATA snapshot while reporting skip/failure status."
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

  record(
    checks,
    "load/display state",
    includesAll(
      repository + earnStateRoute + hook + workspace + loadStateMapper,
      [
        "findCurrentEarnAutodepositState",
        "loadEarnStatePart",
        'loadEarnStatePart("position"',
        'loadEarnStatePart("policy"',
        '"autodeposit",\n        async (): Promise<CurrentEarnAutodepositStateWithProgress | null>',
        "Promise<{ data: T | null; error: boolean }>",
        "positionResult.data",
        "policyResult.data",
        "autodepositResult.data",
        "loadErrors",
        "failed to load ${name}",
        "balanceSweepPolicies",
        "balanceSweepTargets",
        "balanceSweepPolicyId",
        "innerJoin",
        "serializeAutodepositState",
        "startTimestamp",
        "autodeposit: autodeposit",
        "earnStateLoadErrors: earnState?.loadErrors ?? {}",
        "isEarnStateLoading",
        "earnAutodeposit: earnState?.autodeposit ?? null",
        "earnAutodepositConfigFromLoadedState",
        "nextPeriodLabel",
        "formatNextPeriodLabel",
        "smartAccountData.earnAutodeposit",
        'status: "active" | "paused" | "pending"',
        'LoadedEarnAutodepositConfig["state"]',
        'autodeposit.status === "paused"',
      ]
    ),
    "earn-state serializes active/pending/paused autodeposit state and the UI derives config from the API response."
  );

  record(
    checks,
    "scheduled sweep UI handoff",
    includesAll(hook + workspace + loadStateMapper, [
      "confirmResponse.bootstrapSweep?.sweep",
      "scheduledSweeps: result.scheduledSweeps ?? []",
      "isEarnAutodepositSetupConfirming",
      "!isEarnAutodepositSetupConfirming",
      "pendingScheduledSweepPreview",
      "(autodepositConfig.scheduledSweeps?.length ?? 0) > 0",
      "nextEarnState?.autodeposit?.scheduledSweeps ?? []",
    ]),
    "The workspace shows the pending scheduling preview only during setup confirmation and replaces it with returned/refreshed scheduledSweeps."
  );

  record(
    checks,
    "earn-state fail-soft metadata",
    includesAll(earnStateRoute + hook, [
      "loadErrors",
      "position?: true",
      "policy?: true",
      "autodeposit?: true",
      "positionResult.error ? { position: true } : {}",
      "policyResult.error ? { policy: true } : {}",
      "autodepositResult.error ? { autodeposit: true } : {}",
      "earnStateLoadErrors: earnState?.loadErrors ?? {}",
      "setIsEarnStateLoading(true)",
      "setIsEarnStateLoading(false)",
    ]),
    "Earn-state reports per-part load failures while keeping partial data available to the UI."
  );

  record(
    checks,
    "stable Autodeposit sidebar card",
    includesAll(portfolioContent + workspace, [
      "AutodepositStatusCard",
      "Start earning the moment your money arrives",
      "Couldn’t load Autodeposit settings",
      "isLoading={shouldShowAutodepositSkeleton}",
      "shouldShowAutodepositSkeleton",
      "isEarnStateLoading",
      "!hasEarnStateResolved",
      "!hasEarnStateLoadError",
      "!isAutodepositConfigured",
      "isError={hasEarnStateLoadError}",
      "onRetry={onSmartAccountRetry}",
      "hasEarnStateLoadError={Boolean(",
      "smartAccountData.earnStateLoadErrors.autodeposit",
      "isEarnStateLoading={smartAccountData.isEarnStateLoading}",
    ]) &&
      !portfolioContent.includes(
        "onOpenAutodeposit && !isAutodepositConfigured"
      ),
    "The left sidebar renders a stable Autodeposit status card instead of hiding it when configured."
  );

  record(
    checks,
    "edit routing",
    includesAll(contracts + repository + floorRoute + hook + workspace, [
      "parseEarnAutodepositFloorUpdateConfirmRequestBody",
      "updateAutodepositWalletBalanceFloor",
      "rebaselineSweep",
      "floor_rebaseline",
      "wallet_balance_projection_missing",
      "wallet_balance_at_or_below_floor",
      "executeEarnAutodepositFloorUpdate",
      "!autodepositCanUseFloorUpdate",
      "autodepositIsPendingSetup",
      "amountChanged",
      "pendingEarnAutodepositDraft.requiresSignature === false",
      "policySeed: pendingEarnAutodepositDraft.existingPolicySeed",
    ]),
    "Autodeposit edits route max changes through signed delegation setup and floor-only changes through an authenticated DB update."
  );

  record(
    checks,
    "pause/resume routing",
    includesAll(contracts + repository + toggleRoute + hook + workspace, [
      "parseEarnAutodepositToggleConfirmRequestBody",
      "updateAutodepositTargetActive",
      "executeEarnAutodepositToggle",
      "autodeposit/toggle/confirm",
      "active: input.active",
      'existing.lifecycleStatus === "closed"',
      'existing.lifecycleStatus !== "active"',
      'state: nextActive ? "created" : "paused"',
      "handleOpenAutodepositCloseReview",
      "handleDeleteAutodeposit",
    ]) &&
      !toggleRoute.includes("resolveConfirmedSignatureSlot") &&
      !toggleRoute.includes("Connection") &&
      !toggleRoute.includes("closeSignature"),
    "The Earn card switch uses a DB-only target.active toggle, while delete remains on the signed close review path."
  );

  record(
    checks,
    "monitorable target predicate",
    includesAll(repository + client + migration0005, [
      "balanceSweepTargets.active",
      "balanceSweepTargets.lifecycleStatus",
      "lifecycle_status, active",
      "CASE WHEN",
      'target.active ? "active" : "paused"',
    ]),
    "Code and indexes preserve target-active plus active-lifecycle as the monitorability boundary."
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
          'start_timestamp',
          'token_mint',
          'wallet_token_ata',
          'vault_token_ata',
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
          'balance_sweep_targets_lifecycle_status_idx',
          'balance_sweep_targets_active_wallet_token_ata_idx',
          'balance_sweep_targets_wallet_token_idx'
        )
      ORDER BY indexname;
    `);
    const liveGenericTokenColumns = await runPsql(`
      SELECT table_name || '.' || column_name
      FROM information_schema.columns
      WHERE table_schema = 'loyal_yield'
        AND (
          (
            table_name = 'balance_sweep_wallet_balances_current'
            AND column_name IN ('wallet_token_ata', 'mint')
          )
          OR (
            table_name = 'balance_sweep_wallet_balance_events'
            AND column_name IN ('wallet_token_ata', 'mint')
          )
          OR (
            table_name = 'balance_sweep_executions'
            AND column_name IN ('token_mint', 'source_token_ata', 'destination_token_ata')
          )
        )
        AND is_nullable = 'NO'
      ORDER BY table_name, column_name;
    `);
    const liveGenericTokenIndexes = await runPsql(`
      SELECT tablename || '.' || indexname
      FROM pg_indexes
      WHERE schemaname = 'loyal_yield'
        AND indexname IN (
          'balance_sweep_wallet_balances_wallet_token_idx',
          'balance_sweep_wallet_balance_events_target_mint_event_idx',
          'balance_sweep_executions_target_mint_slot_idx'
        )
      ORDER BY tablename, indexname;
    `);
    const liveWalletBalancePrimaryKey = await runPsql(`
      SELECT ARRAY_TO_STRING(ARRAY_AGG(a.attname ORDER BY cols.ordinality), ',')
      FROM pg_constraint c
      CROSS JOIN LATERAL UNNEST(c.conkey) WITH ORDINALITY AS cols(attnum, ordinality)
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid
       AND a.attnum = cols.attnum
      WHERE c.conrelid = 'loyal_yield.balance_sweep_wallet_balances_current'::regclass
        AND c.contype = 'p'
      GROUP BY c.conname;
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
    const liveLifecycleConstraint = await runPsql(`
      SELECT pg_get_constraintdef(oid)
      FROM pg_constraint
      WHERE conrelid = 'loyal_yield.balance_sweep_targets'::regclass
        AND conname = 'balance_sweep_targets_lifecycle_status_chk';
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
    const liveFloorRebaselineObjects = await runPsql(`
      SELECT 'enum:' || enumlabel
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'loyal_yield'
        AND t.typname = 'balance_sweep_surplus_classification'
        AND enumlabel = 'floor_rebaseline'
      UNION ALL
      SELECT 'sequence:' || to_regclass('loyal_yield.balance_sweep_floor_rebaseline_event_id_seq')::text
      WHERE to_regclass('loyal_yield.balance_sweep_floor_rebaseline_event_id_seq') IS NOT NULL
      ORDER BY 1;
    `);
    const livePolicyLinks = await runPsql(`
      SELECT COUNT(*)
      FROM loyal_yield.balance_sweep_targets AS target
      LEFT JOIN loyal_yield.balance_sweep_policies AS policy
        ON policy.id = target.balance_sweep_policy_id
      WHERE target.lifecycle_status <> 'pending_policy'
        AND (
          target.balance_sweep_policy_id IS NULL
          OR policy.id IS NULL
          OR policy.policy_account <> target.policy_account
        );
    `);
    const liveLoadQueryMisses = await runPsql(`
      SELECT COUNT(*)
      FROM loyal_yield.balance_sweep_targets AS target
      JOIN loyal_yield.balance_sweep_policies AS policy
        ON policy.id = target.balance_sweep_policy_id
      WHERE policy.active = true
        AND policy.policy_type = 'subscription_sweep'
        AND policy.vault_index = 1
        AND target.vault_index = 1
        AND target.active = true
        AND target.lifecycle_status = 'active'
        AND target.recurring_delegation IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM loyal_yield.balance_sweep_policies AS load_policy
          JOIN loyal_yield.balance_sweep_targets AS load_target
            ON load_target.balance_sweep_policy_id = load_policy.id
          WHERE load_policy.active = true
            AND load_policy.authority = policy.authority
            AND load_policy.settings = policy.settings
            AND load_policy.policy_type = 'subscription_sweep'
            AND load_policy.vault_index = 1
            AND load_target.wallet = target.wallet
            AND load_target.settings = target.settings
            AND load_target.vault_index = 1
            AND load_target.lifecycle_status <> 'closed'
            AND load_target.id = target.id
        );
    `);
    const liveClosedReturned = await runPsql(`
      SELECT COUNT(*)
      FROM loyal_yield.balance_sweep_policies AS policy
      JOIN loyal_yield.balance_sweep_targets AS target
        ON target.balance_sweep_policy_id = policy.id
      WHERE policy.active = true
        AND policy.policy_type = 'subscription_sweep'
        AND policy.vault_index = 1
        AND target.vault_index = 1
        AND target.lifecycle_status <> 'closed'
        AND target.lifecycle_status = 'closed';
    `);
    const livePausedMonitorable = await runPsql(`
      SELECT COUNT(*)
      FROM loyal_yield.balance_sweep_policies AS policy
      JOIN loyal_yield.balance_sweep_targets AS target
        ON target.balance_sweep_policy_id = policy.id
      WHERE policy.active = true
        AND policy.policy_type = 'subscription_sweep'
        AND policy.vault_index = 1
        AND target.vault_index = 1
        AND target.lifecycle_status = 'active'
        AND target.active = false
        AND target.recurring_delegation IS NOT NULL
        AND policy.active = true
        AND target.active = true
        AND target.lifecycle_status = 'active';
    `);
    const liveResumedMonitorableMisses = await runPsql(`
      SELECT COUNT(*)
      FROM loyal_yield.balance_sweep_policies AS policy
      JOIN loyal_yield.balance_sweep_targets AS target
        ON target.balance_sweep_policy_id = policy.id
      WHERE policy.active = true
        AND policy.policy_type = 'subscription_sweep'
        AND policy.vault_index = 1
        AND target.vault_index = 1
        AND target.lifecycle_status = 'active'
        AND target.active = true
        AND target.recurring_delegation IS NOT NULL
        AND NOT (
          policy.active = true
          AND target.active = true
          AND target.lifecycle_status = 'active'
        );
    `);

    record(
      checks,
      "live Neon columns",
      includesAll(liveColumns, [
        "subscription_authority",
        "recurring_delegation",
        "period_length_seconds",
        "start_timestamp",
        "token_mint",
        "wallet_token_ata",
        "vault_token_ata",
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
        "balance_sweep_targets_active_wallet_token_ata_idx",
        "balance_sweep_targets_lifecycle_status_idx",
        "balance_sweep_targets_recurring_delegation_uidx",
        "balance_sweep_targets_wallet_token_idx",
      ]),
      "Live loyal_yield.balance_sweep_targets has autodeposit indexes."
    );
    record(
      checks,
      "live Neon generic token columns",
      includesAll(liveGenericTokenColumns, [
        "balance_sweep_executions.destination_token_ata",
        "balance_sweep_executions.source_token_ata",
        "balance_sweep_executions.token_mint",
        "balance_sweep_wallet_balance_events.mint",
        "balance_sweep_wallet_balance_events.wallet_token_ata",
        "balance_sweep_wallet_balances_current.mint",
        "balance_sweep_wallet_balances_current.wallet_token_ata",
      ]),
      "Live balance-sweep projection/event/execution tables have required generic token-account columns."
    );
    record(
      checks,
      "live Neon generic token indexes",
      includesAll(liveGenericTokenIndexes, [
        "balance_sweep_executions.balance_sweep_executions_target_mint_slot_idx",
        "balance_sweep_wallet_balance_events.balance_sweep_wallet_balance_events_target_mint_event_idx",
        "balance_sweep_wallet_balances_current.balance_sweep_wallet_balances_wallet_token_idx",
      ]),
      "Live balance-sweep projection/event/execution tables have generic token-account indexes."
    );
    record(
      checks,
      "live Neon wallet balance primary key",
      liveWalletBalancePrimaryKey === "target_id,mint",
      "Live balance_sweep_wallet_balances_current is keyed by target_id plus mint."
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
      "live Neon pending-policy lifecycle",
      liveLifecycleConstraint.includes("pending_policy"),
      "Live lifecycle constraint allows delegation-first pending_policy rows."
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
      "live Neon floor rebaseline objects",
      includesAll(liveFloorRebaselineObjects, [
        "enum:floor_rebaseline",
        "sequence:loyal_yield.balance_sweep_floor_rebaseline_event_id_seq",
      ]),
      "Live Neon can cast floor_rebaseline lots and allocate synthetic rebaseline event ids."
    );
    record(
      checks,
      "live Neon policy backfill",
      livePolicyLinks === "0",
      "Every non-pending_policy balance-sweep target links to a matching balance-sweep policy."
    );
    record(
      checks,
      "live Neon active load visibility",
      liveLoadQueryMisses === "0",
      "Active subscription-sweep targets with recurring delegation are visible to the earn-state load query."
    );
    record(
      checks,
      "live Neon closed load exclusion",
      liveClosedReturned === "0",
      "Closed balance-sweep targets are excluded from configured autodeposit load state."
    );
    record(
      checks,
      "live Neon paused monitor exclusion",
      livePausedMonitorable === "0",
      "Paused active-lifecycle targets are excluded from the policy.active + target.active + active-lifecycle monitorable predicate."
    );
    record(
      checks,
      "live Neon resumed monitor inclusion",
      liveResumedMonitorableMisses === "0",
      "Resumed active-lifecycle targets are included by the monitorable predicate."
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
