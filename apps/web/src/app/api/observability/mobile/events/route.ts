import {
  InvalidLifecycleEnvelopeError,
  MAX_LIFECYCLE_REQUEST_BYTES,
  parseMobileLifecycleEnvelope,
} from "@/features/observability/lifecycle-contract";
import { consumeBrowserLifecycleRateLimit } from "@/features/observability/rate-limit.server";
import { reportMobileLifecycleEnvelope } from "@/features/observability/server";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "cache-control": "no-store" } as const;

function jsonResponse(
  body: Readonly<Record<string, boolean | string>>,
  status: number
): Response {
  return Response.json(body, { headers: NO_STORE_HEADERS, status });
}

// Mirror image of the browser route's same-origin gate: native fetch never
// sends Origin or Sec-Fetch-Site, while browsers always send them on
// cross-site POSTs — so their presence marks traffic this route is not for.
function isNativeAppRequest(request: Request): boolean {
  return (
    !request.headers.get("origin") && !request.headers.get("sec-fetch-site")
  );
}

function isJsonRequest(request: Request): boolean {
  return (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim() ===
    "application/json"
  );
}

async function readJsonBody(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (!Number.isInteger(parsedLength) || parsedLength < 0) {
      throw new InvalidLifecycleEnvelopeError();
    }
    if (parsedLength > MAX_LIFECYCLE_REQUEST_BYTES) {
      throw new RangeError("Observability request is too large.");
    }
  }

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) throw new InvalidLifecycleEnvelopeError();
  if (body.byteLength > MAX_LIFECYCLE_REQUEST_BYTES) {
    throw new RangeError("Observability request is too large.");
  }

  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(body)
    ) as unknown;
  } catch {
    throw new InvalidLifecycleEnvelopeError();
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isNativeAppRequest(request)) {
    return jsonResponse({ error: "forbidden" }, 403);
  }
  if (!isJsonRequest(request)) {
    return jsonResponse({ error: "invalid_content_type" }, 415);
  }
  if (!consumeBrowserLifecycleRateLimit(request)) {
    return jsonResponse({ error: "rate_limited" }, 429);
  }

  try {
    const envelope = parseMobileLifecycleEnvelope(await readJsonBody(request));
    await reportMobileLifecycleEnvelope(envelope, envelope.walletAddress);
    return jsonResponse({ accepted: true }, 202);
  } catch (error) {
    if (error instanceof RangeError) {
      return jsonResponse({ error: "payload_too_large" }, 413);
    }
    return jsonResponse({ error: "invalid_request" }, 400);
  }
}
