import { PublicKey } from "@solana/web3.js";

import { getConnection } from "../rpc/connection";
import type { TokenHolding } from "./types";

const PROGRAM_ID = new PublicKey("97FzQdWi26mFNR21AbQNg4KqofiCLqQydQfAvRQMcXhV");
const DEPOSIT_SEED = Buffer.from("deposit_v2");

function findDepositPda(user: PublicKey, tokenMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [DEPOSIT_SEED, user.toBuffer(), tokenMint.toBuffer()],
    PROGRAM_ID,
  );
}

/** Deposit account layout: 8-byte discriminator + 32 user + 32 tokenMint + 8 amount (u64 LE) */
const DEPOSIT_AMOUNT_OFFSET = 72;

function readDepositAmount(data: Buffer): bigint {
  if (data.length < DEPOSIT_AMOUNT_OFFSET + 8) return BigInt(0);
  let value = BigInt(0);
  for (let i = 0; i < 8; i++) {
    value += BigInt(data[DEPOSIT_AMOUNT_OFFSET + i]) << BigInt(i * 8);
  }
  return value;
}

/**
 * Fetch shielded balances for all token mints the user holds.
 * Returns TokenHolding[] with isSecured=true for any mint with a non-zero deposit.
 */
export async function fetchSecuredBalances(
  owner: string,
  holdings: TokenHolding[],
): Promise<TokenHolding[]> {
  const connection = getConnection();
  const ownerPk = new PublicKey(owner);

  if (holdings.length === 0) return [];

  const pdas = holdings.map(
    ({ mint }) => findDepositPda(ownerPk, new PublicKey(mint))[0],
  );

  const accountInfos = await connection.getMultipleAccountsInfo(pdas);

  const secured: TokenHolding[] = [];
  for (let i = 0; i < holdings.length; i++) {
    const info = accountInfos[i];
    if (!info?.data) continue;
    const rawAmount = readDepositAmount(info.data as Buffer);
    if (rawAmount <= BigInt(0)) continue;

    const holding = holdings[i];
    const balance = Number(rawAmount) / Math.pow(10, holding.decimals);

    secured.push({
      ...holding,
      balance,
      valueUsd: holding.priceUsd ? balance * holding.priceUsd : null,
      isSecured: true,
    });
  }

  return secured;
}
