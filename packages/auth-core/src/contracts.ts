import { z } from "zod";

export const authMethodSchema = z.enum(["email", "wallet"]);

export const authSessionUserSchema = z.object({
  authMethod: authMethodSchema,
  subjectAddress: z.string().min(1),
  displayAddress: z.string().min(1),
  email: z.string().trim().email().optional(),
  provider: z.string().min(1).optional(),
  walletAddress: z.string().min(1).optional(),
  smartAccountAddress: z.string().min(1).optional(),
  settingsPda: z.string().min(1).optional(),
});

export const startEmailAuthRequestSchema = z.object({
  email: z.string().trim().email(),
  turnstileToken: z.string().trim().min(1).optional(),
});

export const startEmailAuthResponseSchema = z.object({
  authTicketId: z.string().uuid(),
  expiresAt: z.string().datetime(),
  maskedEmail: z.string().min(1),
});

export const verifyEmailAuthRequestSchema = z.object({
  authTicketId: z.string().uuid(),
  otpCode: z.string().trim().min(1).max(12),
});

export const verifyEmailAuthResponseSchema = z.object({
  user: authSessionUserSchema,
});

export const getAuthSessionResponseSchema = z.object({
  user: authSessionUserSchema,
});

export const walletAuthKindSchema = z.enum(["message", "siws"]);

export const solanaSignInInputSchema = z.object({
  domain: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  statement: z.string().min(1).optional(),
  uri: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  chainId: z.string().min(1).optional(),
  nonce: z.string().min(1).optional(),
  issuedAt: z.string().min(1).optional(),
  expirationTime: z.string().min(1).optional(),
  notBefore: z.string().min(1).optional(),
  requestId: z.string().min(1).optional(),
  resources: z.array(z.string().min(1)).optional(),
});

export const walletByteArraySchema = z.array(
  z.number().int().min(0).max(255)
);

export const serializedWalletAccountSchema = z.object({
  address: z.string().min(1),
  publicKey: walletByteArraySchema,
  features: z.array(z.string().min(1)),
  chains: z.array(z.string().min(1)),
  label: z.string().min(1).optional(),
  icon: z.string().min(1).optional(),
});

export const serializedSolanaSignInOutputSchema = z.object({
  account: serializedWalletAccountSchema,
  signedMessage: walletByteArraySchema,
  signature: walletByteArraySchema,
  signatureType: z.literal("ed25519").optional(),
});

export const walletMessageChallengeRequestSchema = z.object({
  kind: z.literal("message").optional(),
  walletAddress: z.string().min(1),
});

export const walletSiwsChallengeRequestSchema = z.object({
  kind: z.literal("siws"),
});

export const walletChallengeRequestSchema = z.union([
  walletMessageChallengeRequestSchema,
  walletSiwsChallengeRequestSchema,
]);

export const walletMessageChallengeResponseSchema = z.object({
  kind: z.literal("message").optional(),
  challengeToken: z.string().min(1),
  message: z.string().min(1),
  expiresAt: z.string().datetime(),
});

export const walletSiwsChallengeResponseSchema = z.object({
  kind: z.literal("siws"),
  challengeToken: z.string().min(1),
  signInInput: solanaSignInInputSchema,
  expiresAt: z.string().datetime(),
});

export const walletChallengeResponseSchema = z.union([
  walletMessageChallengeResponseSchema,
  walletSiwsChallengeResponseSchema,
]);

export const walletMessageCompleteRequestSchema = z.object({
  kind: z.literal("message").optional(),
  challengeToken: z.string().min(1),
  signature: z.string().min(1),
});

export const walletSiwsCompleteRequestSchema = z.object({
  kind: z.literal("siws"),
  challengeToken: z.string().min(1),
  output: serializedSolanaSignInOutputSchema,
});

export const walletCompleteRequestSchema = z.union([
  walletMessageCompleteRequestSchema,
  walletSiwsCompleteRequestSchema,
]);

export const walletCompleteResponseSchema = z.object({
  user: authSessionUserSchema,
});

export const authRoutePaths = {
  startEmailAuth: "/api/auth/email/start",
  verifyEmailAuth: "/api/auth/email/verify",
  challengeWalletAuth: "/api/auth/wallet/challenge",
  completeWalletAuth: "/api/auth/wallet/complete",
  getAuthSession: "/api/auth/session",
  logoutAuthSession: "/api/auth/logout",
} as const;

export type AuthMethod = z.infer<typeof authMethodSchema>;
export type AuthSessionUser = z.infer<typeof authSessionUserSchema>;
export type StartEmailAuthRequest = z.infer<typeof startEmailAuthRequestSchema>;
export type StartEmailAuthResponse = z.infer<
  typeof startEmailAuthResponseSchema
>;
export type VerifyEmailAuthRequest = z.infer<
  typeof verifyEmailAuthRequestSchema
>;
export type VerifyEmailAuthResponse = z.infer<
  typeof verifyEmailAuthResponseSchema
>;
export type GetAuthSessionResponse = z.infer<
  typeof getAuthSessionResponseSchema
>;
export type WalletAuthKind = z.infer<typeof walletAuthKindSchema>;
export type SolanaSignInInputJson = z.infer<typeof solanaSignInInputSchema>;
export type SerializedWalletAccount = z.infer<
  typeof serializedWalletAccountSchema
>;
export type SerializedSolanaSignInOutput = z.infer<
  typeof serializedSolanaSignInOutputSchema
>;
export type WalletChallengeRequest = z.infer<
  typeof walletChallengeRequestSchema
>;
export type WalletChallengeResponse = z.infer<
  typeof walletChallengeResponseSchema
>;
export type WalletMessageChallengeRequest = z.infer<
  typeof walletMessageChallengeRequestSchema
>;
export type WalletSiwsChallengeRequest = z.infer<
  typeof walletSiwsChallengeRequestSchema
>;
export type WalletMessageChallengeResponse = z.infer<
  typeof walletMessageChallengeResponseSchema
>;
export type WalletSiwsChallengeResponse = z.infer<
  typeof walletSiwsChallengeResponseSchema
>;
export type WalletCompleteRequest = z.infer<typeof walletCompleteRequestSchema>;
export type WalletCompleteResponse = z.infer<
  typeof walletCompleteResponseSchema
>;
export type WalletMessageCompleteRequest = z.infer<
  typeof walletMessageCompleteRequestSchema
>;
export type WalletSiwsCompleteRequest = z.infer<
  typeof walletSiwsCompleteRequestSchema
>;
