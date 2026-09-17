/** KLend SDK 7.3.9 generated Obligation layout. Sf values retain their 2^60 scaling.
 * Reserved bytes are uninterpreted, as in the SDK; they are not required to be zero.
 */
import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import { VAULT_IDENTITY } from "./identity";

export const KLEND_PROGRAM_ID = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";
export const OBLIGATION_ACCOUNT_LENGTH = 3344;
export const OBLIGATION_OWNER_OFFSET = 64;
const discriminator = Buffer.from([168, 206, 141, 106, 88, 76, 172, 167]);
const zeroAddress = new PublicKey(new Uint8Array(32)).toBase58();
type Deposit = { reserve: string; active: boolean; depositedAmount: string; marketValueSf: string };
type Borrow = { reserve: string; active: boolean; borrowedAmountSf: string; marketValueSf: string };
export type DecodedKaminoObligation = {
  address: string; owner: string; market: string; tag: string;
  lastUpdate: { slot: string; stale: boolean; priceStatus: number };
  deposits: Deposit[]; borrows: Borrow[];
};
export type ObligationRead =
  | { kind: "absent"; address: string }
  | { kind: "invalid"; address: string; reason: string }
  | { kind: "decoded"; address: string; funded: boolean; obligation: DecodedKaminoObligation };

export function decodeObligation(address: string, account: { owner: string; data: Uint8Array } | null): ObligationRead {
  if (!account) return { kind: "absent", address };
  const invalid = (reason: string): ObligationRead => ({ kind: "invalid", address, reason });
  const data = Buffer.from(account.data);
  if (account.owner !== KLEND_PROGRAM_ID) return invalid("Unexpected program owner");
  if (data.length !== OBLIGATION_ACCOUNT_LENGTH) return invalid("Unsupported obligation layout length");
  if (!data.subarray(0, 8).equals(discriminator)) return invalid("Unexpected obligation discriminator");
  const key = (offset: number) => new PublicKey(data.subarray(offset, offset + 32)).toBase58();
  const u64 = (offset: number) => data.readBigUInt64LE(offset);
  const u128 = (offset: number) => u64(offset) | (u64(offset + 8) << 64n);
  if (key(64) !== VAULT_IDENTITY.manager) return invalid("Unexpected obligation authority");
  if (key(32) === zeroAddress) return invalid("Missing lending market");
  if (data[24] !== 0 && data[24] !== 1) return invalid("Invalid stale flag");
  const deposits: Deposit[] = [], borrows: Borrow[] = [];
  const depositReserves = new Set<string>(), borrowReserves = new Set<string>();
  // Header96 + 8*136 collateral slots + u64 + u128 = borrow offset1208.
  for (let index = 0; index < 8; index++) {
    const offset = 96 + index * 136;
    const reserve = key(offset), amount = u64(offset + 32), value = u128(offset + 40);
    if (reserve === zeroAddress && (amount !== 0n || value !== 0n)) return invalid("Deposit value without reserve");
    if (reserve !== zeroAddress && depositReserves.has(reserve)) return invalid("Duplicate deposit reserve");
    if (reserve !== zeroAddress) depositReserves.add(reserve);
    deposits.push({ reserve, active: amount !== 0n, depositedAmount: amount.toString(), marketValueSf: value.toString() });
  }
  for (let index = 0; index < 5; index++) {
    const offset = 1208 + index * 200;
    const reserve = key(offset), amount = u128(offset + 88), value = u128(offset + 104);
    if (reserve === zeroAddress && (amount !== 0n || value !== 0n)) return invalid("Debt value without reserve");
    if (reserve !== zeroAddress && borrowReserves.has(reserve)) return invalid("Duplicate borrow reserve");
    if (reserve !== zeroAddress) borrowReserves.add(reserve);
    borrows.push({ reserve, active: amount !== 0n, borrowedAmountSf: amount.toString(), marketValueSf: value.toString() });
  }
  return { kind: "decoded", address, funded: deposits.some(row => row.active) || borrows.some(row => row.active), obligation: {
    address, owner: key(64), market: key(32), tag: u64(8).toString(),
    lastUpdate: { slot: u64(16).toString(), stale: data[24] === 1, priceStatus: data[25]! }, deposits, borrows,
  } };
}
