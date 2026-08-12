import {
  InvalidMetricsEnvelopeError,
  MAX_METRICS_REQUEST_BYTES,
  parseMobileLoadingMetricEnvelope,
} from "@/features/observability/metrics-contract";
import { consumeBrowserMetricsRateLimit } from "@/features/observability/rate-limit.server";
import { reportMobileLoadingMetricEnvelope } from "@/features/observability/server";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "cache-control": "no-store" } as const;

function jsonResponse(
  body: Readonly<Record<string, boolean | string>>,
  status: number
): Response {
  return Response.json(body, { headers: NO_STORE_HEADERS, status });
}

// Native fetch does not send browser origin metadata. Rejecting either header
// keeps web pages from using this public, unauthenticated mobile relay.
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
      throw new InvalidMetricsEnvelopeError();
    }
    if (parsedLength > MAX_METRICS_REQUEST_BYTES) {
      throw new RangeError("Observability request is too large.");
    }
  }

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) throw new InvalidMetricsEnvelopeError();
  if (body.byteLength > MAX_METRICS_REQUEST_BYTES) {
    throw new RangeError("Observability request is too large.");
  }

  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(body)
    ) as unknown;
  } catch {
    throw new InvalidMetricsEnvelopeError();
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isNativeAppRequest(request)) {
    return jsonResponse({ error: "forbidden" }, 403);
  }
  if (!isJsonRequest(request)) {
    return jsonResponse({ error: "invalid_content_type" }, 415);
  }
  if (!consumeBrowserMetricsRateLimit(request)) {
    return jsonResponse({ error: "rate_limited" }, 429);
  }

  try {
    const envelope = parseMobileLoadingMetricEnvelope(
      await readJsonBody(request)
    );
    await reportMobileLoadingMetricEnvelope(envelope);
    return jsonResponse({ accepted: true }, 202);
  } catch (error) {
    if (error instanceof RangeError) {
      return jsonResponse({ error: "payload_too_large" }, 413);
    }
    return jsonResponse({ error: "invalid_request" }, 400);
  }
}
