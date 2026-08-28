import { NextResponse } from "next/server";
import { getPublicRpcUrl } from "@/lib/constants";
import { enforceSameOrigin } from "@/lib/server/sponsor";
import { SponsorRequestError } from "@/lib/sponsor-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_CHARS = 200_000;

/** Same-origin JSON-RPC passthrough. The browser cannot call the shared
 *  keyless endpoint directly (CORS, rate limits), so it speaks to this
 *  route and the server forwards on its own transport: the dedicated keyed
 *  endpoint when mounted, with a per-request fallback to the frozen keyless
 *  URL when the dedicated one rejects. The key never reaches the browser. */
export async function POST(request: Request) {
  try {
    enforceSameOrigin(request);
  } catch (error) {
    if (error instanceof SponsorRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
  const body = await request.text();
  if (body.length > MAX_BODY_CHARS) {
    return NextResponse.json({ error: "RPC request is too large." }, { status: 413 });
  }
  const dedicated = process.env.DEMO_SERVER_RPC_URL;
  const upstreams = dedicated ? [dedicated, getPublicRpcUrl()] : [getPublicRpcUrl()];
  let lastStatus = 502;
  for (const upstream of upstreams) {
    const response = await fetch(upstream, {
      body,
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (response.ok) {
      return new NextResponse(await response.text(), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }
    lastStatus = response.status;
  }
  return NextResponse.json(
    { error: "Every RPC upstream rejected the request." },
    { status: lastStatus === 429 ? 429 : 502 }
  );
}
