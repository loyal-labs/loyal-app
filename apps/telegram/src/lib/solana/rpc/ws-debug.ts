import type { Connection } from "@solana/web3.js";

type ConnectionWithWsInternals = Connection & {
  _rpcEndpoint?: string;
  _rpcWsEndpoint?: string;
  _wsOnClose?: (code: number) => void;
  _wsOnError?: (err: Error) => void;
  _wsOnOpen?: () => void;
  __wsDebugPatched?: boolean;
  __wsDebugTags?: string[];
};

const sanitizeEndpoint = (endpoint: string | undefined): string => {
  if (!endpoint) return "unknown";
  try {
    const url = new URL(endpoint);
    return `${url.origin}${url.pathname}`;
  } catch {
    const [base] = endpoint.split("?");
    return base || "unknown";
  }
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const getPayload = (conn: ConnectionWithWsInternals) => ({
  tags: [...(conn.__wsDebugTags ?? [])],
  rpcEndpoint: sanitizeEndpoint(conn._rpcEndpoint),
  wsEndpoint: sanitizeEndpoint(conn._rpcWsEndpoint),
});

export const attachWsDebugLogging = (
  connection: Connection,
  tag: string
): void => {
  const conn = connection as ConnectionWithWsInternals;

  if (!Array.isArray(conn.__wsDebugTags)) {
    conn.__wsDebugTags = [];
  }
  if (!conn.__wsDebugTags.includes(tag)) {
    conn.__wsDebugTags.push(tag);
  }

  if (conn.__wsDebugPatched) {
    return;
  }
  conn.__wsDebugPatched = true;

  // Capture originals before overwriting — may be undefined at construction
  // time since @solana/web3.js assigns them lazily on first _connect() call.
  // We install wrappers unconditionally so they are in place before connect.
  const originalOnOpen = conn._wsOnOpen?.bind(conn);
  const originalOnError = conn._wsOnError?.bind(conn);
  const originalOnClose = conn._wsOnClose?.bind(conn);

  conn._wsOnOpen = () => {
    console.log("[WS_DEBUG_OPEN]", getPayload(conn));
    originalOnOpen?.();
  };

  conn._wsOnError = (error: Error) => {
    console.error("[WS_DEBUG_ERROR]", {
      ...getPayload(conn),
      errorName: error?.name ?? "unknown",
      errorMessage: getErrorMessage(error),
      stack: error?.stack,
    });
    originalOnError?.(error);
  };

  conn._wsOnClose = (code: number) => {
    console.warn("[WS_DEBUG_CLOSE]", {
      ...getPayload(conn),
      code,
    });
    originalOnClose?.(code);
  };
};
