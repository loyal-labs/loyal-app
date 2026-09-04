import "server-only";

import { and, eq } from "drizzle-orm";
import { appUserWallets } from "@loyal-labs/db-core/schema";

import { getPrivyClient } from "@/features/identity/server/privy-auth";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { getDatabase } from "@/lib/core/database";

/**
 * "Deposit from any chain" (ASK-2266): one Privy-provisioned 0x address per
 * embedded Solana wallet. Anything sent there (USDC/USDT/ETH on the chains
 * below) is bridged by Privy and lands as USDC in the user's Solana wallet.
 * App pays the bridge gas, so this is only offered to Privy-native wallets.
 */
export const EVM_DEPOSIT_CHAINS = [
  "ethereum",
  "base",
  "arbitrum",
  "polygon",
  "bsc", // Privy's alias for BNB Chain (eip155:56)
] as const;
export const EVM_DEPOSIT_ASSETS = ["usdc", "usdt", "eth"] as const;
// Ethereum L1 gas can spike to a few dollars per deposit; below this the
// bridge eats the deposit. L2s are ~$0.01, no floor there.
export const EVM_DEPOSIT_MIN_USD_ETHEREUM = 20;

// Privy rejects eth where it is not the native coin; everything else is
// accepted on every chain.
const NO_ETH_CHAINS = new Set<string>(["polygon", "bsc"]);
const SOURCE_ASSETS = EVM_DEPOSIT_CHAINS.flatMap((chain) =>
  EVM_DEPOSIT_ASSETS.filter(
    (asset) => !(asset === "eth" && NO_ETH_CHAINS.has(chain))
  ).map((asset) => ({ asset, chain }))
);

/**
 * The exact Privy request the user must sign in the browser (the wallet is
 * user-owned; with Privy as auth provider the server cannot mint a user key).
 * Client and server both build it from here so the signed bytes match.
 */
export function buildEvmDepositRequest(
  walletId: string,
  appId: string,
  /** Unix ms; must be identical when signing and when sending. */
  requestExpiry: number
) {
  return {
    version: 1 as const,
    method: "POST" as const,
    url: `https://api.privy.io/v1/wallets/${walletId}/deposit_accounts/crypto`,
    body: {
      type: "inline_route",
      source: { mode: "include", values: SOURCE_ASSETS },
      destination: { asset: "usdc", chain: "solana" },
    },
    headers: {
      "privy-app-id": appId,
      "privy-request-expiry": String(requestExpiry),
    },
  };
}

// Long enough for the user to approve in the Privy iframe.
export const EVM_DEPOSIT_SIGN_WINDOW_MS = 10 * 60 * 1000;

export async function resolveEmbeddedWalletId(walletAddress: string) {
  const privy = getPrivyClient();
  let wallet;
  try {
    wallet = await privy
      .wallets()
      .getWalletByAddress({ address: walletAddress });
  } catch {
    wallet = null;
  }
  if (!wallet || wallet.chain_type !== "solana") {
    throw new WalletAuthError(
      "Deposits from other chains need a Loyal-created wallet.",
      { code: "evm_deposit_external_wallet", status: 409 }
    );
  }
  return wallet.id;
}

export async function findEvmDepositAddress(args: {
  userId: string;
  walletAddress: string;
}) {
  const db = getDatabase();
  const row = await db.query.appUserWallets.findFirst({
    where: and(
      eq(appUserWallets.userId, args.userId),
      eq(appUserWallets.walletAddress, args.walletAddress)
    ),
    columns: { id: true, evmDepositAddress: true },
  });
  if (!row) {
    throw new WalletAuthError("Wallet is not attached to this user.", {
      code: "invalid_wallet_principal",
      status: 403,
    });
  }
  return row;
}

export async function createEvmDepositAddress(args: {
  rowId: string;
  walletId: string;
  appId: string;
  /** User's authorization signature over buildEvmDepositRequest(). */
  signature: string;
  requestExpiry: number;
}): Promise<string> {
  if (args.requestExpiry <= Date.now()) {
    throw new WalletAuthError("Signature expired, try again.", {
      code: "evm_deposit_signature_expired",
      status: 400,
    });
  }
  const privy = getPrivyClient();
  const req = buildEvmDepositRequest(
    args.walletId,
    args.appId,
    args.requestExpiry
  );
  // @privy-io/node@0.32 types predate the `asset`/`chain` aliases the API
  // and docs use (they want asset_address/caip2); the wire format is fine.
  const created = (await privy
    .wallets()
    .depositAccounts.crypto.create(args.walletId, {
      ...req.body,
      authorization_context: { signatures: [args.signature] },
      request_expiry: args.requestExpiry,
    } as unknown as Parameters<ReturnType<typeof privy.wallets>["depositAccounts"]["crypto"]["create"]>[1])) as unknown as {
    deposit_accounts?: { deposit_address: string }[];
    deposit_addresses?: { deposit_address: string }[];
  };
  const routes = created.deposit_accounts ?? created.deposit_addresses ?? [];
  const evm = routes.find((a) => a.deposit_address.startsWith("0x"));
  if (!evm) {
    throw new WalletAuthError("Privy returned no EVM deposit address.", {
      code: "evm_deposit_unavailable",
      status: 502,
    });
  }
  await getDatabase()
    .update(appUserWallets)
    .set({ evmDepositAddress: evm.deposit_address, updatedAt: new Date() })
    .where(eq(appUserWallets.id, args.rowId));
  return evm.deposit_address;
}
