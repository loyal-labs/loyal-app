import {
  DELEGATION_PROGRAM_ID,
  findDepositPda,
  getErValidatorForSolanaEnv,
  LoyalPrivateTransactionsClient,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
} from "@loyal-labs/private-transactions";
import {
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

import { getSolanaEnv, getWebsocketConnection } from "../rpc/connection";
import { getWalletKeypair } from "../wallet/wallet-details";
import {
  recordKaminoUsdcShield,
  recordKaminoUsdcUnshield,
  resolveTrackedKaminoUsdcMint,
} from "./kamino-usdc-position";
import { getPrivateClient } from "./private-client";
import { closeWsolAta, wrapSolToWSol } from "./wsol-utils";

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

async function warnIfDelegatedOnUnexpectedValidator(params: {
  client: LoyalPrivateTransactionsClient;
  depositPda: PublicKey;
  expectedValidator: PublicKey;
  flow: "shield" | "unshield";
}): Promise<void> {
  const { client, depositPda, expectedValidator, flow } = params;
  try {
    const delegationStatus = await client.getAccountDelegationStatus(depositPda);
    const authority = delegationStatus.result?.delegationRecord?.authority;
    if (authority && authority !== expectedValidator.toBase58()) {
      console.warn(
        `[${flow}] Deposit is delegated to unexpected validator.`,
        prettyStringify({
          deposit: depositPda,
          delegatedAuthority: authority,
          expectedAuthority: expectedValidator,
          note: "Unshield/undelegate on current PER endpoint can fail until account is undelegated from the current authority.",
        })
      );
    }
  } catch (error) {
    console.warn(
      `[${flow}] Failed to fetch delegation status before undelegate`,
      error
    );
  }
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
 * Flow: initializeDeposit (if needed) → modifyBalance(increase) → createPermission → delegateDeposit
 */
export async function shieldTokens(params: {
  tokenMint: PublicKey;
  amount: number;
}): Promise<string> {
  const startTime = Date.now();
  console.log("> shieldTokens");
  const keypair = await getWalletKeypair();
  const client = await getPrivateClient();
  const { tokenMint, amount } = params;
  const validator = getErValidatorForSolanaEnv(getSolanaEnv());

  // 1. Initialize deposit if it doesn't exist yet
  const existingDeposit = await client.getBaseDeposit(
    keypair.publicKey,
    tokenMint
  );
  if (!existingDeposit) {
    console.log("initializeDeposit");
    const initializeDepositSig = await client.initializeDeposit({
      tokenMint,
      user: keypair.publicKey,
      payer: keypair.publicKey,
    });
    console.log("initializeDeposit sig", initializeDepositSig);
    const [depositPda] = findDepositPda(keypair.publicKey, tokenMint);
    await waitForAccount(client, depositPda);
  }

  // 2. Wrap native SOL → wSOL if needed
  const isNativeSol = tokenMint.equals(NATIVE_MINT);
  const connection = getWebsocketConnection();
  let createdAta = false;

  if (isNativeSol) {
    console.log("wrapSolToWSol");
    const result = await wrapSolToWSol({
      connection,
      payer: keypair,
      lamports: amount,
    });
    console.log("wrapSolToWSol wsolAta: ", result.wsolAta.toString());
    createdAta = result.createdAta;
  }

  const userTokenAccount = getAssociatedTokenAddressSync(
    tokenMint,
    keypair.publicKey,
    false,
    TOKEN_PROGRAM_ID
  );
  console.log("userTokenAccount", userTokenAccount.toString());

  // 3. Undelegate if currently delegated (modifyBalance requires base layer ownership)
  const [depositPda] = findDepositPda(keypair.publicKey, tokenMint);
  const depositAccountInfo =
    await client.baseProgram.provider.connection.getAccountInfo(depositPda);
  if (depositAccountInfo?.owner.equals(DELEGATION_PROGRAM_ID)) {
    await warnIfDelegatedOnUnexpectedValidator({
      client,
      depositPda,
      expectedValidator: validator,
      flow: "shield",
    });
    console.log("undelegateDeposit (deposit is delegated, undelegating first)");
    const undelegateSig = await client.undelegateDeposit({
      tokenMint,
      user: keypair.publicKey,
      payer: keypair.publicKey,
      magicProgram: MAGIC_PROGRAM_ID,
      magicContext: MAGIC_CONTEXT_ID,
    });
    console.log("undelegateDeposit sig", undelegateSig);
  }

  const depositBeforeModify = await client.getBaseDeposit(
    keypair.publicKey,
    tokenMint
  );

  // 4. Move tokens into the deposit vault
  console.log("modifyBalance");
  const { deposit, signature } = await client.modifyBalance({
    tokenMint,
    amount,
    increase: true,
    user: keypair.publicKey,
    payer: keypair.publicKey,
    userTokenAccount,
  });
  console.log("modifyBalance sig", signature);

  const trackedKaminoMint = resolveTrackedKaminoUsdcMint(getSolanaEnv());
  if (trackedKaminoMint === tokenMint.toBase58()) {
    const beforeShares = depositBeforeModify?.amount ?? BigInt(0);
    const addedCollateralSharesAmountRaw = deposit.amount - beforeShares;

    if (addedCollateralSharesAmountRaw > BigInt(0)) {
      try {
        await recordKaminoUsdcShield({
          publicKey: keypair.publicKey.toBase58(),
          solanaEnv: getSolanaEnv(),
          addedPrincipalLiquidityAmountRaw: BigInt(amount),
          addedCollateralSharesAmountRaw,
        });
      } catch (error) {
        console.warn("Failed to persist Kamino USDC shield basis", error);
      }
    }
  }

  // Close temporary wSOL ATA if we created it
  if (isNativeSol && createdAta) {
    console.log("closeWsolAta");
    await closeWsolAta({
      connection,
      payer: keypair,
      wsolAta: userTokenAccount,
    });
    console.log("closeWsolAta done");
  }

  // 5. Create permission (may already exist)
  try {
    console.log("createPermission");
    const createPermissionSig = await client.createPermission({
      tokenMint,
      user: keypair.publicKey,
      payer: keypair.publicKey,
    });
    console.log("createPermission sig", createPermissionSig);
  } catch {
    // Permission may already exist, that's fine
  }

  // 6. Delegate deposit to PER
  try {
    console.log("delegateDeposit");
    const delegateDepositSig = await client.delegateDeposit({
      tokenMint,
      user: keypair.publicKey,
      payer: keypair.publicKey,
      validator,
    });
    console.log("delegateDeposit sig", delegateDepositSig);
  } catch {
    // May already be delegated
  }

  console.log(`< shieldTokens (${Date.now() - startTime}ms)`);

  return signature;
}

/**
 * Unshield tokens: move from Loyal private deposit back to regular wallet.
 * Flow: undelegateDeposit (from PER to base layer) → modifyBalance(decrease) → unwrap wSOL if native → re-delegate remaining
 */
export async function unshieldTokens(params: {
  tokenMint: PublicKey;
  amount: number;
}): Promise<string> {
  const startTime = Date.now();
  console.log("> unshieldTokens");

  const { tokenMint, amount } = params;
  const validator = getErValidatorForSolanaEnv(getSolanaEnv());

  const keypair = await getWalletKeypair();
  const client = await getPrivateClient();
  const connection = getWebsocketConnection();
  const solanaEnv = getSolanaEnv();
  const trackedKaminoMint = resolveTrackedKaminoUsdcMint(solanaEnv);
  const isTrackedKaminoToken = trackedKaminoMint === tokenMint.toBase58();

  // 1. Undelegate from PER if currently delegated (waits for owner to be PROGRAM_ID on both connections)
  const [depositPda] = findDepositPda(keypair.publicKey, tokenMint);
  const depositAccountInfo =
    await client.baseProgram.provider.connection.getAccountInfo(depositPda);
  if (depositAccountInfo?.owner.equals(DELEGATION_PROGRAM_ID)) {
    await warnIfDelegatedOnUnexpectedValidator({
      client,
      depositPda,
      expectedValidator: validator,
      flow: "unshield",
    });
    console.log("undelegateDeposit");
    const undelegateDepositSig = await client.undelegateDeposit({
      tokenMint,
      user: keypair.publicKey,
      payer: keypair.publicKey,
      magicProgram: MAGIC_PROGRAM_ID,
      magicContext: MAGIC_CONTEXT_ID,
    });
    console.log("undelegateDeposit sig", undelegateDepositSig);
  } else {
    console.log("undelegateDeposit: deposit is not delegated, skipping");
  }

  // 2. Withdraw tokens back to regular wallet
  const isNativeSol = tokenMint.equals(NATIVE_MINT);

  // Ensure wSOL ATA exists for native SOL withdrawals
  if (isNativeSol) {
    await wrapSolToWSol({ connection, payer: keypair, lamports: 0 });
  }
  // FIXME(zotho): ensure ATA exist for any token mints

  const userTokenAccount = getAssociatedTokenAddressSync(
    tokenMint,
    keypair.publicKey,
    false,
    TOKEN_PROGRAM_ID
  );

  const depositBeforeModify = await client.getBaseDeposit(
    keypair.publicKey,
    tokenMint
  );
  const currentCollateralSharesAmountRaw = depositBeforeModify?.amount ?? BigInt(0);

  let modifyAmount = BigInt(amount);
  let currentLiquidityAmountRawBeforeUnshield: bigint | null = null;
  let redeemedLiquidityAmountRaw: bigint | null = null;
  if (isTrackedKaminoToken) {
    const quotedCollateralSharesAmountRaw =
      await client.getKaminoCollateralSharesForLiquidityAmount({
        tokenMint,
        liquidityAmountRaw: BigInt(amount),
      });

    if (quotedCollateralSharesAmountRaw !== null) {
      modifyAmount = quotedCollateralSharesAmountRaw;
    }

    const currentCollateralSharesAmountRaw =
      depositBeforeModify?.amount ?? BigInt(0);
    if (
      currentCollateralSharesAmountRaw > BigInt(0) &&
      modifyAmount > currentCollateralSharesAmountRaw
    ) {
      modifyAmount = currentCollateralSharesAmountRaw;
    }

    if (currentCollateralSharesAmountRaw > BigInt(0)) {
      try {
        const [currentPositionQuote, redeemedLiquidityQuote] = await Promise.all([
          client.getKaminoShieldedBalanceQuote({
            tokenMint,
            collateralSharesAmountRaw: currentCollateralSharesAmountRaw,
          }),
          modifyAmount > BigInt(0)
            ? client.getKaminoShieldedBalanceQuote({
                tokenMint,
                collateralSharesAmountRaw: modifyAmount,
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

  console.log("modifyBalance");
  const { deposit, signature } = await client.modifyBalance({
    tokenMint,
    amount: modifyAmount,
    increase: false,
    user: keypair.publicKey,
    payer: keypair.publicKey,
    userTokenAccount,
  });
  console.log("modifyBalance sig", signature);

  if (isTrackedKaminoToken) {
    const beforeShares = currentCollateralSharesAmountRaw;
    const burnedCollateralSharesAmountRaw = beforeShares - deposit.amount;

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

  // 3. Unwrap wSOL back to native SOL
  if (isNativeSol) {
    console.log("closeWsolAta");
    await closeWsolAta({
      connection,
      payer: keypair,
      wsolAta: userTokenAccount,
    });
    console.log("closeWsolAta done");
  }

  // 4. Re-delegate if there are remaining tokens in the deposit
  const remainingDeposit = await client.getBaseDeposit(
    keypair.publicKey,
    tokenMint
  );
  if (remainingDeposit && remainingDeposit.amount > BigInt(0)) {
    console.log(
      `delegateDeposit (remaining balance: ${remainingDeposit.amount.toString()})`
    );
    const delegateDepositSig = await client.delegateDeposit({
      tokenMint,
      user: keypair.publicKey,
      payer: keypair.publicKey,
      validator,
    });
    console.log("delegateDeposit sig", delegateDepositSig);
  }

  console.log(`< unshieldTokens (${Date.now() - startTime}ms)`);

  return signature;
}
