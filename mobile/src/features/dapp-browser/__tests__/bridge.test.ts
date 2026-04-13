import {
  buildInjectedProviderScript,
} from "../bridge/build-injected-provider-script";
import { buildWebViewResponseScript } from "../bridge/build-webview-response-script";
import { parseWebViewMessage } from "../bridge/parse-webview-message";

describe("dapp browser bridge", () => {
  it("parses supported bridge requests", () => {
    expect(
      parseWebViewMessage(
        JSON.stringify({
          source: "loyal-mobile-wallet",
          id: "req-1",
          type: "connect",
          payload: {},
        }),
      ),
    ).toEqual({
      source: "loyal-mobile-wallet",
      id: "req-1",
      type: "connect",
      payload: {},
    });
  });

  it("rejects unsupported bridge payloads", () => {
    expect(() => parseWebViewMessage("not-json")).toThrow(
      "Unsupported bridge payload.",
    );
    expect(() =>
      parseWebViewMessage(
        JSON.stringify({
          source: "someone-else",
          id: "req-1",
          type: "connect",
        }),
      ),
    ).toThrow("Unsupported bridge payload.");
  });

  it("builds a response script that resolves through the global bridge handler", () => {
    const handler = jest.fn();
    (globalThis as typeof globalThis & {
      __loyalMobileWalletBridgeResolve?: (value: unknown) => void;
    }).__loyalMobileWalletBridgeResolve = handler;

    eval(
      buildWebViewResponseScript({
        source: "loyal-mobile-wallet",
        id: "req-1",
        ok: true,
        result: { approved: false },
      }),
    );

    expect(handler).toHaveBeenCalledWith({
      source: "loyal-mobile-wallet",
      id: "req-1",
      ok: true,
      result: { approved: false },
    });
  });

  it("injects a Loyal provider with wallet-standard registration and bridge posting", () => {
    const script = buildInjectedProviderScript();

    expect(script).toContain("window.ReactNativeWebView.postMessage");
    expect(script).toContain('window.loyal');
    expect(script).toContain("wallet-standard:register-wallet");
    expect(script).toContain('connect');
    expect(script).toContain('disconnect');
    expect(script).toContain('signMessage');
    expect(script).toContain('signTransaction');
    expect(script).toContain('signAndSendTransaction');
    expect(script).toContain("loyal-mobile-wallet");
  });
});
