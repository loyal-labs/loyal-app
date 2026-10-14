import { reportTelemetryHeartbeat } from "@/features/observability/server";

import { validateCronAuthHeader } from "../_shared/auth";

export async function GET(request: Request): Promise<Response> {
  const denied = validateCronAuthHeader(request);
  if (denied) return denied;
  const delivered = await reportTelemetryHeartbeat();
  return Response.json(
    { delivered },
    { status: delivered ? 200 : 503, headers: { "cache-control": "no-store" } }
  );
}
