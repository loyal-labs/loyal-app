import { z } from "zod";

export const SMART_ACCOUNT_SOLANA_ENVS = [
  "mainnet",
  "testnet",
  "devnet",
  "localnet",
] as const;

export const smartAccountProvisioningStateSchema = z.enum([
  "pending",
  "ready",
]);

export const ensureSmartAccountRequestSchema = z.object({
  refreshPending: z.boolean().optional(),
  settingsPda: z.string().trim().min(1).optional(),
  signature: z.string().trim().min(1).optional(),
}).refine((value) => !value.signature || Boolean(value.settingsPda), {
  message: "A settings PDA is required when a signature is provided.",
  path: ["settingsPda"],
});

export const smartAccountProvisioningResponseSchema = z.object({
  state: smartAccountProvisioningStateSchema,
  solanaEnv: z.enum(SMART_ACCOUNT_SOLANA_ENVS),
  programId: z.string().trim().min(1),
  settingsPda: z.string().trim().min(1),
  smartAccountAddress: z.string().trim().min(1),
  creationSignature: z.string().trim().min(1).nullable(),
  treasury: z.string().trim().min(1).nullable(),
});

export type SmartAccountProvisioningState = z.infer<
  typeof smartAccountProvisioningStateSchema
>;
export type EnsureSmartAccountRequest = z.infer<
  typeof ensureSmartAccountRequestSchema
>;
export type SmartAccountProvisioningResponse = z.infer<
  typeof smartAccountProvisioningResponseSchema
>;
