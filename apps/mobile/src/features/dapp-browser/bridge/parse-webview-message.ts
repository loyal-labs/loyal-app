import {
  BRIDGE_MESSAGE_SOURCE,
  BRIDGE_REQUEST_TYPES,
  type BridgeRequest,
  type BridgeRequestType,
} from "./messages";

function isBridgeRequestType(value: unknown): value is BridgeRequestType {
  return typeof value === "string" && BRIDGE_REQUEST_TYPES.includes(value as BridgeRequestType);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseWebViewMessage(raw: string): BridgeRequest {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Unsupported bridge payload.");
  }

  if (!isPlainObject(parsed)) {
    throw new Error("Unsupported bridge payload.");
  }

  const { source, id, type, payload } = parsed as {
    source?: unknown;
    id?: unknown;
    type?: unknown;
    payload?: unknown;
  };

  if (
    source !== BRIDGE_MESSAGE_SOURCE ||
    typeof id !== "string" ||
    !isBridgeRequestType(type) ||
    (payload !== undefined && !isPlainObject(payload))
  ) {
    throw new Error("Unsupported bridge payload.");
  }

  return {
    source,
    id,
    type,
    ...(payload ? { payload } : {}),
  };
}
