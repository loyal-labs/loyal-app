import { getTrustState } from "./origin";
import type { PendingApproval } from "./types";

import type { BridgeRequest, BridgeResponse } from "../bridge/messages";

export type DappRequestResolution =
  | {
      kind: "response";
      response: BridgeResponse;
    }
  | {
      kind: "approval";
      approval: PendingApproval;
    };

type ResolveDappRequestArgs = {
  origin: string;
  request: BridgeRequest;
  connectedOrigins: string[];
};

function buildOkResponse(request: BridgeRequest): BridgeResponse {
  return {
    source: request.source,
    id: request.id,
    ok: true,
  };
}

function buildErrorResponse(request: BridgeRequest, error: string): BridgeResponse {
  return {
    source: request.source,
    id: request.id,
    ok: false,
    error,
  };
}

export function resolveDappRequest({
  origin,
  request,
  connectedOrigins,
}: ResolveDappRequestArgs): DappRequestResolution {
  if (request.type === "disconnect") {
    return {
      kind: "response",
      response: buildOkResponse(request),
    };
  }

  if (request.type === "connect" && connectedOrigins.includes(origin)) {
    return {
      kind: "response",
      response: buildOkResponse(request),
    };
  }

  if (
    (request.type === "signMessage" ||
      request.type === "signTransaction" ||
      request.type === "signAndSendTransaction") &&
    !connectedOrigins.includes(origin)
  ) {
    return {
      kind: "response",
      response: buildErrorResponse(request, "Not connected. Call connect() first."),
    };
  }

  return {
    kind: "approval",
    approval: {
      requestId: request.id,
      origin,
      trustState: getTrustState(origin, connectedOrigins),
      type: request.type,
      payload: request.payload ?? {},
    },
  };
}
