import { describe, expect, test } from "bun:test";

import {
  normalizeLifecycleWalletProvider,
  parseBrowserLifecycleEnvelope,
} from "./lifecycle-contract";

// `walletProvider` names the wallet adapter behind a sign-in attempt. Same
// invariants as `errorDetail`: a closed token set so no adapter-controlled
// string reaches the exported attribute, and drop-not-reject at the ingest
// boundary so a bad annotation never costs the event it describes.

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    durationMs: 10,
    elapsedMs: 10,
    errorCode: "wallet_signing_failed",
    flowId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
    flowName: "auth.sign_in",
    flowVariant: "interactive",
    outcome: "failed",
    pathname: "/app",
    runtime: "browser",
    source: "browser",
    stage: "completion",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("normalizeLifecycleWalletProvider", () => {
  test("maps adapter display names to tokens", () => {
    const cases = [
      // The Loyal extension's own wallet-standard registration name
      // (extension/entrypoints/loyal-wallet-provider.content.ts).
      ["Loyal", "loyal"],
      ["Phantom", "phantom"],
      ["Coinbase Wallet", "coinbase_wallet"],
      ["Magic Eden", "magic_eden"],
      ["OKX Wallet", "okx_wallet"],
    ] as const;
    for (const [name, token] of cases) {
      expect(normalizeLifecycleWalletProvider(name)).toBe(token);
    }
  });

  test("collapses unknown adapter names into other", () => {
    expect(normalizeLifecycleWalletProvider("SuperWallet 3000")).toBe("other");
  });

  test.each([
    ["a non-string value", 42],
    ["null", null],
    ["undefined", undefined],
    ["a blank name", "  "],
  ])("leaves %s unset", (_label, value) => {
    expect(normalizeLifecycleWalletProvider(value)).toBeUndefined();
  });
});

describe("lifecycle walletProvider", () => {
  test("is accepted on the envelope", () => {
    const parsed = parseBrowserLifecycleEnvelope(
      envelope({ walletProvider: "phantom" })
    );

    expect(parsed.walletProvider).toBe("phantom");
    expect(parsed.errorCode).toBe("wallet_signing_failed");
  });

  // The boundary never buckets into `other` — an arbitrary forged string is
  // dropped, since mapping display names onto tokens is the emitter's job.
  test.each([
    ["a raw adapter name", "Coinbase Wallet"],
    ["a wallet address", "BGtzTW2yczjR7FCpSvKfcjxCw811Rdori8aY96ZJdQ51"],
    ["a non-string value", 42],
  ])("drops %s without failing the envelope", (_label, walletProvider) => {
    const parsed = parseBrowserLifecycleEnvelope(envelope({ walletProvider }));

    expect(parsed.walletProvider).toBeUndefined();
    expect(parsed.errorCode).toBe("wallet_signing_failed");
  });

  test("is optional", () => {
    expect(
      parseBrowserLifecycleEnvelope(envelope()).walletProvider
    ).toBeUndefined();
  });
});
