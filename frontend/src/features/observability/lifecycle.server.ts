import "server-only";

import { after } from "next/server";

import { deriveObservabilityActorId } from "./actor";
import {
  createLifecycleTracker,
  isCanonicalUuidV4,
  type LifecycleFlowName,
  type LifecycleFlowVariant,
  type LifecycleTracker,
} from "./lifecycle-contract";
import {
  getObservabilityDeploymentEnvironment,
  reportBrowserLifecycleEnvelope,
} from "./server";

export type RequestLifecycle = {
  setVerifiedWallet: (walletAddress: string) => void;
  tracker: LifecycleTracker;
};

export function createRequestLifecycle(args: {
  flowName: LifecycleFlowName;
  flowVariant: LifecycleFlowVariant;
  request: Request;
}): RequestLifecycle | null {
  const flowId = args.request.headers.get("x-loyal-flow-id")?.trim();
  if (!isCanonicalUuidV4(flowId)) return null;

  let actorId: string | undefined;
  const tracker = createLifecycleTracker({
    emit: (event) => {
      const eventActorId = actorId;
      after(async () => {
        await reportBrowserLifecycleEnvelope(event, eventActorId);
      });
    },
    flowId,
    flowName: args.flowName,
    flowVariant: args.flowVariant,
    pathname: new URL(args.request.url).pathname,
    runtime: "node",
    source: "next_api",
  });

  return {
    setVerifiedWallet: (walletAddress) => {
      actorId =
        deriveObservabilityActorId({
          deploymentEnvironment: getObservabilityDeploymentEnvironment(),
          secret: process.env.OBSERVABILITY_ACTOR_HMAC_SECRET ?? "",
          walletAddress,
        }) ?? undefined;
    },
    tracker,
  };
}
