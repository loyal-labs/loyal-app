import "server-only";

const HELIUS_API_HOST = "https://api.helius.xyz";

export type HeliusWebhookSummary = { webhookId: string };

type HeliusWebhookCreateResponse = {
  webhookID: string;
};

async function readResponseBody(res: Response): Promise<string> {
  return await res.text().catch(() => "");
}

function buildHeliusError(
  opName: string,
  status: number,
  body: string
): Error {
  return new Error(`Helius ${opName} ${status}: ${body}`);
}

export async function createHeliusWebhook(args: {
  apiKey: string;
  webhookUrl: string;
  authHeader: string;
  accountAddresses: string[];
}): Promise<HeliusWebhookSummary> {
  const { accountAddresses, apiKey, authHeader, webhookUrl } = args;
  const url = `${HELIUS_API_HOST}/v0/webhooks?api-key=${apiKey}`;

  const res = await fetch(url, {
    body: JSON.stringify({
      accountAddresses,
      authHeader,
      transactionTypes: ["TRANSFER"],
      webhookType: "enhanced",
      webhookURL: webhookUrl,
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });

  if (!res.ok) {
    const body = await readResponseBody(res);
    throw buildHeliusError("createWebhook", res.status, body);
  }

  const data = (await res.json()) as HeliusWebhookCreateResponse;
  return { webhookId: data.webhookID };
}

export async function patchHeliusWebhookAddresses(args: {
  apiKey: string;
  heliusWebhookId: string;
  accountAddresses: string[];
}): Promise<void> {
  const { accountAddresses, apiKey, heliusWebhookId } = args;
  const url = `${HELIUS_API_HOST}/v0/webhooks/${heliusWebhookId}?api-key=${apiKey}`;

  const res = await fetch(url, {
    body: JSON.stringify({
      accountAddresses,
      transactionTypes: ["TRANSFER"],
      webhookType: "enhanced",
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "PUT",
  });

  if (!res.ok) {
    const body = await readResponseBody(res);
    throw buildHeliusError("patchWebhookAddresses", res.status, body);
  }
}

export async function deleteHeliusWebhook(
  apiKey: string,
  heliusWebhookId: string
): Promise<void> {
  const url = `${HELIUS_API_HOST}/v0/webhooks/${heliusWebhookId}?api-key=${apiKey}`;

  const res = await fetch(url, {
    method: "DELETE",
  });

  if (res.ok) return;
  if (res.status === 404) return;

  const body = await readResponseBody(res);
  throw buildHeliusError("deleteWebhook", res.status, body);
}
