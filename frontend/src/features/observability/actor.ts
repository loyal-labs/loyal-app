import { createHmac } from "node:crypto";

const ACTOR_ID_PATTERN = /^actor:v1:[0-9a-f]{64}$/;

export function deriveObservabilityActorId(args: {
  deploymentEnvironment: string;
  secret: string;
  walletAddress: string;
}): string | null {
  const secret = args.secret.trim();
  const environment = args.deploymentEnvironment.trim();
  const walletAddress = args.walletAddress.trim();
  if (secret.length < 32 || !environment || !walletAddress) return null;

  const digest = createHmac("sha256", secret)
    .update(`v1|${environment}|${walletAddress}`, "utf8")
    .digest("hex");
  const actorId = `actor:v1:${digest}`;
  return ACTOR_ID_PATTERN.test(actorId) ? actorId : null;
}
