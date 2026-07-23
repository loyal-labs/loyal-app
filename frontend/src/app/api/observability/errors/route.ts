import {
  InvalidObservabilityEnvelopeError,
  isThirdPartyExtensionError,
  MAX_OBSERVABILITY_REQUEST_BYTES,
  parseBrowserErrorEnvelope,
} from "@/features/observability/error-contract";
import { consumeBrowserErrorRateLimit } from "@/features/observability/rate-limit.server";
import { reportBrowserErrorEnvelope } from "@/features/observability/server";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "cache-control": "no-store" } as const;

function jsonResponse(
  body: Readonly<Record<string, boolean | string>>,
  status: number
): Response {
  return Response.json(body, { headers: NO_STORE_HEADERS, status });
}

function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }

  try {
    if (new URL(origin).origin !== new URL(request.url).origin) {
      return false;
    }
  } catch {
    return false;
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin";
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
  if (!isSameOriginRequest(request)) {
    return jsonResponse({ error: "forbidden" }, 403);
  }
  if (!isJsonRequest(request)) {
    return jsonResponse({ error: "invalid_content_type" }, 415);
  }
  if (!consumeBrowserErrorRateLimit(request)) {
    return jsonResponse({ error: "rate_limited" }, 429);
  }

  try {
    const envelope = parseBrowserErrorEnvelope(await readJsonBody(request));
    // Browsers running a cached bundle still post extension noise; drop it here
    // too, and acknowledge so the client never treats telemetry as a failure.
    if (isThirdPartyExtensionError(envelope.operation, envelope.stack)) {
      return jsonResponse({ accepted: true }, 202);
    }
    await reportBrowserErrorEnvelope(envelope);
    return jsonResponse({ accepted: true }, 202);
  } catch (error) {
    if (error instanceof RangeError) {
      return jsonResponse({ error: "payload_too_large" }, 413);
    }
    return jsonResponse({ error: "invalid_request" }, 400);
  }
}
