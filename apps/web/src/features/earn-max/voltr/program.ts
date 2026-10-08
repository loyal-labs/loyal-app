import { pda } from "@loyal-labs/loyal-smart-accounts";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  type Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { Buffer } from "buffer";

// Earn MAX (Voltr): the smart account deposits USDC into one pooled Voltr
// vault; a worker runs the RWA loop inside the vault. Instructions are
// hand-encoded because the Voltr SDK needs @solana/kit 6 (apps/web uses 8).
// Layouts come from @voltr/vault-sdk src/generated (vault.ts,
// requestWithdrawVaultReceipt.ts, instructions/*).

export const VOLTR_PROGRAM_ID = new PublicKey(
  "vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8"
);
export const VOLTR_VAULT = new PublicKey(
  "HXtk15EA5pBg3rSKxBm8sWPExScPkTknSRp37fXNHgNA"
);
export const VOLTR_ASSET_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);
export const VOLTR_ASSET_DECIMALS = 6;
/** Smart-account vault index for Earn MAX (Earn uses 1, legacy Earn MAX 0). */
export const EARN_MAX_VOLTR_ACCOUNT_INDEX = 2;

function voltrPda(...seeds: Buffer[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, VOLTR_PROGRAM_ID)[0];
}

const vaultSeed = VOLTR_VAULT.toBuffer();
export const VOLTR_PROTOCOL = voltrPda(Buffer.from("protocol"));
export const VOLTR_IDLE_AUTH = voltrPda(
  Buffer.from("vault_asset_idle_auth"),
  vaultSeed
);
export const VOLTR_LP_MINT = voltrPda(Buffer.from("vault_lp_mint"), vaultSeed);
export const VOLTR_LP_MINT_AUTH = voltrPda(
  Buffer.from("vault_lp_mint_auth"),
  vaultSeed
);
export const VOLTR_IDLE_ATA = getAssociatedTokenAddressSync(
  VOLTR_ASSET_MINT,
  VOLTR_IDLE_AUTH,
  true
);

export function deriveEarnMaxVoltrAuthority(
  settingsPda: PublicKey | string,
  smartAccountProgramId: PublicKey | string
): PublicKey {
  return pda.getSmartAccountPda({
    accountIndex: EARN_MAX_VOLTR_ACCOUNT_INDEX,
    programId: new PublicKey(smartAccountProgramId),
    settingsPda: new PublicKey(settingsPda),
  })[0];
}

/** Accounts owned by one userTransferAuthority (the smart-account vault). */
export function voltrUserAccounts(authority: PublicKey) {
  const receipt = voltrPda(
    Buffer.from("request_withdraw_vault_receipt"),
    vaultSeed,
    authority.toBuffer()
  );
  return {
    assetAta: getAssociatedTokenAddressSync(VOLTR_ASSET_MINT, authority, true),
    escrowLpAta: getAssociatedTokenAddressSync(VOLTR_LP_MINT, receipt, true),
    lpAta: getAssociatedTokenAddressSync(VOLTR_LP_MINT, authority, true),
    receipt,
  };
}

type Meta = [pubkey: PublicKey, isSigner: boolean, isWritable: boolean];

function voltrInstruction(
  discriminator: readonly number[],
  args: Buffer,
  metas: Meta[]
): TransactionInstruction {
  return new TransactionInstruction({
    data: Buffer.concat([Buffer.from(discriminator), args]),
    keys: metas.map(([pubkey, isSigner, isWritable]) => ({
      isSigner,
      isWritable,
      pubkey,
    })),
    programId: VOLTR_PROGRAM_ID,
  });
}

function u64(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value);
  return buffer;
}

export function depositVaultInstruction(
  authority: PublicKey,
  amountRaw: bigint
): TransactionInstruction {
  const user = voltrUserAccounts(authority);
  return voltrInstruction(
    [126, 224, 21, 255, 228, 53, 117, 33],
    u64(amountRaw),
    [
      // The SDK marks this read-only; writable is a harmless superset that the
      // smart-account sync compiler needs (it wants one writable signer).
      [authority, true, true],
      [VOLTR_PROTOCOL, false, false],
      [VOLTR_VAULT, false, true],
      [VOLTR_ASSET_MINT, false, false],
      [VOLTR_LP_MINT, false, true],
      [user.assetAta, false, true],
      [VOLTR_IDLE_ATA, false, true],
      [VOLTR_IDLE_AUTH, false, false],
      [user.lpAta, false, true],
      [VOLTR_LP_MINT_AUTH, false, false],
      [TOKEN_PROGRAM_ID, false, false],
      [TOKEN_PROGRAM_ID, false, false],
      [SystemProgram.programId, false, false],
    ]
  );
}

/** Escrows `amountLpRaw` LP (or all LP) and opens the one pending receipt. */
export function requestWithdrawVaultInstruction(args: {
  amountLpRaw: bigint;
  authority: PublicKey;
  payer: PublicKey;
  withdrawAll: boolean;
}): TransactionInstruction {
  const user = voltrUserAccounts(args.authority);
  return voltrInstruction(
    [248, 225, 47, 22, 116, 144, 23, 143],
    Buffer.concat([
      u64(args.amountLpRaw),
      // isAmountInLp = true, the only mode our callers and Voltr tooling use.
      Buffer.from([1, args.withdrawAll ? 1 : 0]),
    ]),
    [
      [args.payer, true, true],
      [args.authority, true, false],
      [VOLTR_PROTOCOL, false, false],
      [VOLTR_VAULT, false, false],
      [VOLTR_LP_MINT, false, false],
      [user.lpAta, false, true],
      [user.escrowLpAta, false, true],
      [user.receipt, false, true],
      [TOKEN_PROGRAM_ID, false, false],
      [SystemProgram.programId, false, false],
    ]
  );
}

/** Claim: burns the escrowed LP and pays USDC to the authority's ATA. */
export function withdrawVaultInstruction(
  authority: PublicKey
): TransactionInstruction {
  const user = voltrUserAccounts(authority);
  return voltrInstruction([135, 7, 237, 120, 149, 94, 95, 7], Buffer.alloc(0), [
    [authority, true, true],
    [VOLTR_PROTOCOL, false, false],
    [VOLTR_VAULT, false, true],
    [VOLTR_ASSET_MINT, false, false],
    [VOLTR_LP_MINT, false, true],
    [user.escrowLpAta, false, true],
    [VOLTR_IDLE_ATA, false, true],
    [VOLTR_IDLE_AUTH, false, true],
    [user.assetAta, false, true],
    [user.receipt, false, true],
    [TOKEN_PROGRAM_ID, false, false],
    [TOKEN_PROGRAM_ID, false, false],
    [SystemProgram.programId, false, false],
  ]);
}

const BPS = BigInt(10_000);
const readU64 = (data: Buffer, offset: number) => data.readBigUInt64LE(offset);
const readU16 = (data: Buffer, offset: number) =>
  BigInt(data.readUInt16LE(offset));

export type VoltrPosition = {
  /** USDC already sitting in the smart-account vault's USDC ATA. */
  assetRaw: bigint;
  /** Smart-account vault lamports (rent payer for withdrawal requests). */
  authorityLamports: number;
  escrowLpAtaExists: boolean;
  /** Free LP in the smart-account vault's LP ATA. */
  lpRaw: bigint;
  /** USDC raw the free LP redeems for right now. */
  valueRaw: bigint;
  withdrawal: {
    escrowedLpRaw: bigint;
    /** Program pays min(request-time quote, present value) at claim. */
    payoutRaw: bigint;
    withdrawableFromTs: number;
  } | null;
  /** LP to escrow for `assetRaw` USDC, rounded down. */
  assetsToLp: (assetRaw: bigint) => bigint;
};

/** One getMultipleAccountsInfo snapshot of an authority's Voltr position. */
export async function readVoltrPosition(
  connection: Connection,
  authority: PublicKey
): Promise<VoltrPosition> {
  const user = voltrUserAccounts(authority);
  const [vault, lpMint, assetAta, lpAta, receipt, escrow, authorityAccount] =
    await connection.getMultipleAccountsInfo([
      VOLTR_VAULT,
      VOLTR_LP_MINT,
      user.assetAta,
      user.lpAta,
      user.receipt,
      user.escrowLpAta,
      authority,
    ]);
  if (!(vault && lpMint)) {
    throw new Error("Voltr vault is not available on this cluster.");
  }
  const v = vault.data;
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  // Locked profit decays linearly from lastReport over the degradation window.
  const lockedDuration = readU64(v, 448);
  const lockedAmount = readU64(v, 672);
  const sinceReport = nowSec - readU64(v, 680);
  const lockedProfit =
    lockedDuration === BigInt(0) || sinceReport >= lockedDuration
      ? BigInt(0)
      : sinceReport <= BigInt(0)
      ? lockedAmount
      : (lockedAmount * (lockedDuration - sinceReport)) / lockedDuration;
  const unlockedValue = readU64(v, 168) - lockedProfit;
  const redemptionKeepBps = BPS - readU16(v, 520);
  // ponytail: unrealised management-fee LP is ignored (fees are 0 on this
  // vault); add the SDK's calculateUnrealisedLpFees if a fee is ever set.
  const totalLp =
    lpMint.data.readBigUInt64LE(36) +
    readU64(v, 576) +
    readU64(v, 584) +
    readU64(v, 592) +
    readU64(v, 616);
  const lpToAssets = (lp: bigint) =>
    totalLp === BigInt(0)
      ? BigInt(0)
      : (lp * unlockedValue * redemptionKeepBps) / (totalLp * BPS);
  const lpRaw = lpAta ? lpAta.data.readBigUInt64LE(64) : BigInt(0);
  let withdrawal: VoltrPosition["withdrawal"] = null;
  if (receipt) {
    const r = receipt.data;
    const escrowedLpRaw = readU64(r, 72);
    // amountAssetToWithdrawDecimalBits is U80F48 in raw asset units.
    const atRequest =
      (readU64(r, 80) | (readU64(r, 88) << BigInt(64))) >> BigInt(48);
    const atPresent = lpToAssets(escrowedLpRaw);
    withdrawal = {
      escrowedLpRaw,
      payoutRaw: atPresent < atRequest ? atPresent : atRequest,
      withdrawableFromTs: Number(readU64(r, 96)),
    };
  }
  return {
    assetRaw: assetAta ? assetAta.data.readBigUInt64LE(64) : BigInt(0),
    assetsToLp: (assetRaw) =>
      unlockedValue <= BigInt(0)
        ? BigInt(0)
        : (assetRaw * totalLp * BPS) / (unlockedValue * redemptionKeepBps),
    authorityLamports: authorityAccount?.lamports ?? 0,
    escrowLpAtaExists: escrow !== null,
    lpRaw,
    valueRaw: lpToAssets(lpRaw),
    withdrawal,
  };
}
