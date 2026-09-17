import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import { VAULT_IDENTITY } from "./identity";
export const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
type Account = { address: string; owner: string; data: Uint8Array };
export type TokenHoldingsView = { observedSlot: number; observedAt: string; owner: string; holdings: { account: string; mint: string; program: string; raw: string; decimals: number; frozen: boolean }[] };
export function tokenHoldingMint(account: Account): string {
  const bytes = Buffer.from(account.data);
  if (![VAULT_IDENTITY.tokenProgram, TOKEN_2022].includes(account.owner) || bytes.length < 165 || bytes.length === 355 ||
      (account.owner === VAULT_IDENTITY.tokenProgram && bytes.length !== 165) ||
      (bytes.length > 165 && bytes[165] !== 2)) throw new Error("Unsupported token account layout");
  if (new PublicKey(bytes.subarray(32, 64)).toBase58() !== VAULT_IDENTITY.manager) throw new Error("Foreign token authority");
  if (![1, 2].includes(bytes[108]!)) throw new Error("Uninitialized token account");
  return new PublicKey(bytes.subarray(0, 32)).toBase58();
}
export function decodeTokenHolding(account: Account, mint: Account | null): TokenHoldingsView["holdings"][number] {
  const address = tokenHoldingMint(account);
  if (!mint || mint.address !== address || mint.owner !== account.owner || mint.data.length < 82 || mint.data.length === 355 ||
      (mint.owner === VAULT_IDENTITY.tokenProgram && mint.data.length !== 82) ||
      (mint.data.length > 82 && (mint.data.length < 166 || mint.data[165] !== 1)) ||
      mint.data[45] !== 1 || mint.data[44]! > 24) throw new Error("Invalid token mint metadata");
  const bytes = Buffer.from(account.data);
  return { account: account.address, mint: address, program: account.owner, raw: bytes.readBigUInt64LE(64).toString(), decimals: mint.data[44]!, frozen: bytes[108] === 2 };
}
