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

export const walletChallengeRequestSchema = z.object({
  walletAddress: z.string().min(1),
});

export const walletChallengeResponseSchema = z.object({
  challengeToken: z.string().min(1),
  message: z.string().min(1),
  expiresAt: z.string().datetime(),
});

export const walletCompleteRequestSchema = z.object({
  challengeToken: z.string().min(1),
  signature: z.string().min(1),
});

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
export type WalletChallengeRequest = z.infer<
  typeof walletChallengeRequestSchema
>;
export type WalletChallengeResponse = z.infer<
  typeof walletChallengeResponseSchema
>;
export type WalletCompleteRequest = z.infer<typeof walletCompleteRequestSchema>;
export type WalletCompleteResponse = z.infer<
  typeof walletCompleteResponseSchema
>;
