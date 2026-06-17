import { PublicKey } from "@solana/web3.js";
import {
  SUBSCRIPTIONS_CREATE_RECURRING_DELEGATION,
  SUBSCRIPTIONS_INIT_AUTHORITY,
  SUBSCRIPTIONS_PROGRAM_ID,
  SUBSCRIPTIONS_REVOKE_DELEGATION,
  SUBSCRIPTIONS_TRANSFER_RECURRING,
  SUBSCRIPTION_AUTHORITY_SEED,
  SUBSCRIPTION_DELEGATION_SEED,
  SUBSCRIPTION_EVENT_AUTHORITY_SEED,
} from "./constants.ts";
import type {
  I64Timestamp,
  SubscriptionCreateRecurringDelegationDataInput,
  SubscriptionTransferRecurringDataInput,
  U64Amount,
} from "./types.ts";
import { BytesEncoder } from "./internal/bytes.ts";

const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
const I64_MIN = -(BigInt(1) << BigInt(63));
const I64_MAX = (BigInt(1) << BigInt(63)) - BigInt(1);

export function deriveSubscriptionAuthority(
  user: PublicKey,
  mint: PublicKey
): PublicKey {
  requirePublicKey(user, "user");
  requirePublicKey(mint, "mint");
  return PublicKey.findProgramAddressSync(
    [SUBSCRIPTION_AUTHORITY_SEED, user.toBytes(), mint.toBytes()],
    SUBSCRIPTIONS_PROGRAM_ID
  )[0];
}

export function deriveRecurringDelegation(
  subscriptionAuthority: PublicKey,
  delegator: PublicKey,
  delegatee: PublicKey,
  nonce: U64Amount
): PublicKey {
  requirePublicKey(subscriptionAuthority, "subscriptionAuthority");
  requirePublicKey(delegator, "delegator");
  requirePublicKey(delegatee, "delegatee");
  const nonceBytes = u64ToLeBytes(nonce, "nonce");
  return PublicKey.findProgramAddressSync(
    [
      SUBSCRIPTION_DELEGATION_SEED,
      subscriptionAuthority.toBytes(),
      delegator.toBytes(),
      delegatee.toBytes(),
      nonceBytes,
    ],
    SUBSCRIPTIONS_PROGRAM_ID
  )[0];
}

export function deriveSubscriptionEventAuthority(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SUBSCRIPTION_EVENT_AUTHORITY_SEED],
    SUBSCRIPTIONS_PROGRAM_ID
  )[0];
}

export function subscriptionInitAuthorityData(): Uint8Array {
  return Uint8Array.from([SUBSCRIPTIONS_INIT_AUTHORITY]);
}

export function subscriptionCreateRecurringDelegationData(
  input: SubscriptionCreateRecurringDelegationDataInput
): Uint8Array {
  const encoder = new BytesEncoder();
  encoder.pushU8(SUBSCRIPTIONS_CREATE_RECURRING_DELEGATION);
  encoder.pushU64(normalizeU64(input.nonce, "nonce"));
  encoder.pushU64(normalizeU64(input.amountPerPeriodRaw, "amountPerPeriodRaw"));
  encoder.pushU64(
    normalizeU64(input.periodLengthSeconds, "periodLengthSeconds")
  );
  encoder.pushI64(normalizeI64(input.startTimestamp, "startTimestamp"));
  encoder.pushI64(normalizeI64(input.expiryTimestamp, "expiryTimestamp"));
  encoder.pushI64(
    normalizeI64(
      input.expectedSubscriptionAuthorityInitId,
      "expectedSubscriptionAuthorityInitId"
    )
  );
  return encoder.finish();
}

export function subscriptionTransferRecurringData(
  input: SubscriptionTransferRecurringDataInput
): Uint8Array {
  requirePublicKey(input.delegator, "delegator");
  requirePublicKey(input.mint, "mint");
  const encoder = new BytesEncoder();
  encoder.pushU8(SUBSCRIPTIONS_TRANSFER_RECURRING);
  encoder.pushU64(normalizeU64(input.amountRaw, "amountRaw"));
  encoder.pushPubkey(input.delegator);
  encoder.pushPubkey(input.mint);
  return encoder.finish();
}

export function subscriptionRevokeDelegationData(): Uint8Array {
  return Uint8Array.from([SUBSCRIPTIONS_REVOKE_DELEGATION]);
}

export function normalizeU64(value: U64Amount, name: string): bigint {
  const normalized = normalizeInteger(value, name);
  if (normalized < BigInt(0) || normalized > U64_MAX) {
    throw new Error(`${name} must be a u64`);
  }
  return normalized;
}

export function normalizeI64(value: I64Timestamp, name: string): bigint {
  const normalized = normalizeInteger(value, name);
  if (normalized < I64_MIN || normalized > I64_MAX) {
    throw new Error(`${name} must be an i64`);
  }
  return normalized;
}

function normalizeInteger(value: number | bigint, name: string): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be an integer`);
  }
  return BigInt(value);
}

function u64ToLeBytes(value: U64Amount, name: string): Uint8Array {
  const normalized = normalizeU64(value, name);
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, normalized, true);
  return bytes;
}

function requirePublicKey(
  value: unknown,
  name: string
): asserts value is PublicKey {
  if (!(value instanceof PublicKey)) {
    throw new Error(`${name} must be a PublicKey`);
  }
}
