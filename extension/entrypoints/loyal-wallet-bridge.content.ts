function isContextInvalid(ctx: InstanceType<typeof ContentScriptContext>) {
  if (ctx.signal.aborted) return true;
  try {
    void browser.runtime.id;
    return false;
  } catch {
    return true;
  }
}

const ALLOWED_BRIDGE_MESSAGE_TYPES = new Set([
  "DAPP_CONNECT_REQUEST",
  "DAPP_SIGN_TRANSACTION_REQUEST",
  "DAPP_SIGN_MESSAGE_REQUEST",
  "DAPP_DISCONNECT",
]);

interface BridgePayload {
  type: string;
  [key: string]: unknown;
}

function isBridgePayload(value: unknown): value is BridgePayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as { type?: unknown };
  return typeof payload.type === "string";
}

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",

  main(ctx: InstanceType<typeof ContentScriptContext>) {
    const handler = (event: MessageEvent) => {
      // Only accept messages from this window
      if (event.source !== window) return;

      const data = event.data;
      if (!data || data.target !== "loyal-wallet-bridge") return;

      // Bail out if extension context was invalidated (e.g. extension reloaded)
      if (isContextInvalid(ctx)) return;

      const { id, payload } = data as {
        id?: unknown;
        payload?: unknown;
      };

      const requestId = typeof id === "string" ? id : null;
      const replyWithError = (error: string) => {
        if (!requestId) return;
        window.postMessage(
          {
            target: "loyal-wallet-provider",
            id: requestId,
            payload: {
              approved: false,
              error,
            },
          },
          window.location.origin,
        );
      };

      if (!isBridgePayload(payload)) {
        replyWithError("Malformed bridge payload.");
        return;
      }

      if (!ALLOWED_BRIDGE_MESSAGE_TYPES.has(payload.type)) {
        replyWithError("Unsupported bridge message type.");
        return;
      }

      // Disconnect is fire-and-forget — no response expected
      if (payload.type === "DAPP_DISCONNECT") {
        try {
          void browser.runtime.sendMessage(payload);
        } catch {
          // Context invalidated — ignore silently
        }
        return;
      }

      // All other messages expect a response from background
      if (!requestId) return;

      void (async () => {
        try {
          const response = await browser.runtime.sendMessage(payload);
          window.postMessage(
            { target: "loyal-wallet-provider", id: requestId, payload: response },
            window.location.origin,
          );
        } catch (err) {
          window.postMessage(
            {
              target: "loyal-wallet-provider",
              id: requestId,
              payload: {
                approved: false,
                error:
                  err instanceof Error
                    ? err.message
                    : "Extension communication failed.",
              },
            },
            window.location.origin,
          );
        }
      })();
    };

    window.addEventListener("message", handler);

    // Clean up when context is invalidated (extension reloaded/updated)
    ctx.signal.addEventListener("abort", () => {
      window.removeEventListener("message", handler);
    });
  },
});
