import { Buffer } from "buffer";

import { env } from "@/config/env";
import type { EarnRealtimeTokenResponse } from "@/lib/solana/earn/earn-api";
import { normalizeEarnCluster } from "@/lib/solana/earn/position-overlay";
import type { EarnRealtimeScope } from "./events";

export type EarnSseFrame = { data: string; event?: string; id?: string };
export function parseEarnFrames(text: string): EarnSseFrame[] {
  return text.split(/\r?\n\r?\n/).flatMap((block) => {
    const frame: EarnSseFrame = { data: "" };
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(":")) continue;
      const separator = line.indexOf(":");
      const field = separator < 0 ? line : line.slice(0, separator);
      const value =
        separator < 0 ? "" : line.slice(separator + 1).replace(/^ /, "");
      if (field === "data") frame.data += `${frame.data ? "\n" : ""}${value}`;
      else if (field === "event") frame.event = value;
      else if (field === "id") frame.id = value;
    }
    return frame.data || frame.event || frame.id ? [frame] : [];
  });
}

// This is a two-part signed token, NOT a JWT. Decode only to namespace the
// cursor; the stream server alone verifies the signature/authorization.
export function earnCursorScope(
  token: EarnRealtimeTokenResponse,
  wallet: string
): EarnRealtimeScope {
  const parts = token.accessToken.split(".");
  if (parts.length !== 2) throw new Error("Invalid Earn stream scope.");
  const claims = JSON.parse(
    Buffer.from(
      parts[0].replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8")
  ) as Record<string, unknown>;
  if (
    claims.v !== 1 ||
    claims.iss !== "loyal-apps" ||
    claims.aud !== "loyal-yield-realtime" ||
    claims.walletAddress !== wallet ||
    claims.solanaEnv !== normalizeEarnCluster(env.solanaEnv) ||
    typeof claims.settingsPda !== "string" ||
    !claims.settingsPda ||
    typeof claims.earnVaultAddress !== "string" ||
    !claims.earnVaultAddress
  ) {
    throw new Error("Invalid Earn stream scope.");
  }
  return {
    walletAddress: wallet,
    settingsPda: claims.settingsPda,
    earnVaultAddress: claims.earnVaultAddress,
    solanaEnv: String(claims.solanaEnv),
  };
}

export function earnCursorKey(
  token: EarnRealtimeTokenResponse,
  wallet: string
): string {
  const scope = earnCursorScope(token, wallet);
  return `earn:realtime:v2:${JSON.stringify([
    env.earnApiBaseUrl,
    token.eventsUrl,
    wallet,
    scope.settingsPda,
    scope.earnVaultAddress,
    scope.solanaEnv,
  ])}`;
}

// The liveness check is repeated AFTER refresh: disconnects, wallet switches
// and superseded requests must never durably acknowledge an invalidation.
export async function acceptEarnInvalidation(args: {
  isCurrent: () => boolean;
  refresh: () => Promise<void>;
  acknowledge: () => void;
}): Promise<void> {
  if (!args.isCurrent()) return;
  await args.refresh();
  if (args.isCurrent()) args.acknowledge();
}
