import {
  findDepositPda,
  LoyalPrivateTransactionsClient,
} from "@loyal-labs/private-transactions";
import { NATIVE_MINT } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

import { getSolanaEnv } from "../rpc/connection";
import { getWalletKeypair } from "../wallet/wallet-details";
import {
  recordKaminoUsdcShield,
  recordKaminoUsdcUnshield,
  resolveTrackedKaminoUsdcMint,
} from "./kamino-usdc-position";
import { getPrivateClient } from "./private-client";

export async function waitForAccount(
  client: LoyalPrivateTransactionsClient,
  pda: PublicKey,
  maxAttempts = 30
): Promise<void> {
  const connection = client.baseProgram.provider.connection;
  for (let i = 0; i < maxAttempts; i++) {
    const info = await connection.getAccountInfo(pda);
    if (info) return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

export function prettyStringify(obj: unknown): string {
  const json = JSON.stringify(
    obj,
    (_key, value) => {
      if (value instanceof PublicKey) return value.toBase58();
      if (typeof value === "bigint") return value.toString();
      return value;
    },
    2
  );
  // Collapse arrays onto single lines
  return json.replace(/\[\s+(\d[\d,\s]*\d)\s+\]/g, (_match, inner) => {
    const items = inner.split(/,\s*/).map((s: string) => s.trim());
    return `[${items.join(", ")}]`;
  });
}

type TransactionPlanExecutionResult = {
  signatures: { label: string; signature: string }[];
};

function getPlanTransactionSignature(
  result: TransactionPlanExecutionResult,
  expectedLabel: "shield" | "unshield"
): string {
  const primarySignature = result.signatures.find(
    ({ label }) => label === expectedLabel
  )?.signature;
  const fallbackSignature =
    result.signatures[result.signatures.length - 1]?.signature;
  const signature = primarySignature ?? fallbackSignature;

  if (!signature) {
    throw new Error(
      `Executed ${expectedLabel} transaction plan without a signature.`
    );
  }

  return signature;
}

async function getCurrentDepositAmount(params: {
  client: LoyalPrivateTransactionsClient;
  user: PublicKey;
  tokenMint: PublicKey;
}): Promise<bigint> {
  const { client, user, tokenMint } = params;
  const [ephemeralDeposit, baseDeposit] = await Promise.all([
    client.getEphemeralDeposit(user, tokenMint),
    client.getBaseDeposit(user, tokenMint),
  ]);

  return ephemeralDeposit?.amount ?? baseDeposit?.amount ?? BigInt(0);
}

/**
 * Subscribe to secure (Loyal deposit) balance changes for the user's
 * NATIVE_MINT deposit on the ephemeral connection.
 * Mirrors subscribeToWalletBalance but watches the deposit PDA.
 */
export const subscribeToSecureBalance = async (
  onChange: (lamports: number) => void
): Promise<() => Promise<void>> => {
  const keypair = await getWalletKeypair();
  const privateClient = await getPrivateClient();
  const [depositPda] = findDepositPda(keypair.publicKey, NATIVE_MINT);

  const connection = privateClient.ephemeralProgram.provider.connection;

  // Fetch initial value so we can deduplicate
  let lastAmount: number | undefined;
  try {
    const deposit = await privateClient.getEphemeralDeposit(
      keypair.publicKey,
      NATIVE_MINT
    );
    if (deposit) {
      lastAmount = Number(deposit.amount);
      onChange(lastAmount);
    }
  } catch (e) {
    console.warn("[subscribeToSecureBalance] initial fetch error:", e);
  }

  const subscriptionId = connection.onAccountChange(
    depositPda,
    async () => {
      try {
        const deposit = await privateClient.getEphemeralDeposit(
          keypair.publicKey,
          NATIVE_MINT
        );
        const amount = deposit ? Number(deposit.amount) : 0;
        if (typeof lastAmount === "number" && amount === lastAmount) {
          return;
        }
        lastAmount = amount;
        onChange(amount);
      } catch (error) {
        console.error("Failed to fetch secure balance on change", error);
      }
    },
    { commitment: "confirmed" }
  );

  return async () => {
    try {
      await connection.removeAccountChangeListener(subscriptionId);
    } catch (error) {
      console.error("Failed to remove secure balance subscription", error);
    }
  };
};

/**
 * Check which tokens have Loyal deposits. Returns a map of mint → deposit amount (raw).
 */
export async function fetchLoyalDeposits(
  userPublicKey: PublicKey,
  tokenMints: PublicKey[]
): Promise<Map<PublicKey, number>> {
  const privateClient = await getPrivateClient();
  const deposits = new Map<PublicKey, number>();

  const results = await Promise.allSettled(
    tokenMints.map(async (mint) => {
      const deposit = await privateClient.getEphemeralDeposit(
        userPublicKey,
        mint
      );
      if (deposit && deposit.amount > 0) {
        deposits.set(mint, Number(deposit.amount));
      }
    })
  );

  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("[loyal-deposits] Failed to check deposit:", result.reason);
    }
  }

  return deposits;
}

/**
 * Shield tokens: move from regular wallet into Loyal private deposit.
 * Flow: SDK transaction plan bundles initialize/modify/permission/delegate into one base transaction.
 */
export async function shieldTokens(params: {
  tokenMint: PublicKey;
  amount: number;
}): Promise<string> {
  const keypair = await getWalletKeypair();
  const client = await getPrivateClient();
  const { tokenMint, amount } = params;
  const solanaEnv = getSolanaEnv();
  const trackedKaminoMint = resolveTrackedKaminoUsdcMint(solanaEnv);
  const isTrackedKaminoToken = trackedKaminoMint === tokenMint.toBase58();

  const depositBeforeModify = isTrackedKaminoToken
    ? await getCurrentDepositAmount({
        client,
        user: keypair.publicKey,
        tokenMint,
      })
    : BigInt(0);

  const plan = await client.buildShieldTokensTransactionPlan({
    user: keypair.publicKey,
    payer: keypair.publicKey,
    tokenMint,
    amount: BigInt(amount),
  });
  const executionResult = await client.executeShieldTokensTransactionPlan({
    plan,
  });
  const signature = getPlanTransactionSignature(executionResult, "shield");

  const depositAfterModify = isTrackedKaminoToken
    ? await getCurrentDepositAmount({
        client,
        user: keypair.publicKey,
        tokenMint,
      })
    : BigInt(0);

  if (isTrackedKaminoToken) {
    const addedCollateralSharesAmountRaw =
      depositAfterModify - depositBeforeModify;

    if (addedCollateralSharesAmountRaw > BigInt(0)) {
      try {
        await recordKaminoUsdcShield({
          publicKey: keypair.publicKey.toBase58(),
          solanaEnv,
          addedPrincipalLiquidityAmountRaw: executionResult.amount,
          addedCollateralSharesAmountRaw,
        });
      } catch (error) {
        console.warn("Failed to persist Kamino USDC shield basis", error);
      }
    }
  }

  return signature;
}

/**
 * Unshield tokens: move from Loyal private deposit back to regular wallet.
 * Flow: SDK transaction plan bundles withdraw/native-SOL close/redelegate into one base transaction.
 */
export async function unshieldTokens(params: {
  tokenMint: PublicKey;
  amount: number;
}): Promise<string> {
  const startTime = Date.now();
  console.log("> unshieldTokens");

  const { tokenMint, amount } = params;
  const keypair = await getWalletKeypair();
  const client = await getPrivateClient();
  const solanaEnv = getSolanaEnv();
  const trackedKaminoMint = resolveTrackedKaminoUsdcMint(solanaEnv);
  const isTrackedKaminoToken = trackedKaminoMint === tokenMint.toBase58();

  let planAmount = BigInt(amount);
  let currentCollateralSharesAmountRaw: bigint | null = null;
  let currentLiquidityAmountRawBeforeUnshield: bigint | null = null;
  let redeemedLiquidityAmountRaw: bigint | null = null;
  if (isTrackedKaminoToken) {
    currentCollateralSharesAmountRaw = await getCurrentDepositAmount({
      client,
      user: keypair.publicKey,
      tokenMint,
    });

    const quotedCollateralSharesAmountRaw =
      await client.getKaminoCollateralSharesForLiquidityAmount({
        tokenMint,
        liquidityAmountRaw: BigInt(amount),
      });

    if (quotedCollateralSharesAmountRaw === null) {
      throw new Error(
        "Could not quote the current USDC shielded exchange rate. Please retry."
      );
    }
    planAmount = quotedCollateralSharesAmountRaw;

    if (
      currentCollateralSharesAmountRaw > BigInt(0) &&
      planAmount > currentCollateralSharesAmountRaw
    ) {
      planAmount = currentCollateralSharesAmountRaw;
    }

    if (currentCollateralSharesAmountRaw > BigInt(0)) {
      try {
        const [currentPositionQuote, redeemedLiquidityQuote] =
          await Promise.all([
            client.getKaminoShieldedBalanceQuote({
              tokenMint,
              collateralSharesAmountRaw: currentCollateralSharesAmountRaw,
            }),
            planAmount > BigInt(0)
              ? client.getKaminoShieldedBalanceQuote({
                  tokenMint,
                  collateralSharesAmountRaw: planAmount,
                })
              : Promise.resolve(null),
          ]);

        currentLiquidityAmountRawBeforeUnshield =
          currentPositionQuote?.redeemableLiquidityAmountRaw ?? null;
        redeemedLiquidityAmountRaw =
          redeemedLiquidityQuote?.redeemableLiquidityAmountRaw ?? null;
      } catch (error) {
        console.warn("Failed to quote Kamino USDC unshield earnings", error);
      }
    }
  }

  const plan = await client.buildUnshieldTokensTransactionPlan({
    user: keypair.publicKey,
    payer: keypair.publicKey,
    tokenMint,
    amount: planAmount,
  });
  const executionResult = await client.executeUnshieldTokensTransactionPlan({
    plan,
  });
  const signature = getPlanTransactionSignature(executionResult, "unshield");

  if (isTrackedKaminoToken) {
    const beforeShares = currentCollateralSharesAmountRaw ?? BigInt(0);
    const burnedCollateralSharesAmountRaw =
      planAmount > beforeShares ? beforeShares : planAmount;

    if (burnedCollateralSharesAmountRaw > BigInt(0)) {
      try {
        await recordKaminoUsdcUnshield({
          publicKey: keypair.publicKey.toBase58(),
          solanaEnv,
          actualCollateralSharesAmountRawBeforeUnshield: beforeShares,
          currentLiquidityAmountRawBeforeUnshield,
          burnedCollateralSharesAmountRaw,
          redeemedLiquidityAmountRaw,
        });
      } catch (error) {
        console.warn("Failed to persist Kamino USDC unshield basis", error);
      }
    }
  }

  console.log(`< unshieldTokens (${Date.now() - startTime}ms)`);

  return signature;
}
