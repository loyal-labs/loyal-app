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

  it("injects a wallet-standard compatible Loyal provider", async () => {
    const postedMessages: string[] = [];
    let registeredWallet: unknown;
    const runtime = globalThis as any;
    const previousWindow = runtime.window;
    const previousCustomEvent = runtime.CustomEvent;

    class TestCustomEvent {
      detail: unknown;

      constructor(
        readonly type: string,
        init?: { detail?: unknown },
      ) {
        this.detail = init?.detail;
      }
    }

    runtime.CustomEvent = TestCustomEvent;
    runtime.window = {
      ReactNativeWebView: {
        postMessage: (message: string) => postedMessages.push(message),
      },
      addEventListener: jest.fn(),
      dispatchEvent: (event: { detail?: (api: unknown) => void }) => {
        event.detail?.({
          register: (wallet: unknown) => {
            registeredWallet = wallet;
          },
        });
      },
      navigator: {},
    } as any;

    try {
      eval(buildInjectedProviderScript());

      const loyal = (
        globalThis.window as typeof globalThis.window & {
          loyal: {
            connect: () => Promise<unknown>;
            request: (input: { method: string; params?: unknown }) => Promise<unknown>;
            wallet: {
              accounts: unknown[];
              features: Record<string, unknown>;
              icon: string;
              name: string;
            };
          };
        }
      ).loyal;

      expect(registeredWallet).toBe(loyal.wallet);
      expect(loyal.wallet.name).toBe("Loyal");
      expect(loyal.wallet.icon.startsWith("data:image/svg+xml")).toBe(true);
      expect(Object.keys(loyal.wallet.features)).toEqual([
        "standard:connect",
        "standard:disconnect",
        "standard:events",
        "solana:signTransaction",
        "solana:signMessage",
      ]);
      await expect(
        (
          loyal.wallet.features["standard:connect"] as {
            connect: (input?: { silent?: boolean }) => Promise<{ accounts: unknown[] }>;
          }
        ).connect({ silent: true }),
      ).resolves.toEqual({ accounts: [] });

      void loyal.request({ method: "connect" });
      expect(JSON.parse(postedMessages[0] ?? "{}")).toMatchObject({
        source: "loyal-mobile-wallet",
        type: "connect",
      });
    } finally {
      runtime.window = previousWindow;
      runtime.CustomEvent = previousCustomEvent;
    }
  });
});
