export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",

  main(ctx: InstanceType<typeof ContentScriptContext>) {
    // Listen for messages from the MAIN world provider script
    window.addEventListener("message", (event: MessageEvent) => {
      // Only accept messages from this window
      if (event.source !== window) return;

      const data = event.data;
      if (!data || data.target !== "loyal-wallet-bridge") return;

      const { id, payload } = data as {
        id: string;
        payload: { type: string; [key: string]: unknown };
      };

      // Disconnect is fire-and-forget — no response expected
      if (payload.type === "DAPP_DISCONNECT") {
        void browser.runtime.sendMessage(payload);
        return;
      }

      // All other messages expect a response from background
      void (async () => {
        try {
          const response = await browser.runtime.sendMessage(payload);
          window.postMessage(
            { target: "loyal-wallet-provider", id, payload: response },
            "*",
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
            "*",
          );
        }
      })();
    });
  },
});
