import "server-only";

import { createHmac } from "node:crypto";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { PublicKey } from "@solana/web3.js";

import type { AuthenticatedPrincipal } from "@/features/identity/server/auth-session";

const TOKEN_VERSION = 1 as const;
const TOKEN_ISSUER = "loyal-apps";
const TOKEN_AUDIENCE = "loyal-yield-realtime";
const TOKEN_LIFETIME_SECONDS = 300;
const MAX_TOKEN_LIFETIME_SECONDS = 300;
const EARN_VAULT_INDEX = 1;

export type EarnRealtimeTokenClaims = {
  v: typeof TOKEN_VERSION;
  iss: typeof TOKEN_ISSUER;
  aud: typeof TOKEN_AUDIENCE;
  iat: number;
  exp: number;
  walletAddress: string;
  settingsPda: string;
  earnVaultAddress: string;
  solanaEnv: "devnet" | "mainnet-beta";
  scopes: ["autodeposit", "earn"];
  clientKind: "web";
};

export type IssuedEarnRealtimeToken = {
  accessToken: string;
  claims: EarnRealtimeTokenClaims;
  expiresAt: string;
};

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function resolveRealtimeSolanaEnv(
  solanaEnv: SolanaEnv
): EarnRealtimeTokenClaims["solanaEnv"] {
  if (solanaEnv === "devnet") {
    return "devnet";
  }
  if (solanaEnv === "mainnet") {
    return "mainnet-beta";
  }
  throw new Error("Earn realtime is unavailable on localnet.");
}

export function issueEarnRealtimeToken({
  authSecret,
  now = new Date(),
  principal,
  programId,
  solanaEnv,
}: {
  authSecret: string;
  now?: Date;
  principal: AuthenticatedPrincipal;
  programId: string;
  solanaEnv: SolanaEnv;
}): IssuedEarnRealtimeToken {
  if (Buffer.byteLength(authSecret) < 32) {
    throw new Error("Earn realtime authentication secret is invalid.");
  }
  if (TOKEN_LIFETIME_SECONDS > MAX_TOKEN_LIFETIME_SECONDS) {
    throw new Error(
      "Earn realtime token lifetime exceeds the protocol maximum."
    );
  }

  const settingsPda = new PublicKey(principal.settingsPda);
  const [earnVaultPda] = pda.getSmartAccountPda({
    accountIndex: EARN_VAULT_INDEX,
    programId: new PublicKey(programId),
    settingsPda,
  });
  const issuedAt = Math.floor(now.getTime() / 1000);
  const claims: EarnRealtimeTokenClaims = {
    aud: TOKEN_AUDIENCE,
    clientKind: "web",
    earnVaultAddress: earnVaultPda.toBase58(),
    exp: issuedAt + TOKEN_LIFETIME_SECONDS,
    iat: issuedAt,
    iss: TOKEN_ISSUER,
    scopes: ["autodeposit", "earn"],
    settingsPda: settingsPda.toBase58(),
    solanaEnv: resolveRealtimeSolanaEnv(solanaEnv),
    v: TOKEN_VERSION,
    walletAddress: new PublicKey(principal.walletAddress).toBase58(),
  };
  const encodedPayload = base64Url(JSON.stringify(claims));
  const signature = createHmac("sha256", authSecret)
    .update(encodedPayload)
    .digest("base64url");

  return {
    accessToken: `${encodedPayload}.${signature}`,
    claims,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  };
}
