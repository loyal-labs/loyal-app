import "server-only";

import { Connection, PublicKey } from "@solana/web3.js";

import { serverEnv } from "@/lib/core/config/server";

import type { RoutingKeyBalance } from "./routing-balance-alert.server";

// Dedicated cached connection for the routing-balance cron, mirroring the other
// server crons so we don't explode the connection count per function instance.
let cachedConnection: Connection | null = null;

function getRoutingBalanceConnection(): Connection {
  if (cachedConnection) return cachedConnection;
  cachedConnection = new Connection(serverEnv.privateMainnetRpcUrl, {
    commitment: "confirmed",
  });
  return cachedConnection;
}

export type RoutingBalanceReadFailure = {
  errorMessage: string;
  publicKey: string;
};

export type RoutingBalanceReadResult = {
  balances: RoutingKeyBalance[];
  failures: RoutingBalanceReadFailure[];
};

/**
 * Reads each configured routing key's SOL balance. A key whose read fails is
 * reported as a failure and left out of `balances`, so the watchdog neither
 * alerts on it nor disturbs its remembered bucket.
 */
export async function readRoutingKeyBalances(
  publicKeys: string[] = serverEnv.solanaRoutingAlertPublicKeys
): Promise<RoutingBalanceReadResult> {
  const connection = getRoutingBalanceConnection();
  const balances: RoutingKeyBalance[] = [];
  const failures: RoutingBalanceReadFailure[] = [];

  // Settled rather than all-or-nothing so one unreadable key cannot blind the
  // watchdog for the other two.
  const results = await Promise.allSettled(
    publicKeys.map(async (publicKey) =>
      connection.getBalance(new PublicKey(publicKey))
    )
  );

  results.forEach((result, index) => {
    const publicKey = publicKeys[index] as string;
    if (result.status === "fulfilled") {
      balances.push({ lamports: BigInt(result.value), publicKey });
      return;
    }

    const error: unknown = result.reason;
    failures.push({
      errorMessage: error instanceof Error ? error.message : String(error),
      publicKey,
    });
  });

  return { balances, failures };
}
