import type { PublicKey } from "@solana/web3.js";

export class BytesEncoder {
  private readonly bytes: number[] = [];

  pushU8(value: number): void {
    this.bytes.push(value & 0xff);
  }

  pushBool(value: boolean): void {
    this.pushU8(value ? 1 : 0);
  }

  pushU16(value: number): void {
    this.bytes.push(value & 0xff, (value >> 8) & 0xff);
  }

  pushU32(value: number): void {
    this.bytes.push(
      value & 0xff,
      (value >> 8) & 0xff,
      (value >> 16) & 0xff,
      (value >> 24) & 0xff
    );
  }

  pushU64(value: bigint): void {
    let remaining = value;
    for (let index = 0; index < 8; index += 1) {
      this.pushU8(Number(remaining & BigInt(0xff)));
      remaining >>= BigInt(8);
    }
  }

  pushBytes(bytes: Uint8Array | readonly number[]): void {
    this.bytes.push(...bytes);
  }

  pushPubkey(pubkey: PublicKey): void {
    this.pushBytes(pubkey.toBytes());
  }

  pushOption<T>(
    value: T | undefined | null,
    encodeValue: (value: T) => void
  ): void {
    if (value === undefined || value === null) {
      this.pushU8(0);
      return;
    }
    this.pushU8(1);
    encodeValue(value);
  }

  pushVec<T>(items: readonly T[], encodeItem: (item: T) => void): void {
    this.pushU32(items.length);
    for (const item of items) {
      encodeItem(item);
    }
  }

  pushSmallVec<T>(items: readonly T[], encodeItem: (item: T) => void): void {
    if (items.length > 255) {
      throw new Error("Squads small vec overflow");
    }
    this.pushU8(items.length);
    for (const item of items) {
      encodeItem(item);
    }
  }

  finish(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}
