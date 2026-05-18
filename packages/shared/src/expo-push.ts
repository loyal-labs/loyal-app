const EXPO_PUSH_SEND_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_PUSH_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const DEVICE_NOT_REGISTERED = "DeviceNotRegistered";

export type ExpoPushMessage = {
  to: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
};

export type ExpoPushTicket = {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string; [key: string]: unknown };
};

export type ExpoPushReceipt = {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string; [key: string]: unknown };
};

export type ExpoPushSentTicket = {
  token: string;
  ticket: ExpoPushTicket;
};

export type ExpoPushSendResult = {
  requested: number;
  tickets: ExpoPushSentTicket[];
  receiptIds: string[];
  deviceNotRegisteredTokens: string[];
};

export type ExpoPushReceiptResult = {
  receipts: Record<string, ExpoPushReceipt>;
  deviceNotRegisteredReceiptIds: string[];
};

type FetchLike = typeof fetch;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isExpoPushTicket(value: unknown): value is ExpoPushTicket {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "ok" || status === "error";
}

function isExpoPushReceipt(value: unknown): value is ExpoPushReceipt {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "ok" || status === "error";
}

function hasDeviceNotRegisteredError(
  item: ExpoPushTicket | ExpoPushReceipt
): boolean {
  return item.details?.error === DEVICE_NOT_REGISTERED;
}

export async function sendExpoPushMessages(
  messages: ExpoPushMessage[],
  options: { fetchFn?: FetchLike } = {}
): Promise<ExpoPushSendResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const tickets: ExpoPushSentTicket[] = [];
  const receiptIds: string[] = [];
  const deviceNotRegisteredTokens: string[] = [];

  for (const messageChunk of chunk(messages, 100)) {
    const response = await fetchFn(EXPO_PUSH_SEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(messageChunk),
    });

    if (!response.ok) {
      throw new Error(
        `Expo Push API failed with ${response.status}: ${await response.text()}`
      );
    }

    const payload = (await response.json()) as { data?: unknown };
    const payloadTickets = Array.isArray(payload.data) ? payload.data : [];

    for (const [index, rawTicket] of payloadTickets.entries()) {
      if (!isExpoPushTicket(rawTicket)) continue;

      const token = messageChunk[index]?.to;
      if (!token) continue;

      tickets.push({ token, ticket: rawTicket });

      if (rawTicket.status === "ok" && rawTicket.id) {
        receiptIds.push(rawTicket.id);
      }

      if (
        rawTicket.status === "error" &&
        hasDeviceNotRegisteredError(rawTicket)
      ) {
        deviceNotRegisteredTokens.push(token);
      }
    }
  }

  return {
    requested: messages.length,
    tickets,
    receiptIds,
    deviceNotRegisteredTokens,
  };
}

export async function getExpoPushReceipts(
  receiptIds: string[],
  options: { fetchFn?: FetchLike } = {}
): Promise<ExpoPushReceiptResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const receipts: Record<string, ExpoPushReceipt> = {};
  const deviceNotRegisteredReceiptIds: string[] = [];

  for (const idChunk of chunk(receiptIds, 1000)) {
    if (idChunk.length === 0) continue;

    const response = await fetchFn(EXPO_PUSH_RECEIPTS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ ids: idChunk }),
    });

    if (!response.ok) {
      throw new Error(
        `Expo Push receipts API failed with ${
          response.status
        }: ${await response.text()}`
      );
    }

    const payload = (await response.json()) as { data?: unknown };
    const payloadReceipts =
      payload.data && typeof payload.data === "object" ? payload.data : {};

    for (const [receiptId, rawReceipt] of Object.entries(payloadReceipts)) {
      if (!isExpoPushReceipt(rawReceipt)) continue;

      receipts[receiptId] = rawReceipt;
      if (
        rawReceipt.status === "error" &&
        hasDeviceNotRegisteredError(rawReceipt)
      ) {
        deviceNotRegisteredReceiptIds.push(receiptId);
      }
    }
  }

  return { receipts, deviceNotRegisteredReceiptIds };
}
