import { z } from "zod";
import { authSessionUserSchema } from "@loyal-labs/auth-core";

export const walletSessionMetadataSchema = z.object({
  expiresAt: z.string().datetime(),
  refreshAfter: z.string().datetime(),
});

export const walletSessionResponseSchema = z.object({
  user: authSessionUserSchema,
  session: walletSessionMetadataSchema,
});

export type WalletSessionMetadata = z.infer<typeof walletSessionMetadataSchema>;
export type WalletSessionResponse = z.infer<typeof walletSessionResponseSchema>;
