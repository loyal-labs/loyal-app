import { getTrustState } from "./origin";
import type { DappTrustState, PendingApproval } from "./types";

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
  trustedOrigins: string[];
};

function buildOkResponse(request: BridgeRequest): BridgeResponse {
  return {
    source: request.source,
    id: request.id,
    ok: true,
  };
}

function buildErrorResponse(
  request: BridgeRequest,
  error: string,
): BridgeResponse {
  return {
    source: request.source,
    id: request.id,
    ok: false,
    error,
  };
}

function readPayloadString(
  request: BridgeRequest,
  key: "message" | "transaction",
): string | null {
  const value = request.payload?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function buildApproval(
  request: BridgeRequest,
  origin: string,
  trustState: DappTrustState,
): { approval: PendingApproval } | { error: string } {
  const base = { requestId: request.id, origin, trustState };

  switch (request.type) {
    case "connect":
      return { approval: { ...base, type: "connect" } };
    case "signMessage": {
      const messageBase64 = readPayloadString(request, "message");
      if (!messageBase64) {
        return { error: "signMessage requires a base64 'message' payload." };
      }
      return {
        approval: { ...base, type: "signMessage", messageBase64 },
      };
    }
    case "signTransaction":
    case "signAndSendTransaction": {
      const transactionBase64 = readPayloadString(request, "transaction");
      if (!transactionBase64) {
        return {
          error: `${request.type} requires a base64 'transaction' payload.`,
        };
      }
      return {
        approval: {
          ...base,
          type: request.type,
          transactionBase64,
        },
      };
    }
    default:
      return { error: `Unsupported request type: ${request.type}` };
  }
}

export function resolveDappRequest({
  origin,
  request,
  connectedOrigins,
  trustedOrigins,
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

  const trustState = getTrustState(origin, connectedOrigins, trustedOrigins);
  const built = buildApproval(request, origin, trustState);
  if ("error" in built) {
    return {
      kind: "response",
      response: buildErrorResponse(request, built.error),
    };
  }

  return {
    kind: "approval",
    approval: built.approval,
  };
}
