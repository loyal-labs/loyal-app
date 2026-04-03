function isContextInvalid(ctx: InstanceType<typeof ContentScriptContext>) {
  if (ctx.signal.aborted) return true;
  try {
    void browser.runtime.id;
    return false;
  } catch {
    return true;
  }
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
        id: string;
        payload: { type: string; [key: string]: unknown };
      };

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
      void (async () => {
        try {
          const response = await browser.runtime.sendMessage(payload);
          window.postMessage(
            { target: "loyal-wallet-provider", id, payload: response },
            window.location.origin,
          );
        } catch (err) {
          window.postMessage(
            {
              target: "loyal-wallet-provider",
              id,
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
