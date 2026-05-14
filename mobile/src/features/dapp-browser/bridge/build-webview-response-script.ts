import {
  BRIDGE_RESPONSE_RESOLVER,
  type BridgeResponse,
} from "./messages";

export function buildWebViewResponseScript(response: BridgeResponse) {
  return `globalThis.${BRIDGE_RESPONSE_RESOLVER}&&globalThis.${BRIDGE_RESPONSE_RESOLVER}(${JSON.stringify(response)});`;
}
