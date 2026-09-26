import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  type Connection,
  type PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";

import {
  depositVaultInstruction,
  readVoltrPosition,
  requestWithdrawVaultInstruction,
  VOLTR_ASSET_DECIMALS,
  VOLTR_ASSET_MINT,
  VOLTR_LP_MINT,
  voltrUserAccounts,
  withdrawVaultInstruction,
} from "./program";

/** `outer` is wallet-signed and runs first; `vault` runs as the index-2
 * smart-account vault inside one executeTransactionSyncV2. */
export type VoltrPlan = {
  outer: TransactionInstruction[];
  vault: TransactionInstruction[];
};

type PlanContext = { authority: PublicKey; owner: PublicKey };

// Receipt rent the vault PDA pays per request; claim refunds it. The program
// allocates 112 bytes (measured on mainnet), not the SDK's
// getRequestWithdrawVaultReceiptSize() of 106.
const RECEIPT_SPACE = 112;

export function voltrDepositPlan(
  { authority, owner }: PlanContext,
  amountRaw: bigint
): VoltrPlan {
  const user = voltrUserAccounts(authority);
  return {
    outer: [
      createAssociatedTokenAccountIdempotentInstruction(
        owner,
        user.assetAta,
        authority,
        VOLTR_ASSET_MINT
      ),
      createAssociatedTokenAccountIdempotentInstruction(
        owner,
        user.lpAta,
        authority,
        VOLTR_LP_MINT
      ),
      createTransferCheckedInstruction(
        getAssociatedTokenAddressSync(VOLTR_ASSET_MINT, owner),
        VOLTR_ASSET_MINT,
        user.assetAta,
        owner,
        amountRaw,
        VOLTR_ASSET_DECIMALS
      ),
    ],
    vault: [depositVaultInstruction(authority, amountRaw)],
  };
}

export async function voltrRequestWithdrawalPlan(
  connection: Connection,
  { authority, owner }: PlanContext,
  amountRaw: bigint | "max"
): Promise<VoltrPlan> {
  const position = await readVoltrPosition(connection, authority);
  if (position.withdrawal) {
    throw new Error("A withdrawal is already in progress.");
  }
  const withdrawAll = amountRaw === "max";
  // isWithdrawAll still rejects a zero amount (InvalidAmount), so pass the LP.
  const lp = withdrawAll ? position.lpRaw : position.assetsToLp(amountRaw);
  const amountLpRaw = lp < position.lpRaw ? lp : position.lpRaw;
  if (amountLpRaw <= BigInt(0)) {
    throw new Error("Nothing to withdraw.");
  }
  // The vault PDA pays the receipt rent and must stay rent-exempt itself.
  const [receipt, floor] = await Promise.all([
    connection.getMinimumBalanceForRentExemption(RECEIPT_SPACE),
    connection.getMinimumBalanceForRentExemption(0),
  ]);
  const needed = receipt + floor;
  const user = voltrUserAccounts(authority);
  return {
    outer: [
      // Voltr requires the escrow LP account (owned by the receipt PDA) to
      // exist before the request; it persists across requests.
      ...(position.escrowLpAtaExists
        ? []
        : [
            createAssociatedTokenAccountIdempotentInstruction(
              owner,
              user.escrowLpAta,
              user.receipt,
              VOLTR_LP_MINT
            ),
          ]),
      ...(position.authorityLamports >= needed
        ? []
        : [
            SystemProgram.transfer({
              fromPubkey: owner,
              lamports: needed - position.authorityLamports,
              toPubkey: authority,
            }),
          ]),
    ],
    vault: [
      requestWithdrawVaultInstruction({
        amountLpRaw,
        authority,
        payer: authority,
        withdrawAll,
      }),
    ],
  };
}

/** Claim into the vault PDA's USDC account, then sweep it to the wallet. */
export async function voltrClaimPlan(
  connection: Connection,
  { authority, owner }: PlanContext
): Promise<VoltrPlan> {
  const position = await readVoltrPosition(connection, authority);
  const pending = position.withdrawal;
  if (!pending || Date.now() / 1000 < pending.withdrawableFromTs) {
    throw new Error("Earn MAX withdrawal is not claimable yet.");
  }
  const walletAta = getAssociatedTokenAddressSync(VOLTR_ASSET_MINT, owner);
  // One raw unit of headroom absorbs program-side fixed-point rounding; any
  // dust stays in the vault account and rides the next sweep.
  const payout =
    pending.payoutRaw > BigInt(0) ? pending.payoutRaw - BigInt(1) : BigInt(0);
  return {
    outer: [
      createAssociatedTokenAccountIdempotentInstruction(
        owner,
        walletAta,
        owner,
        VOLTR_ASSET_MINT
      ),
    ],
    vault: [
      withdrawVaultInstruction(authority),
      createTransferCheckedInstruction(
        voltrUserAccounts(authority).assetAta,
        VOLTR_ASSET_MINT,
        walletAta,
        authority,
        position.assetRaw + payout,
        VOLTR_ASSET_DECIMALS
      ),
    ],
  };
}
