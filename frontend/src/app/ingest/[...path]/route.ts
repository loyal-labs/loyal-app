const MIXPANEL_API_ORIGIN = "https://api-js.mixpanel.com";
const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "cf-connecting-ip",
  "content-type",
  "forwarded",
  "origin",
  "referer",
  "user-agent",
  "x-forwarded-for",
  "x-real-ip",
  "x-vercel-forwarded-for",
] as const;
const FORWARDED_RESPONSE_HEADERS = [
  "cache-control",
  "content-encoding",
  "content-length",
  "content-type",
  "date",
  "etag",
  "vary",
] as const;

function buildUpstreamUrl(request: Request, path: string[]): URL {
  const requestUrl = new URL(request.url);
  const upstreamUrl = new URL(`${MIXPANEL_API_ORIGIN}/${path.join("/")}`);
  upstreamUrl.search = requestUrl.search;
  return upstreamUrl;
}

function buildUpstreamHeaders(request: Request): Headers {
  const headers = new Headers();

  for (const headerName of FORWARDED_REQUEST_HEADERS) {
    const headerValue = request.headers.get(headerName);
    if (headerValue) {
      headers.set(headerName, headerValue);
    }
  }

  return headers;
}

function buildResponseHeaders(headers: Headers): Headers {
  const nextHeaders = new Headers();

  for (const headerName of FORWARDED_RESPONSE_HEADERS) {
    const headerValue = headers.get(headerName);
    if (headerValue) {
      nextHeaders.set(headerName, headerValue);
    }
  }

  return nextHeaders;
}

async function proxyMixpanelRequest(
  request: Request,
  path: string[]
): Promise<Response> {
  const upstreamResponse = await fetch(buildUpstreamUrl(request, path), {
    method: request.method,
    headers: buildUpstreamHeaders(request),
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer(),
    redirect: "manual",
  });

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: buildResponseHeaders(upstreamResponse.headers),
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyMixpanelRequest(request, path);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyMixpanelRequest(request, path);
}

export async function OPTIONS(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyMixpanelRequest(request, path);
}
