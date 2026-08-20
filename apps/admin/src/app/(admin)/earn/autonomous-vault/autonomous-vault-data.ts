import "server-only";

import DLMM, {
  createProgram,
  getPriceOfBinByBinId,
  wrapPosition,
} from "@meteora-ag/dlmm";
import {
  calculateKaminoRedeemableLiquidityAmountRaw,
  parseKaminoObligationAccount,
  parseKaminoReserveSnapshot,
  parseKaminoReserveTokenAccounts,
} from "@loyal-labs/smart-account-vaults";
import {
  AccountLayout,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  AccountInfo,
  Connection,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";

import { serverEnv } from "@/lib/core/config/server";

const DEFAULT_MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com";
const MANIFEST = {
  kaminoLendProgram: new PublicKey(
    "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
  ),
  kaminoMarket: new PublicKey("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF"),
  kaminoObligation: new PublicKey(
    "4HhTdUm6Z1GLTjW9bvv3B9X5tHedJC8zHwdGtvu3yqKU"
  ),
  kaminoReserve: new PublicKey("D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59"),
  loyalMint: new PublicKey("LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta"),
  meteoraPool: new PublicKey("c29DVknA5DZUCH6U5ujo1EGfiKKXZrUk6yk56yJxLrm"),
  meteoraPosition: new PublicKey(
    "3SBxJxpCG2EbfLrvD5DgjKUarLgn5i643WYNnUdTYgCB"
  ),
  usdcMint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  vault: new PublicKey("F7zuL14omw4JJfS1cvsWXVb3wh48dvsonMJgoc9tYu3e"),
} as const;

export type AutonomousVaultData =
  | {
      available: false;
      error: string;
      observedAt: string;
    }
  | {
      available: true;
      deployedUsdcRaw: bigint;
      idle: {
        loyalRaw: bigint;
        usdcRaw: bigint;
      };
      kamino: {
        reserve: string;
        valueUsdcRaw: bigint;
      };
      meteora: {
        activeBin: number;
        loyalRaw: bigint;
        position: string;
        priceUsdcPerLoyal: number;
        usdcRaw: bigint;
      };
      observedAt: string;
      observedSlot: number;
      status: "attention" | "healthy";
      totalLoyalRaw: bigint;
      totalUsdcRaw: bigint;
      vault: string;
    };

function requireAccount(
  account: AccountInfo<Buffer> | null,
  label: string,
  owner: PublicKey
) {
  if (!account) {
    throw new Error(`${label} is missing from finalized mainnet state.`);
  }
  if (!account.owner.equals(owner)) {
    throw new Error(`${label} has an unexpected program owner.`);
  }

  return account;
}

function readTokenAmount(
  account: AccountInfo<Buffer> | null,
  label: string,
  mint: PublicKey
) {
  const tokenAccount = requireAccount(account, label, TOKEN_PROGRAM_ID);
  const decoded = AccountLayout.decode(tokenAccount.data);
  if (!decoded.owner.equals(MANIFEST.vault) || !decoded.mint.equals(mint)) {
    throw new Error(`${label} does not match the autonomous vault manifest.`);
  }

  return BigInt(decoded.amount.toString());
}

function parseReferencePrice(value: string) {
  const price = Number.parseFloat(value);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Meteora returned an invalid active-bin price.");
  }

  return price;
}

function bigintFromSdk(value: { toString(): string } | string) {
  return BigInt(value.toString());
}

function getFundedRange(
  bins: Array<{
    binId: number;
    positionLiquidity: string;
    positionXAmount: string;
    positionYAmount: string;
  }>
) {
  const funded = bins.filter(
    (bin) =>
      BigInt(bin.positionLiquidity) > BigInt(0) ||
      BigInt(bin.positionXAmount) > BigInt(0) ||
      BigInt(bin.positionYAmount) > BigInt(0)
  );
  if (funded.length === 0) {
    return null;
  }

  return {
    max: Math.max(...funded.map((bin) => bin.binId)),
    min: Math.min(...funded.map((bin) => bin.binId)),
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The finalized mainnet snapshot could not be loaded.";
}

async function loadAutonomousVaultData(): Promise<AutonomousVaultData> {
  const observedAt = new Date().toISOString();

  try {
    const connection = new Connection(
      serverEnv.solanaMainnetRpcUrl ?? DEFAULT_MAINNET_RPC_URL,
      { commitment: "finalized" }
    );
    const vaultUsdc = getAssociatedTokenAddressSync(
      MANIFEST.usdcMint,
      MANIFEST.vault,
      true
    );
    const vaultLoyal = getAssociatedTokenAddressSync(
      MANIFEST.loyalMint,
      MANIFEST.vault,
      true
    );

    const kaminoAccountsPromise = connection.getMultipleAccountsInfoAndContext(
      [
        MANIFEST.kaminoObligation,
        MANIFEST.kaminoReserve,
        vaultUsdc,
        vaultLoyal,
        MANIFEST.meteoraPosition,
      ],
      { commitment: "finalized" }
    );
    const dlmmPromise = DLMM.create(connection, MANIFEST.meteoraPool);
    const kaminoAccounts = await kaminoAccountsPromise;
    const positionAccount = kaminoAccounts.value[4] ?? null;
    if (!positionAccount) {
      throw new Error(
        "Meteora position is missing from finalized mainnet state."
      );
    }

    // Decode the already-fetched position to derive its bin-array coverage.
    // This starts the only position-specific batch while DLMM.create is still
    // fetching the pool's reserve and mint accounts.
    const positionProgram = createProgram(connection);
    const decodedPosition = wrapPosition(
      positionProgram,
      MANIFEST.meteoraPosition,
      positionAccount
    );
    const positionAccountKeys = [
      SYSVAR_CLOCK_PUBKEY,
      ...decodedPosition.getBinArrayKeysCoverage(positionProgram.programId),
    ];
    const positionAccountsPromise = connection.getMultipleAccountsInfo(
      positionAccountKeys,
      { commitment: "finalized" }
    );
    const [dlmm, positionAccounts] = await Promise.all([
      dlmmPromise,
      positionAccountsPromise,
    ]);
    const obligationAccount = requireAccount(
      kaminoAccounts.value[0] ?? null,
      "Kamino obligation",
      MANIFEST.kaminoLendProgram
    );
    const reserveAccount = requireAccount(
      kaminoAccounts.value[1] ?? null,
      "Kamino reserve",
      MANIFEST.kaminoLendProgram
    );
    const idleUsdcRaw = readTokenAmount(
      kaminoAccounts.value[2] ?? null,
      "Vault USDC account",
      MANIFEST.usdcMint
    );
    const idleLoyalRaw = readTokenAmount(
      kaminoAccounts.value[3] ?? null,
      "Vault LOYAL account",
      MANIFEST.loyalMint
    );

    const obligation = parseKaminoObligationAccount(obligationAccount.data);
    if (
      !obligation.owner.equals(MANIFEST.vault) ||
      !obligation.lendingMarket.equals(MANIFEST.kaminoMarket)
    ) {
      throw new Error("Kamino obligation identity differs from the manifest.");
    }
    const reserveAccounts = parseKaminoReserveTokenAccounts(
      reserveAccount.data
    );
    if (
      !reserveAccounts.lendingMarket.equals(MANIFEST.kaminoMarket) ||
      !reserveAccounts.reserveLiquidityMint.equals(MANIFEST.usdcMint)
    ) {
      throw new Error("Kamino reserve graph differs from the manifest.");
    }
    const kaminoDeposit = obligation.deposits.find((deposit) =>
      deposit.reserve.equals(MANIFEST.kaminoReserve)
    );
    if (!kaminoDeposit || kaminoDeposit.depositedAmountRaw <= BigInt(0)) {
      throw new Error("Kamino has no funded autonomous-vault position.");
    }
    const kaminoValueUsdcRaw = calculateKaminoRedeemableLiquidityAmountRaw({
      collateralAmountRaw: kaminoDeposit.depositedAmountRaw,
      snapshot: parseKaminoReserveSnapshot(reserveAccount.data),
    });

    if (
      !dlmm.lbPair.tokenXMint.equals(MANIFEST.loyalMint) ||
      !dlmm.lbPair.tokenYMint.equals(MANIFEST.usdcMint)
    ) {
      throw new Error("Meteora pool mints differ from the manifest.");
    }
    requireAccount(positionAccount, "Meteora position", dlmm.program.programId);
    const originalGetAccountInfo = connection.getAccountInfo;
    const originalGetAccountInfoBound = originalGetAccountInfo.bind(connection);
    const originalGetMultipleAccountsInfo = connection.getMultipleAccountsInfo;
    const originalGetMultipleAccountsInfoBound =
      originalGetMultipleAccountsInfo.bind(connection);
    connection.getAccountInfo = (async (...args) => {
      const [publicKey] = args;
      if (publicKey.equals(MANIFEST.meteoraPosition)) {
        return positionAccount;
      }
      return originalGetAccountInfoBound(...args);
    }) as typeof connection.getAccountInfo;
    connection.getMultipleAccountsInfo = (async (...args) => {
      const [publicKeys] = args;
      const isPositionAccountsRead =
        publicKeys.length === positionAccountKeys.length &&
        publicKeys.every((publicKey, index) =>
          publicKey.equals(positionAccountKeys[index]!)
        );
      if (isPositionAccountsRead) {
        return positionAccounts;
      }
      return originalGetMultipleAccountsInfoBound(...args);
    }) as typeof connection.getMultipleAccountsInfo;

    let position;
    try {
      position = await dlmm.getPosition(MANIFEST.meteoraPosition);
    } finally {
      connection.getAccountInfo = originalGetAccountInfo;
      connection.getMultipleAccountsInfo = originalGetMultipleAccountsInfo;
    }
    if (!position.positionData.owner.equals(MANIFEST.vault)) {
      throw new Error("Meteora position is not owned by the autonomous vault.");
    }
    // DLMM.create already fetched the finalized pool account. Reuse its active
    // bin instead of fetching the same pool and bin-array accounts again.
    const activeBinId = dlmm.lbPair.activeId;
    const priceUsdcPerLoyal = parseReferencePrice(
      dlmm.fromPricePerLamport(
        getPriceOfBinByBinId(activeBinId, dlmm.lbPair.binStep).toNumber()
      )
    );
    const feesLoyalRaw = bigintFromSdk(position.positionData.feeX);
    const feesUsdcRaw = bigintFromSdk(position.positionData.feeY);
    const meteoraLoyalRaw =
      BigInt(position.positionData.totalXAmount) + feesLoyalRaw;
    const meteoraUsdcRaw =
      BigInt(position.positionData.totalYAmount) + feesUsdcRaw;
    const fundedRange = getFundedRange(position.positionData.positionBinData);
    const inFundedRange =
      fundedRange !== null &&
      activeBinId >= fundedRange.min &&
      activeBinId <= fundedRange.max;
    const poolEnabled = Number(dlmm.lbPair.status) === 0;
    const snapshotSlot = kaminoAccounts.context.slot;
    const deployedUsdcRaw = kaminoValueUsdcRaw + meteoraUsdcRaw;

    return {
      available: true,
      deployedUsdcRaw,
      idle: {
        loyalRaw: idleLoyalRaw,
        usdcRaw: idleUsdcRaw,
      },
      kamino: {
        reserve: MANIFEST.kaminoReserve.toBase58(),
        valueUsdcRaw: kaminoValueUsdcRaw,
      },
      meteora: {
        activeBin: activeBinId,
        loyalRaw: meteoraLoyalRaw,
        position: MANIFEST.meteoraPosition.toBase58(),
        priceUsdcPerLoyal,
        usdcRaw: meteoraUsdcRaw,
      },
      observedAt,
      observedSlot: snapshotSlot,
      status: poolEnabled && inFundedRange ? "healthy" : "attention",
      totalLoyalRaw: meteoraLoyalRaw + idleLoyalRaw,
      totalUsdcRaw: deployedUsdcRaw + idleUsdcRaw,
      vault: MANIFEST.vault.toBase58(),
    };
  } catch (error) {
    return {
      available: false,
      error: errorMessage(error),
      observedAt,
    };
  }
}

export async function getAutonomousVaultData() {
  return loadAutonomousVaultData();
}
