/**
 * ASK-2000 — reproduce and verify the fix for
 * `RangeError: encoding overruns Uint8Array` in `earn.withdrawal` prepare.
 *
 * The error is thrown locally by `MessageV0.serialize()`, which encodes into a
 * fixed `new Uint8Array(PACKET_DATA_SIZE)` (1232 bytes). Any compiled Earn
 * full-exit message larger than that overruns the buffer before the RPC is
 * ever called.
 *
 * This script drives the real production prepare path
 * (`createSmartAccountVaultsClient().prepareEarnUsdcWithdraw`) against live
 * mainnet state for a given wallet, and measures every v0 message the SDK
 * compiles on the way. It is strictly read-only: `prepareEarnUsdcWithdraw`
 * only builds and simulates (`sigVerify: false`), nothing is signed or sent,
 * and the DB is only ever SELECTed.
 *
 * Usage (from /frontend):
 *   bun --env-file=.env.local scripts/verify-earn-withdraw-tx-size.ts --wallet <address>
 *   bun --env-file=.env.local scripts/verify-earn-withdraw-tx-size.ts --all
 *
 * Requires NEXT_PUBLIC_SOLANA_RPC_ENDPOINT and NEON_DATABASE_URL.
 */
import { LoyalCluster } from "@loyal-labs/actions";
import { PROGRAM_ID } from "@loyal-labs/loyal-smart-accounts-core";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import { neon } from "@neondatabase/serverless";
import {
  Connection,
  PublicKey,
  VersionedTransaction,
  type MessageV0,
} from "@solana/web3.js";

import {
  deriveEarnVaultPda,
  fetchEarnRpcHoldingsSnapshot,
  type EarnRpcHolding,
} from "@/lib/yield-optimization/earn-rpc-holdings.client";

// web3.js PACKET_DATA_SIZE — the buffer MessageV0.serialize() encodes into.
const PACKET_DATA_SIZE = 1232;

// Wallets observed failing in ClickStack between 2026-07-31 and 2026-08-04.
const KNOWN_AFFECTED_WALLETS = [
  "3zy7sRsejWYX55dcKxxWW3cA734Q3W1RJg26LWRr967J",
  "7uDkTSN6G78v1VDiSmpw77Ck5YbceF2RqeA7GvDERk8B",
  "CZ3yFSVMDoFeiNusPfaqBGsAr6BibGbLSF6FG2u2zdAP",
  "4yH9RgtvACVnpLtcVATXJA5LXGHuDJ3BUam2adXWt4kk",
];

// `neon(url)` narrows to NeonQueryFunction<false, false>; ReturnType<typeof neon>
// widens both flags to boolean and will not accept the concrete client.
type NeonSql = ReturnType<typeof neon<false, false>>;

type RoutePolicyRow = {
  policy_account: string;
  policy_seed: string;
  settings: string;
  vault_index: number;
  vault_pubkey: string;
  delegated_signers: string[];
  kamino_markets: string[];
  kamino_liquidity_mints: string[];
  stable_mints: string[];
  route_modes: string[];
  universe_preset: string | null;
  risk_profile: string | null;
};

function shortVecLength(value: number): number {
  let remaining = value;
  let bytes = 1;
  while (remaining >= 0x80) {
    remaining >>= 7;
    bytes += 1;
  }
  return bytes;
}

/**
 * Byte length of a compiled v0 message, computed the same way
 * `MessageV0.serialize()` lays it out. Calling `.serialize()` directly is not
 * an option here: that is exactly the call that throws once the message is
 * oversized, so it cannot report how far over the limit we are.
 */
function measureMessageV0(message: MessageV0): number {
  let length = 1 + 3; // version prefix + header
  length += shortVecLength(message.staticAccountKeys.length);
  length += 32 * message.staticAccountKeys.length;
  length += 32; // recentBlockhash

  length += shortVecLength(message.compiledInstructions.length);
  for (const instruction of message.compiledInstructions) {
    length += 1; // programIdIndex
    length += shortVecLength(instruction.accountKeyIndexes.length);
    length += instruction.accountKeyIndexes.length;
    length += shortVecLength(instruction.data.length);
    length += instruction.data.length;
  }

  length += shortVecLength(message.addressTableLookups.length);
  for (const lookup of message.addressTableLookups) {
    length += 32; // table account key
    length += shortVecLength(lookup.writableIndexes.length);
    length += lookup.writableIndexes.length;
    length += shortVecLength(lookup.readonlyIndexes.length);
    length += lookup.readonlyIndexes.length;
  }

  return length;
}

type MeasuredMessage = {
  bytes: number;
  staticKeys: number;
  instructions: number;
  lookupTables: number;
};

/**
 * Wraps a Connection so every transaction the SDK hands to
 * `simulateTransaction` is measured before web3.js tries to serialize it.
 * The underlying call is still delegated, so the prepare path behaves exactly
 * as it does in production.
 */
function instrumentConnection(connection: Connection): {
  connection: Connection;
  measured: MeasuredMessage[];
} {
  const measured: MeasuredMessage[] = [];
  const original = connection.simulateTransaction.bind(connection);

  const proxy = new Proxy(connection, {
    get(target, property, receiver) {
      if (property !== "simulateTransaction") {
        return Reflect.get(target, property, receiver);
      }
      return (transaction: unknown, ...rest: unknown[]) => {
        if (transaction instanceof VersionedTransaction) {
          const message = transaction.message as MessageV0;
          measured.push({
            bytes: measureMessageV0(message),
            staticKeys: message.staticAccountKeys.length,
            instructions: message.compiledInstructions.length,
            lookupTables: message.addressTableLookups.length,
          });
        }
        return (original as (...args: unknown[]) => unknown)(
          transaction,
          ...rest
        );
      };
    },
  });

  return { connection: proxy, measured };
}

// Mirrors `snapshotFullWithdrawalTargets` in
// frontend/src/lib/yield-optimization/earn-withdraw-input-resolution.server.ts
// — the full-exit fan-out the mobile prepare-context endpoint sends to the SDK.
function snapshotFullWithdrawalTargets(holdings: EarnRpcHolding[]) {
  const targets = [];
  for (const holding of holdings) {
    if (holding.kind !== "kamino" || !holding.reserve || !holding.market) {
      continue;
    }
    let amountRaw: bigint;
    try {
      amountRaw = BigInt(holding.amountRaw);
    } catch {
      continue;
    }
    if (amountRaw <= BigInt(0)) {
      continue;
    }
    const reserveCollateralMint = holding.provenance?.reserveCollateralMint;
    targets.push({
      amountRaw,
      liquidityMint: new PublicKey(holding.liquidityMint),
      market: new PublicKey(holding.market),
      reserve: new PublicKey(holding.reserve),
      ...(reserveCollateralMint
        ? { reserveCollateralMint: new PublicKey(reserveCollateralMint) }
        : {}),
      supplyApyBps: holding.supplyApyBps ? BigInt(holding.supplyApyBps) : null,
    });
  }
  return targets;
}

async function loadRoutePolicyPair(
  sql: NeonSql,
  wallet: string
): Promise<{ route: RoutePolicyRow; setup: RoutePolicyRow | null }> {
  const rows = (await sql`
    SELECT policy_account, policy_seed, settings, vault_index, vault_pubkey,
           delegated_signers, kamino_markets, kamino_liquidity_mints,
           stable_mints, route_modes, universe_preset, risk_profile
    FROM loyal_yield.route_policies
    WHERE authority = ${wallet} AND active = TRUE
    ORDER BY policy_seed
  `) as unknown as RoutePolicyRow[];

  const route = rows.find((row) =>
    row.route_modes.includes("same_mint_kamino")
  );
  if (!route) {
    throw new Error(`no active same_mint_kamino route policy for ${wallet}`);
  }
  const setup =
    rows.find((row) => row.route_modes.includes("kamino_init_obligation")) ??
    null;
  return { route, setup };
}

async function verifyWallet(args: {
  wallet: string;
  sql: NeonSql;
  rpcEndpoint: string;
}): Promise<{ wallet: string; ok: boolean; detail: string }> {
  const { wallet, sql, rpcEndpoint } = args;
  const { route, setup } = await loadRoutePolicyPair(sql, wallet);
  const settingsPda = new PublicKey(route.settings);
  const vaultPda = deriveEarnVaultPda({ programId: PROGRAM_ID, settingsPda });
  const walletKey = new PublicKey(wallet);
  const policySigner = new PublicKey(route.delegated_signers[0]!);

  const baseConnection = new Connection(rpcEndpoint, "confirmed");
  const policyMetadata = {
    account: route.policy_account,
    delegatedSigners: route.delegated_signers,
    kaminoLiquidityMints: route.kamino_liquidity_mints,
    kaminoMarkets: route.kamino_markets,
    riskProfile: route.risk_profile,
    routeModes: route.route_modes,
    seed: route.policy_seed,
    setupPolicy: setup
      ? {
          account: setup.policy_account,
          delegatedSigners: setup.delegated_signers,
          seed: setup.policy_seed,
        }
      : null,
    stableMints: route.stable_mints,
    universePreset: route.universe_preset,
    vaultIndex: route.vault_index,
    vaultPubkey: vaultPda.toBase58(),
  };

  const snapshot = await fetchEarnRpcHoldingsSnapshot({
    cluster: LoyalCluster.MainnetBeta,
    connection: baseConnection,
    policy: policyMetadata,
    programId: PROGRAM_ID,
    settingsPda,
  });

  const fullWithdrawalTargets = snapshotFullWithdrawalTargets(
    snapshot.holdings
  );
  const kaminoHoldings = snapshot.holdings.filter(
    (holding) => holding.kind === "kamino"
  );

  console.log(`\n=== ${wallet} ===`);
  console.log(`  settings   ${route.settings}`);
  console.log(`  vault      ${vaultPda.toBase58()}`);
  console.log(`  total      ${snapshot.currentTotalAmountRaw} (raw USDC)`);
  console.log(
    `  holdings   ${snapshot.holdings.length} (${kaminoHoldings.length} kamino)`
  );
  for (const holding of snapshot.holdings) {
    console.log(
      `    - ${holding.kind.padEnd(6)} ${holding.marketName.padEnd(
        20
      )} ${holding.amountRaw.padStart(12)}`
    );
  }

  if (fullWithdrawalTargets.length === 0) {
    return {
      wallet,
      ok: true,
      detail: "no kamino holdings — nothing to reproduce",
    };
  }

  const largest = fullWithdrawalTargets.reduce((best, target) =>
    target.amountRaw > best.amountRaw ? target : best
  );
  const totalAmountRaw = fullWithdrawalTargets.reduce(
    (total, target) => total + target.amountRaw,
    BigInt(0)
  );

  const { connection, measured } = instrumentConnection(baseConnection);
  const client = createSmartAccountVaultsClient({
    connection,
    programId: PROGRAM_ID,
  });

  let failure: Error | null = null;
  try {
    await client.prepareEarnUsdcWithdraw({
      amountRaw: totalAmountRaw,
      cluster: LoyalCluster.MainnetBeta,
      // Mobile prepares the full exit and closes policies in a later phase.
      closePoliciesOnFullWithdrawal: false,
      feePayer: walletKey,
      fullWithdrawalTargets,
      mode: "full",
      policySigner,
      settingsPda,
      source: {
        amountRaw: largest.amountRaw,
        id: `${largest.market.toBase58()}:${largest.reserve.toBase58()}`,
        liquidityMint: largest.liquidityMint,
        market: largest.market,
        reserve: largest.reserve,
        type: "reserve" as const,
      },
      target: largest,
      walletAddress: walletKey,
      yieldRoutingPolicy: {
        account: new PublicKey(route.policy_account),
        seed: BigInt(route.policy_seed),
        setupPolicy: setup
          ? {
              account: new PublicKey(setup.policy_account),
              seed: BigInt(setup.policy_seed),
            }
          : null,
      },
    });
  } catch (error) {
    failure = error as Error;
  }

  const maxBytes = measured.reduce(
    (max, entry) => Math.max(max, entry.bytes),
    0
  );
  console.log(`  targets    ${fullWithdrawalTargets.length}`);
  console.log(`  simulated messages: ${measured.length}`);
  for (const [index, entry] of measured.entries()) {
    const verdict = entry.bytes > PACKET_DATA_SIZE ? "OVER" : "ok";
    console.log(
      `    [${index}] ${String(entry.bytes).padStart(5)} bytes  ` +
        `keys=${String(entry.staticKeys).padStart(3)}  ` +
        `ix=${String(entry.instructions).padStart(2)}  ` +
        `alts=${entry.lookupTables}  ${verdict} (limit ${PACKET_DATA_SIZE})`
    );
  }

  const overran =
    failure instanceof RangeError &&
    /encoding overruns Uint8Array/.test(failure.message);

  if (overran) {
    return {
      wallet,
      ok: false,
      detail: `REPRODUCED overrun — largest message ${maxBytes} bytes (limit ${PACKET_DATA_SIZE}, over by ${
        maxBytes - PACKET_DATA_SIZE
      })`,
    };
  }
  if (failure) {
    return {
      wallet,
      ok: false,
      detail: `prepare failed for an unrelated reason: ${failure.name}: ${failure.message}`,
    };
  }
  return {
    wallet,
    ok: true,
    detail: `prepare succeeded — largest message ${maxBytes} bytes (limit ${PACKET_DATA_SIZE}, headroom ${
      PACKET_DATA_SIZE - maxBytes
    })`,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const walletArgIndex = argv.indexOf("--wallet");
  const wallets =
    walletArgIndex >= 0 && argv[walletArgIndex + 1]
      ? [argv[walletArgIndex + 1]!]
      : argv.includes("--all")
      ? KNOWN_AFFECTED_WALLETS
      : null;

  if (!wallets) {
    console.error(
      "usage: verify-earn-withdraw-tx-size.ts (--wallet <address> | --all)"
    );
    process.exit(2);
  }

  const rpcEndpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_ENDPOINT;
  if (!rpcEndpoint) {
    throw new Error("NEXT_PUBLIC_SOLANA_RPC_ENDPOINT is required");
  }
  // `loyal_yield` lives in the yield Neon project, which the app reads through
  // NEON_DATABASE_URL — see YIELD_OPTIMIZATION_DATABASE_URL_ENV_NAME in
  // frontend/src/lib/yield-optimization/yield-neon-client.server.ts. DATABASE_URL
  // points at the app database and does not carry the route_policies table.
  const databaseUrl = process.env.NEON_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("NEON_DATABASE_URL is required");
  }
  const sql = neon(databaseUrl);

  console.log(`programId ${PROGRAM_ID.toBase58()}`);
  console.log(`packet limit ${PACKET_DATA_SIZE} bytes`);

  const results = [];
  for (const wallet of wallets) {
    try {
      results.push(await verifyWallet({ wallet, sql, rpcEndpoint }));
    } catch (error) {
      results.push({
        wallet,
        ok: false,
        detail: `setup failed: ${(error as Error).message}`,
      });
    }
  }

  console.log("\n=== summary ===");
  for (const result of results) {
    console.log(
      `  ${result.ok ? "PASS" : "FAIL"}  ${result.wallet}  ${result.detail}`
    );
  }

  process.exit(results.every((result) => result.ok) ? 0 : 1);
}

void main();
