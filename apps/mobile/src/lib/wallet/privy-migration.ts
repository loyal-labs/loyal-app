import { Buffer } from "buffer";

import { mmkv } from "@/lib/storage";

import { isWalletRejection } from "./rejection";
import type { Signer } from "./signer";

export const PRIVY_MIGRATION_DONE_KEY = "loyal:privy-migration-done";
// Domain/uri are echoed into the SIWS message; Privy validates the domain
// against the app's allowed origins.
export const SIWS_DOMAIN = "askloyal.com";
export const SIWS_URI = "https://askloyal.com/mobile";

/** Subset of `useLoginWithSiws()` from @privy-io/expo. */
export type SiwsLogin = {
  generateMessage(args: {
    wallet: { address: string };
    from: { domain: string; uri: string };
  }): Promise<{ message: string }>;
  login(args: { message: string; signature: string }): Promise<unknown>;
};

type DoneFlag = {
  getBoolean(key: string): boolean | undefined;
  setBoolean(key: string, value: boolean): void;
};

export type PrivyMigrationResult = "done" | "skipped" | "declined" | "failed";

/**
 * Sign a Privy SIWS message with the existing signer so this device's wallet
 * becomes a linked account on a Privy user. Never throws: the caller keeps
 * the legacy signer regardless, and "declined" / "failed" retry next launch.
 */
export async function migrateSignerToPrivy(
  signer: Signer,
  siws: SiwsLogin,
  storage: DoneFlag = mmkv,
): Promise<PrivyMigrationResult> {
  if (storage.getBoolean(PRIVY_MIGRATION_DONE_KEY)) return "skipped";
  try {
    const { message } = await siws.generateMessage({
      wallet: { address: signer.publicKey.toBase58() },
      from: { domain: SIWS_DOMAIN, uri: SIWS_URI },
    });
    const signature = await signer.signMessage(Buffer.from(message, "utf8"));
    // Privy expects base64 here, not base58 (web commit 0d7e44a1).
    await siws.login({
      message,
      signature: Buffer.from(signature).toString("base64"),
    });
    storage.setBoolean(PRIVY_MIGRATION_DONE_KEY, true);
    return "done";
  } catch (error) {
    if (isWalletRejection(error)) return "declined";
    console.warn("[privy] migration failed", error);
    return "failed";
  }
}
