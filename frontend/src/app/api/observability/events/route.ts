import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { deriveObservabilityActorId } from "@/features/observability/actor";
import {
  InvalidLifecycleEnvelopeError,
  MAX_LIFECYCLE_REQUEST_BYTES,
  parseBrowserLifecycleEnvelope,
} from "@/features/observability/lifecycle-contract";
import { consumeBrowserLifecycleRateLimit } from "@/features/observability/rate-limit.server";
import {
  getObservabilityDeploymentEnvironment,
  reportBrowserLifecycleEnvelope,
} from "@/features/observability/server";

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
  if (!origin) return false;
  try {
    if (new URL(origin).origin !== new URL(request.url).origin) return false;
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

async function resolveActorId(request: Request): Promise<string | undefined> {
  try {
    const principal = await resolveAuthenticatedPrincipalFromRequest(request);
    if (!principal) return undefined;
    const secret = process.env.OBSERVABILITY_ACTOR_HMAC_SECRET ?? "";
    return (
      deriveObservabilityActorId({
        deploymentEnvironment: getObservabilityDeploymentEnvironment(),
        secret,
        walletAddress: principal.walletAddress,
      }) ?? undefined
    );
  } catch {
    return undefined;
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return jsonResponse({ error: "forbidden" }, 403);
  }
  if (!isJsonRequest(request)) {
    return jsonResponse({ error: "invalid_content_type" }, 415);
  }
  if (!consumeBrowserLifecycleRateLimit(request)) {
    return jsonResponse({ error: "rate_limited" }, 429);
  }

  try {
    const envelope = parseBrowserLifecycleEnvelope(await readJsonBody(request));
    const actorId = await resolveActorId(request);
    await reportBrowserLifecycleEnvelope(envelope, actorId);
    return jsonResponse({ accepted: true }, 202);
  } catch (error) {
    if (error instanceof RangeError) {
      return jsonResponse({ error: "payload_too_large" }, 413);
    }
    return jsonResponse({ error: "invalid_request" }, 400);
  }
}
