import { describe, expect, test } from "bun:test";

import { getExpoPushReceipts, sendExpoPushMessages } from "../expo-push";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

describe("expo push transport", () => {
  test("sends messages, reads receipts, and returns dead tokens", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ url, body });

      if (url.endsWith("/push/send")) {
        return jsonResponse({
          data: [
            { status: "ok", id: "receipt-ok" },
            {
              status: "error",
              message: "Device is not registered",
              details: { error: "DeviceNotRegistered" },
            },
          ],
        });
      }

      return jsonResponse({
        data: {
          "receipt-ok": {
            status: "error",
            message: "Device is not registered",
            details: { error: "DeviceNotRegistered" },
          },
        },
      });
    };

    const sendResult = await sendExpoPushMessages(
      [
        { to: "ExponentPushToken[live]", title: "Title", body: "Body" },
        { to: "ExponentPushToken[dead-ticket]", title: "Title", body: "Body" },
      ],
      { fetchFn }
    );
    const receiptResult = await getExpoPushReceipts(sendResult.receiptIds, {
      fetchFn,
    });

    expect(requests).toEqual([
      {
        url: "https://exp.host/--/api/v2/push/send",
        body: [
          { to: "ExponentPushToken[live]", title: "Title", body: "Body" },
          {
            to: "ExponentPushToken[dead-ticket]",
            title: "Title",
            body: "Body",
          },
        ],
      },
      {
        url: "https://exp.host/--/api/v2/push/getReceipts",
        body: { ids: ["receipt-ok"] },
      },
    ]);
    expect(sendResult.receiptIds).toEqual(["receipt-ok"]);
    expect(sendResult.deviceNotRegisteredTokens).toEqual([
      "ExponentPushToken[dead-ticket]",
    ]);
    expect(receiptResult.deviceNotRegisteredReceiptIds).toEqual(["receipt-ok"]);
  });
});
