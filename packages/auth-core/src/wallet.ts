import { z } from "zod";

export type WalletAuthMessageInput = {
  appName: string;
  origin: string;
  walletAddress: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
};

export const WALLET_AUTH_CHALLENGE_TOKEN_TYPE = "wallet_challenge";
export const WALLET_AUTH_MESSAGE_VERSION = 1;

export const walletChallengeTokenClaimsSchema = z.object({
  tokenType: z.literal(WALLET_AUTH_CHALLENGE_TOKEN_TYPE),
  version: z.literal(1),
  origin: z.string().min(1),
  walletAddress: z.string().min(1),
  message: z.string().min(1),
});

export type WalletChallengeTokenClaimsData = z.infer<
  typeof walletChallengeTokenClaimsSchema
>;

export function buildWalletAuthMessage({
  appName,
  origin,
  walletAddress,
  nonce,
  issuedAt,
  expiresAt,
}: WalletAuthMessageInput): string {
  return [
    `Sign in to ${appName}`,
    "",
    `Version: ${WALLET_AUTH_MESSAGE_VERSION}`,
    `Origin: ${origin}`,
    `Wallet: ${walletAddress}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expires At: ${expiresAt}`,
    "",
    "This request only verifies that you control this wallet.",
    "This is not a transaction and will not cost gas.",
  ].join("\n");
}
