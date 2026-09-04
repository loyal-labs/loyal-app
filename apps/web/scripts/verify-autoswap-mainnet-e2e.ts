import { createHash } from "node:crypto";
import { LoyalCluster } from "@loyal-labs/actions";
import { PROGRAM_ID, pda } from "@loyal-labs/loyal-smart-accounts";
import {
  Settings,
  settingsDiscriminator,
} from "@loyal-labs/loyal-smart-accounts-core";
import {
  createSmartAccountVaultsClient,
  type SmartAccountEarnCrossMintProjectedPolicyInput,
} from "@loyal-labs/smart-account-vaults";
import { getSolanaEndpoints } from "@loyal-labs/solana-rpc";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import postgres from "postgres";

import { getFrontendSolanaRpcFetch } from "../src/lib/solana/rpc-rate-limit";
import {
  executeEarnAutoswapSetupClient,
  prepareEarnAutoswapDeletionClient,
} from "../src/lib/yield-optimization/earn-autoswap-client-flow";

const EXECUTE_ACK = "mainnet-autoswap-isolated-setup-delete";
const YIELD_DATABASE_ENDPOINT_SHA256 =
  "f5bf9367f769718e58899375cb0c5ada166190f87b7141402d2057c9cfd3fd66";
const CLUSTER = "mainnet-beta";
const VAULT_INDEX = 1;
const DAILY_CAP_RAW = BigInt(100_000_000);
const MAX_SLIPPAGE_BPS = 50;
const PROJECTION_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 1000;
const MIN_FEE_BALANCE_LAMPORTS = 10_000_000;
const HEX_KEYPAIR_PATTERN = /^[0-9a-fA-F]+$/;
const HEX_BYTE_PATTERN = /../g;

interface ProjectionRow {
  active: boolean;
  lastMutation: string;
  policyAccount: string;
  policySeed: string | null;
  sourceCommitment: string;
  sourceShard: string | null;
  startEligible: boolean;
}

interface Scope {
  settings: string;
  vaultPubkey: string;
  walletAddress: string;
}

class ExpectedInterruption extends Error {}

function loadKeypair(name: string): Keypair {
  const raw = process.env[name]?.trim();
  if (!raw) {
    throw new Error(`${name} is required.`);
  }
  if (raw.startsWith("[")) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  }
  if (HEX_KEYPAIR_PATTERN.test(raw) && raw.length % 2 === 0) {
    const matchedBytes = raw.match(HEX_BYTE_PATTERN);
    if (!matchedBytes) {
      throw new Error(`${name} contains invalid hexadecimal key material.`);
    }
    const bytes = Uint8Array.from(
      matchedBytes.map((byte) => Number.parseInt(byte, 16))
    );
    return bytes.length === 32
      ? Keypair.fromSeed(bytes)
      : Keypair.fromSecretKey(bytes);
  }
  const bytes = bs58.decode(raw);
  return bytes.length === 32
    ? Keypair.fromSeed(bytes)
    : Keypair.fromSecretKey(bytes);
}

function requireRemoteDatabaseUrl(name: "DATABASE_URL" | "NEON_DATABASE_URL") {
  const raw = process.env[name]?.trim();
  if (!raw) {
    throw new Error(`${name} is required.`);
  }
  const url = new URL(raw);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    ["127.0.0.1", "::1", "localhost"].includes(url.hostname)
  ) {
    throw new Error(`${name} must point to a remote PostgreSQL database.`);
  }
  return raw;
}

function requireIsolatedProjectionDatabaseUrl(): string | null {
  const raw = process.env.AUTOSWAP_E2E_PROJECTION_DATABASE_URL?.trim();
  if (!raw) {
    return null;
  }
  const url = new URL(raw);
  if (
    !(
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      ["127.0.0.1", "::1", "localhost"].includes(url.hostname)
    )
  ) {
    throw new Error(
      "AUTOSWAP_E2E_PROJECTION_DATABASE_URL must point to disposable local PostgreSQL."
    );
  }
  return raw;
}

function databaseEndpointFingerprint(raw: string): string {
  const url = new URL(raw);
  const endpointIdentity = `${url.hostname.toLowerCase()}:${
    url.port || "5432"
  }${url.pathname}`;
  return createHash("sha256").update(endpointIdentity).digest("hex");
}

function createDatabase(url: string, applicationName: string) {
  return postgres(url, {
    connect_timeout: 8,
    connection: {
      application_name: applicationName,
      lock_timeout: 5000,
      statement_timeout: 10_000,
    },
    max: 1,
  });
}

async function chooseIsolatedSettings(args: {
  candidates: readonly string[];
  connection: Connection;
  walletAddress: string;
  yieldDatabase: ReturnType<typeof createDatabase>;
}): Promise<string | null> {
  const isolated: string[] = [];
  for (const candidate of new Set(args.candidates)) {
    const settingsPda = new PublicKey(candidate);
    const account = await args.connection.getAccountInfo(
      settingsPda,
      "finalized"
    );
    if (!account) {
      continue;
    }
    const [settings] = Settings.fromAccountInfo(account);
    if (
      !settings.signers.some(
        (signer) => signer.key.toBase58() === args.walletAddress
      )
    ) {
      continue;
    }
    const vaultPubkey = pda.getSmartAccountPda({
      accountIndex: VAULT_INDEX,
      programId: PROGRAM_ID,
      settingsPda,
    })[0];
    const scope = {
      settings: settingsPda.toBase58(),
      vaultPubkey: vaultPubkey.toBase58(),
      walletAddress: args.walletAddress,
    };
    const projection = await fetchProjection(args.yieldDatabase, scope);
    const [position] = await args.yieldDatabase<
      { activeCount: string; fundedCount: string }[]
    >`
      SELECT
        count(*) FILTER (WHERE status = 'active')::text AS "activeCount",
        count(*) FILTER (
          WHERE status = 'active' AND current_amount_raw > 0
        )::text AS "fundedCount"
      FROM loyal_yield.user_yield_positions
      WHERE settings = ${scope.settings}
        AND vault_index = ${VAULT_INDEX}
        AND vault_pubkey = ${scope.vaultPubkey}
    `;
    if (
      projection.optInCount === 0 &&
      projection.policies.every((policy) => !policy.active) &&
      Number(position?.activeCount ?? "0") > 0 &&
      position?.fundedCount === "0"
    ) {
      isolated.push(scope.settings);
    }
  }
  if (isolated.length > 1) {
    throw new Error(
      `Multiple clean watched test Settings accounts remain: ${isolated.join(
        ", "
      )}. Set AUTOSWAP_E2E_SETTINGS_PDA explicitly.`
    );
  }
  return isolated[0] ?? null;
}

// The fallback validates several independent identity sources before mainnet use.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keep the safety checks together
async function resolveSettings(args: {
  appDatabase: ReturnType<typeof createDatabase> | null;
  connection: Connection;
  yieldDatabase: ReturnType<typeof createDatabase>;
  walletAddress: string;
}): Promise<string> {
  const explicit = process.env.AUTOSWAP_E2E_SETTINGS_PDA?.trim();
  if (explicit) {
    return new PublicKey(explicit).toBase58();
  }
  if (!args.appDatabase) {
    throw new Error(
      "DATABASE_URL is required when AUTOSWAP_E2E_SETTINGS_PDA is not explicit."
    );
  }
  const rows = await args.appDatabase<{ settings: string }[]>`
    SELECT DISTINCT mapped.settings
    FROM (
      SELECT smart_account_settings_pda AS settings
      FROM app_users
      WHERE subject_address = ${args.walletAddress}
      UNION
      SELECT app_user.smart_account_settings_pda AS settings
      FROM app_user_wallets wallet
      JOIN app_users app_user ON app_user.id = wallet.user_id
      WHERE wallet.wallet_address = ${args.walletAddress}
    ) mapped
    WHERE mapped.settings IS NOT NULL
  `;
  if (rows.length > 1) {
    throw new Error(
      "The testing wallet must resolve to exactly one Settings account in the app database."
    );
  }
  if (rows[0]?.settings) {
    return new PublicKey(rows[0].settings).toBase58();
  }

  const projectedSettings = await args.yieldDatabase<{ settings: string }[]>`
    SELECT DISTINCT mapped.settings
    FROM (
      SELECT settings
      FROM loyal_yield.cross_mint_swap_policies
      WHERE authority = ${args.walletAddress}
      UNION
      SELECT settings
      FROM loyal_yield.user_yield_positions
      WHERE wallet_address = ${args.walletAddress}
    ) mapped
  `;
  if (projectedSettings.length > 1) {
    const isolated = await chooseIsolatedSettings({
      candidates: projectedSettings.map((row) => row.settings),
      connection: args.connection,
      walletAddress: args.walletAddress,
      yieldDatabase: args.yieldDatabase,
    });
    if (isolated) {
      return isolated;
    }
    throw new Error(
      `Yield history has no unique clean watched Settings account for the testing wallet. Historical candidates: ${projectedSettings
        .map((row) => row.settings)
        .join(", ")}. Set AUTOSWAP_E2E_SETTINGS_PDA explicitly.`
    );
  }
  if (projectedSettings[0]?.settings) {
    return new PublicKey(projectedSettings[0].settings).toBase58();
  }

  const rpcRequest = (
    args.connection as Connection & {
      _rpcRequest?: (method: string, params: unknown[]) => Promise<unknown>;
    }
  )._rpcRequest?.bind(args.connection);
  if (!rpcRequest) {
    throw new Error(
      "The RPC connection cannot resolve the unmapped test Settings account."
    );
  }
  const matches: string[] = [];
  let paginationKey: string | null = null;
  do {
    const response = (await rpcRequest("getProgramAccountsV2", [
      PROGRAM_ID.toBase58(),
      {
        commitment: "confirmed",
        encoding: "base64",
        filters: [
          {
            memcmp: {
              bytes: bs58.encode(Buffer.from(settingsDiscriminator)),
              offset: 0,
            },
          },
        ],
        limit: 1000,
        ...(paginationKey ? { paginationKey } : {}),
      },
    ])) as {
      error?: { message?: string };
      result?: {
        accounts?: Array<{
          account: {
            data: [string, string];
            executable: boolean;
            lamports: number;
            owner: string;
            rentEpoch?: number;
          };
          pubkey: string;
        }>;
        paginationKey?: string | null;
        value?: {
          accounts?: Array<{
            account: {
              data: [string, string];
              executable: boolean;
              lamports: number;
              owner: string;
              rentEpoch?: number;
            };
            pubkey: string;
          }>;
          paginationKey?: string | null;
        };
      };
    };
    if (response.error) {
      throw new Error(
        response.error.message ?? "getProgramAccountsV2 Settings lookup failed."
      );
    }
    const page = response.result?.accounts
      ? response.result
      : response.result?.value;
    for (const entry of page?.accounts ?? []) {
      const [settings] = Settings.fromAccountInfo({
        data: Buffer.from(entry.account.data[0], "base64"),
        executable: entry.account.executable,
        lamports: entry.account.lamports,
        owner: new PublicKey(entry.account.owner),
        rentEpoch: entry.account.rentEpoch,
      });
      if (
        settings.signers.some(
          (signer) => signer.key.toBase58() === args.walletAddress
        )
      ) {
        matches.push(entry.pubkey);
      }
    }
    paginationKey = page?.paginationKey ?? null;
  } while (paginationKey);
  if (matches.length !== 1) {
    throw new Error(
      "The test key must sign exactly one Settings account; set AUTOSWAP_E2E_SETTINGS_PDA explicitly if it signs several."
    );
  }
  const [matchedSettings] = matches;
  if (!matchedSettings) {
    throw new Error("The Settings lookup unexpectedly returned no account.");
  }
  return new PublicKey(matchedSettings).toBase58();
}

async function fetchProjection(
  database: ReturnType<typeof createDatabase>,
  scope: Scope
): Promise<{ optInCount: number; policies: ProjectionRow[] }> {
  const policies = await database<ProjectionRow[]>`
    SELECT
      active,
      last_mutation AS "lastMutation",
      policy_account AS "policyAccount",
      policy_seed::text AS "policySeed",
      source_commitment AS "sourceCommitment",
      source_shard AS "sourceShard",
      start_eligible AS "startEligible"
    FROM loyal_yield.cross_mint_swap_policies
    WHERE cluster = ${CLUSTER}
      AND settings = ${scope.settings}
      AND authority = ${scope.walletAddress}
      AND vault_index = ${VAULT_INDEX}
      AND vault_pubkey = ${scope.vaultPubkey}
    ORDER BY policy_seed
  `;
  const [optIn] = await database<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM loyal_yield.cross_mint_vault_opt_ins
    WHERE cluster = ${CLUSTER}
      AND settings = ${scope.settings}
      AND vault_index = ${VAULT_INDEX}
      AND vault_pubkey = ${scope.vaultPubkey}
  `;
  return { optInCount: Number(optIn?.count ?? "0"), policies };
}

async function waitFor<T>(args: {
  describe: string;
  read: () => Promise<T>;
  ready: (value: T) => boolean;
}): Promise<T> {
  const deadline = Date.now() + PROJECTION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const value = await args.read();
    if (args.ready(value)) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for ${args.describe}.`);
}

function mergePolicy(
  policies: SmartAccountEarnCrossMintProjectedPolicyInput[],
  policy: SmartAccountEarnCrossMintProjectedPolicyInput
) {
  return [
    ...policies.filter(
      (existing) =>
        existing.sourceShard !== policy.sourceShard &&
        !existing.account.equals(policy.account)
    ),
    policy,
  ];
}

async function printExplicitIdentity(): Promise<void> {
  const explicitSettings = process.env.AUTOSWAP_E2E_SETTINGS_PDA?.trim();
  if (!explicitSettings) {
    throw new Error("--identity requires AUTOSWAP_E2E_SETTINGS_PDA.");
  }
  const wallet = loadKeypair("SOLANA_TESTING_PK");
  const rpcUrl =
    process.env.AUTOSWAP_E2E_RPC_URL?.trim() ||
    getSolanaEndpoints("mainnet").rpcEndpoint;
  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    fetch: getFrontendSolanaRpcFetch(),
  });
  const settingsPda = new PublicKey(explicitSettings);
  const account = await connection.getAccountInfo(settingsPda, "finalized");
  if (!account) {
    throw new Error("The explicit test Settings account does not exist.");
  }
  const settings = Settings.fromAccountInfo(account)[0];
  if (!settings.signers.some((signer) => signer.key.equals(wallet.publicKey))) {
    throw new Error(
      "SOLANA_TESTING_PK cannot sign the explicit Settings account."
    );
  }
  const vaultPubkey = pda.getSmartAccountPda({
    accountIndex: VAULT_INDEX,
    programId: PROGRAM_ID,
    settingsPda,
  })[0];
  console.log(
    JSON.stringify({
      settings: settingsPda.toBase58(),
      vaultPubkey: vaultPubkey.toBase58(),
      walletAddress: wallet.publicKey.toBase58(),
    })
  );
}

// Setup, projection, pause, deletion, and cleanup are linear E2E safety stages.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keeping them together makes the verifier auditable
async function main() {
  if ((process.env.NEXT_PUBLIC_SOLANA_ENV ?? "mainnet") !== "mainnet") {
    throw new Error("This verifier is mainnet-only.");
  }
  if (process.argv.includes("--identity")) {
    if (process.argv.includes("--execute")) {
      throw new Error("--identity and --execute cannot be combined.");
    }
    await printExplicitIdentity();
    return;
  }
  const execute = process.argv.includes("--execute");
  if (execute && process.env.AUTOSWAP_E2E_ACK !== EXECUTE_ACK) {
    throw new Error(`--execute requires AUTOSWAP_E2E_ACK=${EXECUTE_ACK}.`);
  }

  const productionYieldDatabaseUrl =
    requireRemoteDatabaseUrl("NEON_DATABASE_URL");
  if (
    databaseEndpointFingerprint(productionYieldDatabaseUrl) !==
    YIELD_DATABASE_ENDPOINT_SHA256
  ) {
    throw new Error(
      "NEON_DATABASE_URL is not the pinned production Yield database."
    );
  }
  const explicitSettings = process.env.AUTOSWAP_E2E_SETTINGS_PDA?.trim();
  const appDatabase = explicitSettings
    ? null
    : createDatabase(
        requireRemoteDatabaseUrl("DATABASE_URL"),
        "autoswap-mainnet-e2e-app-preflight"
      );
  const isolatedProjectionDatabaseUrl = requireIsolatedProjectionDatabaseUrl();
  if (execute && !isolatedProjectionDatabaseUrl) {
    throw new Error(
      "--execute requires AUTOSWAP_E2E_PROJECTION_DATABASE_URL pointing to disposable local PostgreSQL."
    );
  }
  const projectionMode = isolatedProjectionDatabaseUrl
    ? "isolated-laserstream"
    : "production-read-only";
  const yieldDatabase = createDatabase(
    isolatedProjectionDatabaseUrl ?? productionYieldDatabaseUrl,
    "autoswap-mainnet-e2e-projection"
  );
  const wallet = loadKeypair("SOLANA_TESTING_PK");
  const delegatedSigner = loadKeypair("DEPLOYMENT_PK").publicKey;
  const rpcUrl =
    process.env.AUTOSWAP_E2E_RPC_URL?.trim() ||
    getSolanaEndpoints("mainnet").rpcEndpoint;
  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    fetch: getFrontendSolanaRpcFetch(),
  });
  const vaults = createSmartAccountVaultsClient({
    connection,
    programId: PROGRAM_ID,
  });
  const timings: Record<string, number> = {};
  let projectedPolicies: SmartAccountEarnCrossMintProjectedPolicyInput[] = [];
  let primaryError: unknown = null;
  let verifiedSettingsPda: PublicKey | null = null;
  const startedAt = Date.now();

  try {
    const settings = await resolveSettings({
      appDatabase,
      connection,
      yieldDatabase,
      walletAddress: wallet.publicKey.toBase58(),
    });
    const settingsPda = new PublicKey(settings);
    verifiedSettingsPda = settingsPda;
    const vaultPubkey = pda.getSmartAccountPda({
      accountIndex: VAULT_INDEX,
      programId: PROGRAM_ID,
      settingsPda,
    })[0];
    const scope: Scope = {
      settings,
      vaultPubkey: vaultPubkey.toBase58(),
      walletAddress: wallet.publicKey.toBase58(),
    };
    const settingsAccount = await connection.getAccountInfo(
      settingsPda,
      "finalized"
    );
    if (!settingsAccount) {
      throw new Error("The test Settings account does not exist on mainnet.");
    }
    const settingsState = Settings.fromAccountInfo(settingsAccount)[0];
    if (
      !settingsState.signers.some((signer) =>
        signer.key.equals(wallet.publicKey)
      )
    ) {
      throw new Error(
        "SOLANA_TESTING_PK is not a signer on the test Settings account."
      );
    }
    if (
      (await connection.getBalance(wallet.publicKey, "finalized")) <
      MIN_FEE_BALANCE_LAMPORTS
    ) {
      throw new Error(
        "The isolated mainnet test wallet needs more SOL for fees and rent."
      );
    }
    const initialProjection = await fetchProjection(yieldDatabase, scope);
    const activePolicies = initialProjection.policies.filter(
      (policy) => policy.active
    );
    if (isolatedProjectionDatabaseUrl) {
      const [watchTarget] = await yieldDatabase<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM app_user_smart_accounts smart
        JOIN app_users app ON app.id = smart.user_id
        WHERE smart.solana_env = ${CLUSTER}
          AND smart.settings_pda = ${scope.settings}
          AND smart.state = 'ready'
          AND app.subject_address = ${scope.walletAddress}
      `;
      if (
        activePolicies.length !== 0 ||
        initialProjection.optInCount !== 0 ||
        watchTarget?.count !== "1"
      ) {
        throw new Error(
          `The isolated database must contain exactly one ready smart-account watch target and no Autoswap projection. Observed activePolicies=${activePolicies.length}, optIns=${initialProjection.optInCount}, watchTargets=${watchTarget?.count ?? "0"}.`
        );
      }
    } else {
      const [position] = await yieldDatabase<
        { activeCount: string; fundedCount: string }[]
      >`
        SELECT
          count(*) FILTER (WHERE status = 'active')::text AS "activeCount",
          count(*) FILTER (
            WHERE status = 'active' AND current_amount_raw > 0
          )::text AS "fundedCount"
        FROM loyal_yield.user_yield_positions
        WHERE settings = ${scope.settings}
          AND vault_index = ${VAULT_INDEX}
          AND vault_pubkey = ${scope.vaultPubkey}
      `;
      if (
        activePolicies.length !== 0 ||
        initialProjection.optInCount !== 0 ||
        Number(position?.activeCount ?? "0") === 0 ||
        position?.fundedCount !== "0"
      ) {
        throw new Error(
          `The production test account must be watched through an active zero-balance Earn position and have no active Autoswap state. Observed activePolicies=${activePolicies.length}, optIns=${initialProjection.optInCount}, activePositions=${position?.activeCount ?? "0"}, fundedPositions=${position?.fundedCount ?? "0"}.`
        );
      }
    }
    timings.preflightMs = Date.now() - startedAt;
    if (!execute) {
      console.log(
        JSON.stringify({
          mode: "preflight",
          projectionMode,
          stages: ["identity", "chain", "database", "isolation"],
          verdict: "READY",
        })
      );
      return;
    }

    const commonInput = {
      cluster: LoyalCluster.MainnetBeta,
      dailySourceMintSpendingCap: DAILY_CAP_RAW,
      feePayer: wallet.publicKey,
      maxSlippageBps: MAX_SLIPPAGE_BPS,
      settingsPda,
      signer: delegatedSigner,
      walletAddress: wallet.publicKey,
    };
    let prepareCalls = 0;
    try {
      await executeEarnAutoswapSetupClient({
        client: {
          prepareClosePoliciesSync: (input) =>
            vaults.prepareClosePoliciesSync(input),
          prepareEarnCrossMintSwapPolicies: (input) => {
            prepareCalls += 1;
            if (prepareCalls === 2) {
              throw new ExpectedInterruption(
                "simulated post-confirm read failure"
              );
            }
            return vaults.prepareEarnCrossMintSwapPolicies(input);
          },
        },
        input: commonInput,
        onPolicyConfirmed: (policy) => {
          projectedPolicies = mergePolicy(projectedPolicies, policy);
        },
        sendPrepared: (prepared) =>
          vaults.sdk.send(prepared, { confirm: true, signers: [wallet] }),
      });
      throw new Error("The interrupted setup unexpectedly completed.");
    } catch (error) {
      if (!(error instanceof ExpectedInterruption)) {
        throw error;
      }
    }
    if (projectedPolicies.length !== 1) {
      throw new Error(
        "Interrupted setup did not retain exactly one confirmed policy."
      );
    }
    timings.firstPolicyMs = Date.now() - startedAt;

    const resumed = await executeEarnAutoswapSetupClient({
      client: {
        prepareClosePoliciesSync: (input) =>
          vaults.prepareClosePoliciesSync(input),
        prepareEarnCrossMintSwapPolicies: (input) =>
          vaults.prepareEarnCrossMintSwapPolicies(input),
      },
      input: { ...commonInput, projectedPolicies },
      onPolicyConfirmed: (policy) => {
        projectedPolicies = mergePolicy(projectedPolicies, policy);
      },
      sendPrepared: (prepared) =>
        vaults.sdk.send(prepared, { confirm: true, signers: [wallet] }),
    });
    if (
      resumed.completedPolicies !== 2 ||
      new Set(projectedPolicies.map((policy) => policy.sourceShard)).size !== 2
    ) {
      throw new Error(
        "Autoswap retry did not complete exactly two policy shards."
      );
    }
    await waitFor({
      describe: "both confirmed policies to reach finalized chain state",
      read: () =>
        connection.getMultipleAccountsInfo(
          projectedPolicies.map((policy) => policy.account),
          "finalized"
        ),
      ready: (accounts) => accounts.every(Boolean),
    });
    timings.secondPolicyMs = Date.now() - startedAt;

    const projected = await waitFor({
      describe: "LaserStream to project the finalized policy pair and opt-in",
      read: () => fetchProjection(yieldDatabase, scope),
      ready: (value) => {
        const expectedAccounts = new Set(
          projectedPolicies.map((policy) => policy.account.toBase58())
        );
        const active = value.policies.filter(
          (policy) =>
            policy.active && expectedAccounts.has(policy.policyAccount)
        );
        return (
          value.optInCount === 1 &&
          active.length === 2 &&
          new Set(active.map((policy) => policy.sourceShard)).size === 2 &&
          active.every(
            (policy) =>
              policy.startEligible && policy.sourceCommitment === "finalized"
          ) &&
          value.policies.filter((policy) => policy.active).length === 2
        );
      },
    });
    if (projected.policies.filter((policy) => policy.active).length !== 2) {
      throw new Error(
        "LaserStream projected an unexpected active policy count."
      );
    }
    timings.projectionMs = Date.now() - startedAt;

    if (!isolatedProjectionDatabaseUrl) {
      throw new Error(
        "Backend pause verification is restricted to local PostgreSQL."
      );
    }
    const [paused] = await yieldDatabase<{ generation: string }[]>`
      UPDATE loyal_yield.cross_mint_vault_opt_ins
      SET enabled = FALSE,
          generation = generation + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE cluster = ${CLUSTER}
        AND settings = ${scope.settings}
        AND vault_index = ${VAULT_INDEX}
        AND vault_pubkey = ${scope.vaultPubkey}
        AND enabled
      RETURNING generation::text AS generation
    `;
    if (!paused) {
      throw new Error(
        "The backend-owned Autoswap pause transition did not apply before deletion."
      );
    }
    timings.backendPauseMs = Date.now() - startedAt;

    const preparedClose = await prepareEarnAutoswapDeletionClient({
      client: vaults,
      feePayer: wallet.publicKey,
      policies: projectedPolicies.map((policy) => policy.account),
      settingsPda,
      signer: wallet.publicKey,
    });
    if (!preparedClose) {
      throw new Error("Autoswap deletion did not prepare a transaction.");
    }
    await vaults.sdk.send(preparedClose, {
      confirm: true,
      signers: [wallet],
    });
    await waitFor({
      describe: "finalized policy account removal",
      read: () =>
        connection.getMultipleAccountsInfo(
          projectedPolicies.map((policy) => policy.account),
          "finalized"
        ),
      ready: (accounts) => accounts.every((account) => account === null),
    });
    await waitFor({
      describe: "LaserStream to reconcile policy removal and delete the opt-in",
      read: () => fetchProjection(yieldDatabase, scope),
      ready: (value) =>
        value.optInCount === 0 &&
        value.policies.filter((policy) => policy.active).length === 0 &&
        projectedPolicies.every((expected) =>
          value.policies.some(
            (policy) =>
              policy.policyAccount === expected.account.toBase58() &&
              !policy.active &&
              policy.lastMutation === "remove" &&
              policy.sourceCommitment === "finalized"
          )
        ),
    });
    projectedPolicies = [];
    timings.cleanupMs = Date.now() - startedAt;
    console.log(
      JSON.stringify({
        mode: "execute",
        stages: [
          "isolated-preflight",
          "interrupted-first-policy",
          "identity-preserving-retry",
          "laserstream-pair-projection",
          "backend-pause",
          "exact-policy-deletion",
          "laserstream-removal-reconciliation",
        ],
        projectionMode,
        timings,
        verdict: "PASS",
      })
    );
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      if (projectedPolicies.length > 0 && verifiedSettingsPda) {
        if (isolatedProjectionDatabaseUrl) {
          await yieldDatabase`
            UPDATE loyal_yield.cross_mint_vault_opt_ins
            SET enabled = FALSE,
                generation = generation + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE cluster = ${CLUSTER}
              AND settings = ${verifiedSettingsPda.toBase58()}
              AND vault_index = ${VAULT_INDEX}
              AND enabled
          `;
        }
        const existing = (
          await connection.getMultipleAccountsInfo(
            projectedPolicies.map((policy) => policy.account),
            "confirmed"
          )
        ).flatMap((account, index) => {
          const policy = projectedPolicies[index];
          return account && policy ? [policy.account] : [];
        });
        if (existing.length > 0) {
          const cleanup = await prepareEarnAutoswapDeletionClient({
            client: vaults,
            feePayer: wallet.publicKey,
            policies: existing,
            settingsPda: verifiedSettingsPda,
            signer: wallet.publicKey,
          });
          if (cleanup) {
            await vaults.sdk.send(cleanup, {
              confirm: true,
              signers: [wallet],
            });
            await waitFor({
              describe: "best-effort cleanup to finalize",
              read: () =>
                connection.getMultipleAccountsInfo(existing, "finalized"),
              ready: (accounts) =>
                accounts.every((account) => account === null),
            });
          }
        }
      }
    } catch {
      process.exitCode = 1;
      console.error(
        primaryError
          ? "Autoswap E2E cleanup also failed."
          : "Autoswap E2E cleanup failed."
      );
    } finally {
      await Promise.all(
        [appDatabase, yieldDatabase]
          .filter((database) => database !== null)
          .map((database) => database.end({ timeout: 5 }))
      );
    }
  }
}

await main();
