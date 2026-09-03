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
] as const;
export const EVM_DEPOSIT_ASSETS = ["usdc", "usdt", "eth"] as const;
// Ethereum L1 gas can spike to a few dollars per deposit; below this the
// bridge eats the deposit. L2s are ~$0.01, no floor there.
export const EVM_DEPOSIT_MIN_USD_ETHEREUM = 20;

// Privy rejects eth on polygon; everything else is accepted on every chain.
const SOURCE_ASSETS = EVM_DEPOSIT_CHAINS.flatMap((chain) =>
  EVM_DEPOSIT_ASSETS.filter(
    (asset) => !(asset === "eth" && chain === "polygon")
  ).map((asset) => ({ asset, chain }))
);

export async function getOrCreateEvmDepositAddress(args: {
  userId: string;
  walletAddress: string;
  /** Privy access token of the signed-in user; the wallet is user-owned so
   *  Privy needs their signature to attach a deposit route to it. */
  privyAccessToken: string;
}): Promise<string> {
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
  if (row.evmDepositAddress) return row.evmDepositAddress;

  const privy = getPrivyClient();
  let wallet;
  try {
    wallet = await privy
      .wallets()
      .getWalletByAddress({ address: args.walletAddress });
  } catch {
    wallet = null;
  }
  if (!wallet || wallet.chain_type !== "solana") {
    throw new WalletAuthError(
      "Deposits from other chains need a Loyal-created wallet.",
      { code: "evm_deposit_external_wallet", status: 409 }
    );
  }

  // @privy-io/node@0.32 types predate the `asset`/`chain` aliases the API
  // and docs use (they want asset_address/caip2); the wire format is fine.
  const created = (await privy
    .wallets()
    .depositAccounts.crypto.create(wallet.id, {
      type: "inline_route",
      source: { mode: "include", values: SOURCE_ASSETS },
      destination: { asset: "usdc", chain: "solana" },
      authorization_context: { user_jwts: [args.privyAccessToken] },
      idempotency_key: `evm-deposit:${wallet.id}`,
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

  await db
    .update(appUserWallets)
    .set({ evmDepositAddress: evm.deposit_address, updatedAt: new Date() })
    .where(eq(appUserWallets.id, row.id));
  return evm.deposit_address;
}
