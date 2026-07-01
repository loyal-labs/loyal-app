import { z } from "zod";

import { authMethodSchema, authSessionUserSchema } from "./contracts";
import type { AuthSessionUser } from "./contracts";

export const AUTH_SESSION_COOKIE_NAME = "loyal_email_session";

export const authSessionTokenClaimsSchema = z.object({
  sub: z.string().min(1).optional(),
  authMethod: authMethodSchema,
  subjectAddress: z.string().min(1),
  displayAddress: z.string().min(1),
  email: z.string().trim().email().optional(),
  provider: z.string().min(1).optional(),
  walletAddress: z.string().min(1).optional(),
  smartAccountAddress: z.string().min(1).optional(),
  settingsPda: z.string().min(1).optional(),
});

export type AuthSessionTokenClaimsData = z.infer<
  typeof authSessionTokenClaimsSchema
>;

export function createAuthSessionTokenClaims(
  user: AuthSessionUser
): AuthSessionTokenClaimsData {
  return authSessionTokenClaimsSchema.parse({
    authMethod: user.authMethod,
    subjectAddress: user.subjectAddress,
    displayAddress: user.displayAddress,
    ...(user.email ? { email: user.email } : {}),
    ...(user.provider ? { provider: user.provider } : {}),
    ...(user.walletAddress ? { walletAddress: user.walletAddress } : {}),
    ...(user.smartAccountAddress
      ? { smartAccountAddress: user.smartAccountAddress }
      : {}),
    ...(user.settingsPda ? { settingsPda: user.settingsPda } : {}),
  });
}

export function mapAuthSessionTokenClaimsToUser(
  claims: unknown
): AuthSessionUser {
  const parsedClaims = authSessionTokenClaimsSchema.parse(claims);

  return authSessionUserSchema.parse({
    authMethod: parsedClaims.authMethod,
    subjectAddress: parsedClaims.subjectAddress,
    displayAddress: parsedClaims.displayAddress,
    ...(parsedClaims.email ? { email: parsedClaims.email } : {}),
    ...(parsedClaims.provider ? { provider: parsedClaims.provider } : {}),
    ...(parsedClaims.walletAddress
      ? { walletAddress: parsedClaims.walletAddress }
      : {}),
    ...(parsedClaims.smartAccountAddress
      ? { smartAccountAddress: parsedClaims.smartAccountAddress }
      : {}),
    ...(parsedClaims.settingsPda
      ? { settingsPda: parsedClaims.settingsPda }
      : {}),
  });
}
