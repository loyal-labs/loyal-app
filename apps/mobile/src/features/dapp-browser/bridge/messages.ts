export const BRIDGE_MESSAGE_SOURCE = "loyal-mobile-wallet" as const;

export const BRIDGE_REQUEST_TYPES = [
  "connect",
  "disconnect",
  "signMessage",
  "signTransaction",
  "signAndSendTransaction",
] as const;

export type BridgeRequestType = (typeof BRIDGE_REQUEST_TYPES)[number];

export type BridgeRequest = {
  source: typeof BRIDGE_MESSAGE_SOURCE;
  id: string;
  type: BridgeRequestType;
  payload?: Record<string, unknown>;
};

export type BridgeResponse =
  | {
      source: typeof BRIDGE_MESSAGE_SOURCE;
      id: string;
      ok: true;
      result?: unknown;
    }
  | {
      source: typeof BRIDGE_MESSAGE_SOURCE;
      id: string;
      ok: false;
      error: string;
    };

export const BRIDGE_RESPONSE_RESOLVER = "__loyalMobileWalletBridgeResolve" as const;
