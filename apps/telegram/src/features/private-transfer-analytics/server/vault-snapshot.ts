import "server-only";

import { privateTransferVaultHoldings } from "@loyal-labs/db-core/schema";
import {
  calculateKaminoRedeemableLiquidityAmountRaw,
  fetchKaminoReserveSnapshot,
  getKaminoModifyBalanceAccountsForTokenMint,
  type KaminoReserveSnapshot,
  USDC_MINT_MAINNET,
} from "@loyal-labs/private-transactions";
import { lt, sql } from "drizzle-orm";

import { getDatabase } from "@/lib/core/database";

import type {
  PrivateTransferVaultHoldingRow,
  PrivateTransferVaultSnapshotStats,
} from "../types";
import { getPrivateMainnetConnection } from "./connection";
import {
  PRIVATE_TRANSFER_PROGRAM_ID,
  PRIVATE_TRANSFER_VAULT_ACCOUNT_SPACE,
  RPC_CONCURRENCY_LIMIT,
} from "./constants";
import { getTokenAccountsByOwner, mapWithConcurrency } from "./helius";
import { buildTokenCatalogUpserts, upsertTokenCatalog } from "./token-catalog";

type TokenAccountSnapshot = Awaited<
  ReturnType<typeof getTokenAccountsByOwner>
>[number];

const MAINNET_USDC_MINT = USDC_MINT_MAINNET.toBase58();
const KAMINO_USDC_ACCOUNTS =
  getKaminoModifyBalanceAccountsForTokenMint(USDC_MINT_MAINNET);
const KAMINO_USDC_COLLATERAL_MINT =
  KAMINO_USDC_ACCOUNTS?.reserveCollateralMint.toBase58() ?? null;

function normalizeVaultTokenAccounts(args: {
  kaminoUsdcReserveSnapshot: KaminoReserveSnapshot | null;
  tokenAccounts: TokenAccountSnapshot[];
  vaultAddress: string;
}): PrivateTransferVaultHoldingRow[] {
  const holdings: PrivateTransferVaultHoldingRow[] = [];
  let usdcAmountRaw = BigInt(0);
  let usdcTokenAccountAddress: string | null = null;
  let collateralSharesAmountRaw = BigInt(0);
  let collateralTokenAccountAddress: string | null = null;

  for (const tokenAccount of args.tokenAccounts) {
    const amountRaw = BigInt(tokenAccount.amountRaw);
    if (amountRaw <= BigInt(0)) {
      continue;
    }

    if (tokenAccount.mint === MAINNET_USDC_MINT) {
      usdcAmountRaw += amountRaw;
      usdcTokenAccountAddress ??= tokenAccount.address;
      continue;
    }

    if (
      KAMINO_USDC_COLLATERAL_MINT &&
      tokenAccount.mint === KAMINO_USDC_COLLATERAL_MINT
    ) {
      collateralSharesAmountRaw += amountRaw;
      collateralTokenAccountAddress ??= tokenAccount.address;
      continue;
    }

    holdings.push({
      amountRaw: tokenAccount.amountRaw,
      snapshotAt: new Date(),
      tokenAccountAddress: tokenAccount.address,
      tokenMint: tokenAccount.mint,
      vaultAddress: args.vaultAddress,
    });
  }

  if (usdcAmountRaw > BigInt(0) || collateralSharesAmountRaw > BigInt(0)) {
    if (
      collateralSharesAmountRaw > BigInt(0) &&
      !args.kaminoUsdcReserveSnapshot
    ) {
      throw new Error(
        "Kamino USDC reserve snapshot is required for cToken valuation"
      );
    }

    const redeemableUsdcAmountRaw = args.kaminoUsdcReserveSnapshot
      ? calculateKaminoRedeemableLiquidityAmountRaw(
          args.kaminoUsdcReserveSnapshot,
          collateralSharesAmountRaw
        )
      : BigInt(0);

    holdings.push({
      amountRaw: (usdcAmountRaw + redeemableUsdcAmountRaw).toString(),
      snapshotAt: new Date(),
      tokenAccountAddress:
        usdcTokenAccountAddress ??
        collateralTokenAccountAddress ??
        args.vaultAddress,
      tokenMint: MAINNET_USDC_MINT,
      vaultAddress: args.vaultAddress,
    });
  }

  return holdings;
}

async function loadCurrentVaultHoldings(): Promise<{
  holdings: PrivateTransferVaultHoldingRow[];
  vaultCount: number;
}> {
  const connection = getPrivateMainnetConnection();
  const kaminoUsdcReserveSnapshot = KAMINO_USDC_ACCOUNTS
    ? await fetchKaminoReserveSnapshot({
        connection,
        kaminoAccounts: KAMINO_USDC_ACCOUNTS,
        tokenMint: USDC_MINT_MAINNET,
      })
    : null;
  const vaultAccounts = await connection.getProgramAccounts(
    PRIVATE_TRANSFER_PROGRAM_ID,
    {
      commitment: "confirmed",
      filters: [{ dataSize: PRIVATE_TRANSFER_VAULT_ACCOUNT_SPACE }],
    }
  );

  const holdingsByVault = await mapWithConcurrency(
    vaultAccounts,
    RPC_CONCURRENCY_LIMIT,
    async (vaultAccount) => {
      const vaultAddress = vaultAccount.pubkey.toBase58();
      const tokenAccounts = await getTokenAccountsByOwner(vaultAddress);

      return normalizeVaultTokenAccounts({
        kaminoUsdcReserveSnapshot,
        tokenAccounts,
        vaultAddress,
      });
    }
  );

  return {
    holdings: holdingsByVault.flat(),
    vaultCount: vaultAccounts.length,
  };
}

export async function refreshPrivateTransferVaultSnapshot(): Promise<PrivateTransferVaultSnapshotStats> {
  const { holdings, vaultCount } = await loadCurrentVaultHoldings();
  const db = getDatabase();

  const snapshotAt = new Date();

  if (holdings.length > 0) {
    const taggedHoldings = holdings.map((h) => ({ ...h, snapshotAt }));
    await db
      .insert(privateTransferVaultHoldings)
      .values(taggedHoldings)
      .onConflictDoUpdate({
        target: privateTransferVaultHoldings.vaultAddress,
        set: {
          tokenAccountAddress: sql`excluded.token_account_address`,
          tokenMint: sql`excluded.token_mint`,
          amountRaw: sql`excluded.amount_raw`,
          snapshotAt: sql`excluded.snapshot_at`,
          updatedAt: sql`now()`,
        },
      });
    await db
      .delete(privateTransferVaultHoldings)
      .where(lt(privateTransferVaultHoldings.snapshotAt, snapshotAt));
  } else {
    await db.delete(privateTransferVaultHoldings);
  }

  const tokenCatalogEntries = await buildTokenCatalogUpserts(
    holdings.map((holding) => holding.tokenMint)
  );
  const tokenCatalogUpdated = await upsertTokenCatalog(tokenCatalogEntries);

  return {
    holdingsUpserted: holdings.length,
    tokenCatalogUpdated,
    vaultsDiscovered: vaultCount,
  };
}
