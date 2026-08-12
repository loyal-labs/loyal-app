import {
  InvalidObservabilityEnvelopeError,
  MAX_OBSERVABILITY_REQUEST_BYTES,
  parseMobileErrorEnvelope,
} from "@/features/observability/error-contract";
import { consumeBrowserErrorRateLimit } from "@/features/observability/rate-limit.server";
import { reportMobileErrorEnvelope } from "@/features/observability/server";

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
      throw new InvalidObservabilityEnvelopeError();
    }
    if (parsedLength > MAX_OBSERVABILITY_REQUEST_BYTES) {
      throw new RangeError("Observability request is too large.");
    }
  }

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) {
    throw new InvalidObservabilityEnvelopeError();
  }
  if (body.byteLength > MAX_OBSERVABILITY_REQUEST_BYTES) {
    throw new RangeError("Observability request is too large.");
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    return JSON.parse(text) as unknown;
  } catch {
    throw new InvalidObservabilityEnvelopeError();
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isNativeAppRequest(request)) {
    return jsonResponse({ error: "forbidden" }, 403);
  }
  if (!isJsonRequest(request)) {
    return jsonResponse({ error: "invalid_content_type" }, 415);
  }
  if (!consumeBrowserErrorRateLimit(request)) {
    return jsonResponse({ error: "rate_limited" }, 429);
  }

  try {
    const envelope = parseMobileErrorEnvelope(await readJsonBody(request));
    await reportMobileErrorEnvelope(envelope);
    return jsonResponse({ accepted: true }, 202);
  } catch (error) {
    if (error instanceof RangeError) {
      return jsonResponse({ error: "payload_too_large" }, 413);
    }
    return jsonResponse({ error: "invalid_request" }, 400);
  }
}
