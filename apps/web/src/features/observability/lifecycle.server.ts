import "server-only";

import { after } from "next/server";

import {
  createLifecycleTracker,
  isCanonicalUuidV4,
  type LifecycleFlowName,
  type LifecycleFlowVariant,
  type LifecycleTracker,
} from "./lifecycle-contract";
import { reportBrowserLifecycleEnvelope } from "./server";

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

  let walletAddress: string | undefined;
  const tracker = createLifecycleTracker({
    emit: (event) => {
      const eventWalletAddress = walletAddress;
      after(async () => {
        await reportBrowserLifecycleEnvelope(event, eventWalletAddress);
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
    setVerifiedWallet: (verifiedWalletAddress) => {
      walletAddress = verifiedWalletAddress.trim() || undefined;
    },
    tracker,
  };
}
