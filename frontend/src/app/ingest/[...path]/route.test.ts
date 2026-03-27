import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const fetchMock = mock();

describe("Mixpanel ingest proxy route", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    fetchMock.mockReset();
  });

  test("forwards GET requests with query params", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("ok", {
        status: 200,
        headers: {
          "content-type": "text/plain",
        },
      })
    );

    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://askloyal.com/ingest/track/?verbose=1", {
        headers: {
          accept: "application/json",
        },
      }),
      { params: Promise.resolve({ path: ["track", ""] }) }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api-js.mixpanel.com/track/?verbose=1"
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
    });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toBeInstanceOf(Headers);
    expect(
      (fetchMock.mock.calls[0]?.[1]?.headers as Headers).get("accept")
    ).toBe("application/json");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  test("forwards client IP headers so Mixpanel can geolocate the end user", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("ok", {
        status: 200,
        headers: {
          "content-type": "text/plain",
        },
      })
    );

    const { POST } = await import("./route");
    await POST(
      new Request("https://askloyal.com/ingest/track/", {
        method: "POST",
        body: "payload-body",
        headers: {
          "cf-connecting-ip": "203.0.113.10",
          "x-forwarded-for": "203.0.113.10, 198.51.100.1",
          "x-real-ip": "203.0.113.10",
          "x-vercel-forwarded-for": "203.0.113.10",
        },
      }),
      { params: Promise.resolve({ path: ["track", ""] }) }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toBeInstanceOf(Headers);

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;

    expect(headers.get("cf-connecting-ip")).toBe("203.0.113.10");
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.10, 198.51.100.1");
    expect(headers.get("x-real-ip")).toBe("203.0.113.10");
    expect(headers.get("x-vercel-forwarded-for")).toBe("203.0.113.10");
  });

  test("forwards POST requests with body and content type", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"status":"ok"}', {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      })
    );

    const { POST } = await import("./route");
    await POST(
      new Request("https://askloyal.com/ingest/track/", {
        method: "POST",
        body: "payload-body",
        headers: {
          "content-type": "text/plain",
        },
      }),
      { params: Promise.resolve({ path: ["track", ""] }) }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api-js.mixpanel.com/track/"
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
    });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toBeInstanceOf(Headers);
    expect(
      (fetchMock.mock.calls[0]?.[1]?.headers as Headers).get("content-type")
    ).toBe("text/plain");
    const body = fetchMock.mock.calls[0]?.[1]?.body;
    expect(body).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(body as ArrayBuffer)).toBe("payload-body");
  });

  test("forwards OPTIONS requests", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 204,
        headers: {
          vary: "Origin",
        },
      })
    );

    const { OPTIONS } = await import("./route");
    const response = await OPTIONS(
      new Request("https://askloyal.com/ingest/decide/", {
        method: "OPTIONS",
      }),
      { params: Promise.resolve({ path: ["decide", ""] }) }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api-js.mixpanel.com/decide/"
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "OPTIONS",
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("vary")).toBe("Origin");
  });
});
