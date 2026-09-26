import "server-only";

import { createHash } from "node:crypto";

import { earnMaxInviteRedemptions } from "@loyal-labs/db-core/schema";
import { eq } from "drizzle-orm";

import { getDatabase } from "@/lib/core/database";

export const EARN_MAX_INVITE_CODE_LENGTH = 6;
const CODE_PATTERN = /^[A-Z0-9]{6}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export type InviteRedeemResult =
  | "redeemed"
  | "already_redeemed"
  | "invalid_code"
  | "code_used";

export function normalizeInviteCode(code: unknown): string | null {
  if (typeof code !== "string") return null;
  const normalized = code.trim().toUpperCase();
  return CODE_PATTERN.test(normalized) ? normalized : null;
}

export function hashInviteCode(normalizedCode: string): string {
  return createHash("sha256").update(normalizedCode).digest("hex");
}

// Fail closed: an unset list admits nobody; a malformed entry is a deploy
// error, not a silently smaller list.
export function parseInviteCodeHashes(raw: string | undefined): Set<string> {
  const hashes = new Set<string>();
  for (const entry of (raw ?? "").split(",")) {
    const hash = entry.trim().toLowerCase();
    if (!hash) continue;
    if (!HASH_PATTERN.test(hash)) {
      throw new Error("EARN_MAX_INVITE_CODE_HASHES has a malformed entry");
    }
    hashes.add(hash);
  }
  return hashes;
}

export async function hasRedeemedInvite(walletAddress: string) {
  const row = await getDatabase().query.earnMaxInviteRedemptions.findFirst({
    columns: { id: true },
    where: eq(earnMaxInviteRedemptions.walletAddress, walletAddress),
  });
  return row !== undefined;
}

// One use per code and one code per wallet are enforced by the unique
// indexes; the insert races safely and the loser is classified by re-reading.
export async function redeemInvite(input: {
  code: unknown;
  settingsPda: string;
  walletAddress: string;
}): Promise<InviteRedeemResult> {
  const normalized = normalizeInviteCode(input.code);
  if (!normalized) return "invalid_code";
  const codeHash = hashInviteCode(normalized);
  if (!parseInviteCodeHashes(process.env.EARN_MAX_INVITE_CODE_HASHES).has(codeHash)) {
    return "invalid_code";
  }
  const db = getDatabase();
  const inserted = await db
    .insert(earnMaxInviteRedemptions)
    .values({ codeHash, settingsPda: input.settingsPda, walletAddress: input.walletAddress })
    .onConflictDoNothing()
    .returning({ id: earnMaxInviteRedemptions.id });
  if (inserted.length > 0) return "redeemed";
  if (await hasRedeemedInvite(input.walletAddress)) return "already_redeemed";
  return "code_used";
}
