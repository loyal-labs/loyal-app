import { resolveDappRequest } from "../model/request-controller";

describe("resolveDappRequest", () => {
  it("immediately allows disconnect requests", () => {
    expect(
      resolveDappRequest({
        origin: "https://jup.ag",
        connectedOrigins: [],
        trustedOrigins: ["https://jup.ag"],
        request: {
          source: "loyal-mobile-wallet",
          id: "req-1",
          type: "disconnect",
        },
      }),
    ).toEqual({
      kind: "response",
      response: {
        source: "loyal-mobile-wallet",
        id: "req-1",
        ok: true,
      },
    });
  });

  it("immediately allows connect requests for remembered origins", () => {
    expect(
      resolveDappRequest({
        origin: "https://jup.ag",
        connectedOrigins: ["https://jup.ag"],
        trustedOrigins: [],
        request: {
          source: "loyal-mobile-wallet",
          id: "req-2",
          type: "connect",
        },
      }),
    ).toEqual({
      kind: "response",
      response: {
        source: "loyal-mobile-wallet",
        id: "req-2",
        ok: true,
      },
    });
  });

  it("rejects signing requests before connect", () => {
    expect(
      resolveDappRequest({
        origin: "https://jup.ag",
        connectedOrigins: [],
        trustedOrigins: ["https://jup.ag"],
        request: {
          source: "loyal-mobile-wallet",
          id: "req-3",
          type: "signMessage",
        },
      }),
    ).toEqual({
      kind: "response",
      response: {
        source: "loyal-mobile-wallet",
        id: "req-3",
        ok: false,
        error: "Not connected. Call connect() first.",
      },
    });
  });

  it("returns pending approval for connect requests from untrusted origins", () => {
    expect(
      resolveDappRequest({
        origin: "https://example.com",
        connectedOrigins: [],
        trustedOrigins: ["https://jup.ag"],
        request: {
          source: "loyal-mobile-wallet",
          id: "req-4",
          type: "connect",
        },
      }),
    ).toEqual({
      kind: "approval",
      approval: {
        requestId: "req-4",
        origin: "https://example.com",
        trustState: "untrusted",
        type: "connect",
      },
    });
  });

  it("derives trusted approval state from the origin", () => {
    expect(
      resolveDappRequest({
        origin: "https://jup.ag",
        connectedOrigins: [],
        trustedOrigins: ["https://jup.ag"],
        request: {
          source: "loyal-mobile-wallet",
          id: "req-5",
          type: "connect",
        },
      }),
    ).toEqual({
      kind: "approval",
      approval: {
        requestId: "req-5",
        origin: "https://jup.ag",
        trustState: "trusted",
        type: "connect",
      },
    });
  });

  it("surfaces typed approval payload fields for sign requests", () => {
    expect(
      resolveDappRequest({
        origin: "https://jup.ag",
        connectedOrigins: ["https://jup.ag"],
        trustedOrigins: ["https://jup.ag"],
        request: {
          source: "loyal-mobile-wallet",
          id: "req-6",
          type: "signMessage",
          payload: { message: "aGVsbG8=" },
        },
      }),
    ).toEqual({
      kind: "approval",
      approval: {
        requestId: "req-6",
        origin: "https://jup.ag",
        trustState: "trusted",
        type: "signMessage",
        messageBase64: "aGVsbG8=",
      },
    });
  });

  it("returns an error response when sign payload is missing", () => {
    expect(
      resolveDappRequest({
        origin: "https://jup.ag",
        connectedOrigins: ["https://jup.ag"],
        trustedOrigins: ["https://jup.ag"],
        request: {
          source: "loyal-mobile-wallet",
          id: "req-7",
          type: "signTransaction",
        },
      }),
    ).toEqual({
      kind: "response",
      response: {
        source: "loyal-mobile-wallet",
        id: "req-7",
        ok: false,
        error: "signTransaction requires a base64 'transaction' payload.",
      },
    });
  });
});
