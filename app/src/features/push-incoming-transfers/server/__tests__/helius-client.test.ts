import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let createHeliusWebhook: typeof import("../helius-client").createHeliusWebhook;
let patchHeliusWebhookAddresses: typeof import("../helius-client").patchHeliusWebhookAddresses;
let deleteHeliusWebhook: typeof import("../helius-client").deleteHeliusWebhook;

const originalFetch = globalThis.fetch;

describe("helius-client", () => {
  beforeAll(async () => {
    ({ createHeliusWebhook, patchHeliusWebhookAddresses, deleteHeliusWebhook } =
      await import("../helius-client"));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("createHeliusWebhook", () => {
    test("POSTs the correct URL and body, returns webhookId from webhookID field", async () => {
      const capturedCalls: Array<{
        url: string;
        init: RequestInit | undefined;
      }> = [];

      const fetchMock = mock(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          capturedCalls.push({ url: String(input), init });
          return new Response(
            JSON.stringify({
              webhookID: "wh_abc123",
              webhookURL: "https://example.com/hook",
            }),
            { status: 200 }
          );
        }
      );
      globalThis.fetch = fetchMock as typeof fetch;

      const result = await createHeliusWebhook({
        accountAddresses: ["addr1", "addr2"],
        apiKey: "test-api-key",
        authHeader: "Bearer secret",
        webhookUrl: "https://example.com/hook",
      });

      expect(result).toEqual({ webhookId: "wh_abc123" });
      expect(capturedCalls).toHaveLength(1);

      const call = capturedCalls[0];
      expect(call).toBeDefined();
      if (!call) return;

      expect(call.url).toBe(
        "https://api.helius.xyz/v0/webhooks?api-key=test-api-key"
      );
      expect(call.init?.method).toBe("POST");

      const headers = new Headers(call.init?.headers);
      expect(headers.get("content-type")).toBe("application/json");

      const body = JSON.parse(String(call.init?.body));
      expect(body).toEqual({
        accountAddresses: ["addr1", "addr2"],
        authHeader: "Bearer secret",
        transactionTypes: ["TRANSFER"],
        webhookType: "enhanced",
        webhookURL: "https://example.com/hook",
      });
    });

    test("throws Helius createWebhook <status>: <body> on non-2xx", async () => {
      globalThis.fetch = mock(
        async () =>
          new Response("invalid api key", {
            status: 401,
            statusText: "Unauthorized",
          })
      ) as typeof fetch;

      await expect(
        createHeliusWebhook({
          accountAddresses: ["addr1"],
          apiKey: "bad-key",
          authHeader: "Bearer secret",
          webhookUrl: "https://example.com/hook",
        })
      ).rejects.toThrow("Helius createWebhook 401: invalid api key");
    });
  });

  describe("patchHeliusWebhookAddresses", () => {
    test("PUTs the correct URL and body with webhookType + transactionTypes re-asserted", async () => {
      const capturedCalls: Array<{
        url: string;
        init: RequestInit | undefined;
      }> = [];

      globalThis.fetch = mock(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          capturedCalls.push({ url: String(input), init });
          return new Response("{}", { status: 200 });
        }
      ) as typeof fetch;

      await patchHeliusWebhookAddresses({
        accountAddresses: ["a", "b", "c"],
        apiKey: "k",
        heliusWebhookId: "wh_1",
      });

      expect(capturedCalls).toHaveLength(1);

      const call = capturedCalls[0];
      expect(call).toBeDefined();
      if (!call) return;

      expect(call.url).toBe("https://api.helius.xyz/v0/webhooks/wh_1?api-key=k");
      expect(call.init?.method).toBe("PUT");

      const headers = new Headers(call.init?.headers);
      expect(headers.get("content-type")).toBe("application/json");

      const body = JSON.parse(String(call.init?.body));
      expect(body).toEqual({
        accountAddresses: ["a", "b", "c"],
        transactionTypes: ["TRANSFER"],
        webhookType: "enhanced",
      });
    });

    test("throws Helius patchWebhookAddresses <status>: <body> on non-2xx", async () => {
      globalThis.fetch = mock(
        async () =>
          new Response("boom", { status: 500, statusText: "Server Error" })
      ) as typeof fetch;

      await expect(
        patchHeliusWebhookAddresses({
          accountAddresses: ["a"],
          apiKey: "k",
          heliusWebhookId: "wh_1",
        })
      ).rejects.toThrow("Helius patchWebhookAddresses 500: boom");
    });
  });

  describe("deleteHeliusWebhook", () => {
    test("DELETEs the correct URL", async () => {
      const capturedCalls: Array<{
        url: string;
        init: RequestInit | undefined;
      }> = [];

      globalThis.fetch = mock(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          capturedCalls.push({ url: String(input), init });
          return new Response("", { status: 200 });
        }
      ) as typeof fetch;

      await deleteHeliusWebhook("k", "wh_1");

      expect(capturedCalls).toHaveLength(1);

      const call = capturedCalls[0];
      expect(call).toBeDefined();
      if (!call) return;

      expect(call.url).toBe("https://api.helius.xyz/v0/webhooks/wh_1?api-key=k");
      expect(call.init?.method).toBe("DELETE");
    });

    test("treats 404 as success (does not throw)", async () => {
      globalThis.fetch = mock(
        async () =>
          new Response("not found", { status: 404, statusText: "Not Found" })
      ) as typeof fetch;

      await expect(deleteHeliusWebhook("k", "wh_missing")).resolves.toBeUndefined();
    });

    test("throws Helius deleteWebhook <status>: <body> on non-2xx, non-404", async () => {
      globalThis.fetch = mock(
        async () =>
          new Response("server kaboom", {
            status: 500,
            statusText: "Server Error",
          })
      ) as typeof fetch;

      await expect(deleteHeliusWebhook("k", "wh_1")).rejects.toThrow(
        "Helius deleteWebhook 500: server kaboom"
      );
    });
  });
});
