import { z } from "zod";

import { solanaSignInInputSchema } from "./contracts";

export type WalletAuthMessageInput = {
  appName: string;
  origin: string;
  walletAddress: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
};

export type WalletAuthTransactionMemoInput = WalletAuthMessageInput;

export const WALLET_AUTH_CHALLENGE_TOKEN_TYPE = "wallet_challenge";
export const WALLET_AUTH_MESSAGE_VERSION = 1;
export const WALLET_AUTH_SIWS_STATEMENT =
  "Clicking Sign or Approve only proves you control this wallet. This request will not trigger any blockchain transaction or cost any gas fee.";
export const WALLET_AUTH_TRANSACTION_STATEMENT =
  "This transaction only proves you control this wallet for Loyal sign-in. Loyal will not broadcast it. It does not transfer tokens or grant spending permissions.";

const walletChallengeTokenBaseClaimsSchema = z.object({
  tokenType: z.literal(WALLET_AUTH_CHALLENGE_TOKEN_TYPE),
  version: z.literal(1),
  origin: z.string().min(1),
});

export const walletMessageChallengeTokenClaimsSchema =
  walletChallengeTokenBaseClaimsSchema.extend({
    proofKind: z.literal("message"),
    walletAddress: z.string().min(1),
    message: z.string().min(1),
  });

export const walletSiwsChallengeTokenClaimsSchema =
  walletChallengeTokenBaseClaimsSchema.extend({
    proofKind: z.literal("siws"),
    signInInput: solanaSignInInputSchema,
  });

export const walletTransactionChallengeTokenClaimsSchema =
  walletChallengeTokenBaseClaimsSchema.extend({
    proofKind: z.literal("transaction"),
    walletAddress: z.string().min(1),
    memo: z.string().min(1),
    transaction: z.string().min(1),
  });

export const walletChallengeTokenClaimsSchema = z.discriminatedUnion(
  "proofKind",
  [
    walletMessageChallengeTokenClaimsSchema,
    walletSiwsChallengeTokenClaimsSchema,
    walletTransactionChallengeTokenClaimsSchema,
  ]
);

export const legacyWalletChallengeTokenClaimsSchema = z.object({
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

export function buildWalletAuthTransactionMemo({
  appName,
  origin,
  walletAddress,
  nonce,
  issuedAt,
  expiresAt,
}: WalletAuthTransactionMemoInput): string {
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
    WALLET_AUTH_TRANSACTION_STATEMENT,
  ].join("\n");
}
