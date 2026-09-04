import { serverEnv } from "@/lib/core/config/server";

export function resolveSummaryCommunityPeerId(requestPeerId: bigint): bigint {
  const summaryPeerOverride = serverEnv.telegramSummaryPeerOverride;
  if (!summaryPeerOverride) {
    return requestPeerId;
  }

  if (requestPeerId === summaryPeerOverride.fromPeerId) {
    return summaryPeerOverride.toPeerId;
  }

  return requestPeerId;
}
