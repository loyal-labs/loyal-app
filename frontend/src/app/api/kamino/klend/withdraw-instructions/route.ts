const KAMINO_WITHDRAW_INSTRUCTIONS_URL =
  "https://api.kamino.finance/ktx/klend/withdraw-instructions";

function copyResponseHeaders(response: Response): Headers {
  const headers = new Headers();
  const contentType = response.headers.get("content-type");

  if (contentType) {
    headers.set("content-type", contentType);
  }

  return headers;
}

export async function POST(request: Request) {
  try {
    const body = await request.text();
    const response = await fetch(KAMINO_WITHDRAW_INSTRUCTIONS_URL, {
      body,
      cache: "no-store",
      headers: {
        accept: request.headers.get("accept") ?? "application/json",
        "content-type":
          request.headers.get("content-type") ?? "application/json",
      },
      method: "POST",
    });

    return new Response(await response.text(), {
      headers: copyResponseHeaders(response),
      status: response.status,
      statusText: response.statusText,
    });
  } catch (error) {
    console.error("[kamino-withdraw-instructions] proxy failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown proxy error.",
      errorName: error instanceof Error ? error.name : typeof error,
      stack: error instanceof Error ? error.stack : undefined,
    });

    return Response.json(
      {
        error: {
          code: "kamino_proxy_failed",
          message: "Kamino request failed.",
        },
      },
      { status: 502 }
    );
  }
}
