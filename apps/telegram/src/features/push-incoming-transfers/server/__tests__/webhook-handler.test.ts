import { beforeAll, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let processHeliusWebhookPayload: typeof import("../webhook-handler").processHeliusWebhookPayload;
type HeliusEnhancedEvent = import("../webhook-handler").HeliusEnhancedEvent;
type ProcessDeps = import("../webhook-handler").ProcessDeps;

const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111112";

type RecordedCall = { name: string; args: unknown[] };

function makeDeps(overrides: {
  registeredAddresses?: Record<string, string>;
  mintMetadata?: Map<string, { symbol: string; decimals: number }>;
  alreadyDelivered?: Set<string>; // key = `${signature}::${wallet}`
  sendPushImpl?: (
    walletPublicKey: string,
    payload: unknown,
  ) => Promise<{ sentTo: number }>;
}): { deps: ProcessDeps; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const addresses = overrides.registeredAddresses ?? {};
  const mintMetadata = overrides.mintMetadata ?? new Map();
  const alreadyDelivered = overrides.alreadyDelivered ?? new Set<string>();
  const recordedDeliveries = new Set<string>();

  const deps: ProcessDeps = {
    async lookupWalletsForAddresses(addrs) {
      calls.push({ name: "lookupWalletsForAddresses", args: [addrs.slice()] });
      const result = new Map<string, string>();
      for (const addr of addrs) {
        const wallet = addresses[addr];
        if (wallet) {
          result.set(addr, wallet);
        }
      }
      return result;
    },
    async isDelivered(signature, walletPublicKey) {
      calls.push({
        name: "isDelivered",
        args: [signature, walletPublicKey],
      });
      const key = `${signature}::${walletPublicKey}`;
      return (
        alreadyDelivered.has(key) || recordedDeliveries.has(key)
      );
    },
    async recordDelivery(signature, walletPublicKey) {
      calls.push({
        name: "recordDelivery",
        args: [signature, walletPublicKey],
      });
      recordedDeliveries.add(`${signature}::${walletPublicKey}`);
    },
    async resolveMintMetadata(mints) {
      const mintsArr = Array.from(mints);
      calls.push({ name: "resolveMintMetadata", args: [mintsArr] });
      const out = new Map<string, { symbol: string; decimals: number }>();
      for (const mint of mintsArr) {
        const meta = mintMetadata.get(mint);
        if (meta) out.set(mint, meta);
      }
      return out;
    },
    async sendPushToWallet(walletPublicKey, payload) {
      calls.push({
        name: "sendPushToWallet",
        args: [walletPublicKey, payload],
      });
      if (overrides.sendPushImpl) {
        return overrides.sendPushImpl(walletPublicKey, payload);
      }
      return { sentTo: 1 };
    },
  };

  return { deps, calls };
}

function makeSolTransferEvent(args: {
  signature: string;
  from: string;
  to: string;
  lamports: number;
}): HeliusEnhancedEvent {
  return {
    type: "TRANSFER",
    signature: args.signature,
    timestamp: 1_700_000_000,
    nativeTransfers: [
      {
        fromUserAccount: args.from,
        toUserAccount: args.to,
        amount: args.lamports,
      },
    ],
  };
}

function makeSplTransferEvent(args: {
  signature: string;
  from: string;
  to: string;
  mint: string;
  tokenAmount: number;
}): HeliusEnhancedEvent {
  return {
    type: "TRANSFER",
    signature: args.signature,
    timestamp: 1_700_000_000,
    tokenTransfers: [
      {
        fromUserAccount: args.from,
        toUserAccount: args.to,
        mint: args.mint,
        tokenAmount: args.tokenAmount,
      },
    ],
  };
}

describe("processHeliusWebhookPayload", () => {
  beforeAll(async () => {
    ({ processHeliusWebhookPayload } = await import("../webhook-handler"));
  });

  test("dispatches sendPushToWallet for a SOL transfer; title contains amount", async () => {
    const wallet = "WaLLetSoLReCipient1111111111111111111111111";
    const recipientAddress = wallet; // SOL goes to wallet pubkey directly
    const { deps, calls } = makeDeps({
      registeredAddresses: { [recipientAddress]: wallet },
      mintMetadata: new Map([
        [NATIVE_SOL_MINT, { symbol: "SOL", decimals: 9 }],
      ]),
    });

    const event = makeSolTransferEvent({
      signature: "sig-sol-1",
      from: "SenderAddress11111111111111111111111111111",
      to: recipientAddress,
      lamports: 1_500_000_000, // 1.5 SOL
    });

    const stats = await processHeliusWebhookPayload([event], deps);

    expect(stats.notificationsSent).toBe(1);
    expect(stats.duplicates).toBe(0);
    expect(stats.unroutable).toBe(0);
    expect(stats.errors).toBe(0);

    const sendCall = calls.find((c) => c.name === "sendPushToWallet");
    expect(sendCall).toBeDefined();
    if (!sendCall) return;
    expect(sendCall.args[0]).toBe(wallet);
    const payload = sendCall.args[1] as { title: string };
    expect(payload.title).toContain("1.5");
    expect(payload.title).toContain("SOL");
  });

  test("skips duplicates idempotently — does not record or send when already delivered", async () => {
    const wallet = "WaLLetDuPliCate111111111111111111111111111";
    const { deps, calls } = makeDeps({
      registeredAddresses: { [wallet]: wallet },
      alreadyDelivered: new Set([`sig-dup-1::${wallet}`]),
      mintMetadata: new Map([
        [NATIVE_SOL_MINT, { symbol: "SOL", decimals: 9 }],
      ]),
    });

    const event = makeSolTransferEvent({
      signature: "sig-dup-1",
      from: "Sender",
      to: wallet,
      lamports: 1_000_000_000,
    });

    const stats = await processHeliusWebhookPayload([event], deps);

    expect(stats.duplicates).toBe(1);
    expect(stats.notificationsSent).toBe(0);
    expect(calls.find((c) => c.name === "recordDelivery")).toBeUndefined();
    expect(calls.find((c) => c.name === "sendPushToWallet")).toBeUndefined();
  });

  test("routes SPL transfers via tokenTransfers[].toUserAccount", async () => {
    const wallet = "WaLLetSpLReCipient1111111111111111111111111";
    const ataAddress = "AtAaDdRessForRecipient1111111111111111111111";
    const mint = "TokenMintForUsdc1111111111111111111111111111";

    const { deps, calls } = makeDeps({
      registeredAddresses: { [ataAddress]: wallet },
      mintMetadata: new Map([[mint, { symbol: "USDC", decimals: 6 }]]),
    });

    const event = makeSplTransferEvent({
      signature: "sig-spl-1",
      from: "Sender",
      to: ataAddress,
      mint,
      tokenAmount: 12.5,
    });

    const stats = await processHeliusWebhookPayload([event], deps);

    expect(stats.notificationsSent).toBe(1);
    expect(stats.unroutable).toBe(0);

    const sendCall = calls.find((c) => c.name === "sendPushToWallet");
    expect(sendCall).toBeDefined();
    if (!sendCall) return;
    expect(sendCall.args[0]).toBe(wallet);
    const payload = sendCall.args[1] as { title: string };
    expect(payload.title).toContain("USDC");
  });

  test("events with type !== 'TRANSFER' are ignored before any DB work", async () => {
    const wallet = "WaLLetSwapIgnored11111111111111111111111111";
    const { deps, calls } = makeDeps({
      registeredAddresses: { [wallet]: wallet },
    });

    const event: HeliusEnhancedEvent = {
      type: "SWAP",
      signature: "sig-swap-1",
      timestamp: 1_700_000_000,
      nativeTransfers: [
        {
          fromUserAccount: "Sender",
          toUserAccount: wallet,
          amount: 1_000_000_000,
        },
      ],
    };

    const stats = await processHeliusWebhookPayload([event], deps);

    expect(stats.notificationsSent).toBe(0);
    expect(stats.duplicates).toBe(0);
    expect(stats.unroutable).toBe(0);
    expect(stats.eventsReceived).toBe(1);

    // No address lookup, no metadata lookup, no send.
    expect(
      calls.find((c) => c.name === "lookupWalletsForAddresses"),
    ).toBeUndefined();
    expect(calls.find((c) => c.name === "sendPushToWallet")).toBeUndefined();
  });

  test("unroutable event (no recipient matches) increments unroutable, no send", async () => {
    const { deps, calls } = makeDeps({ registeredAddresses: {} });

    const event = makeSolTransferEvent({
      signature: "sig-unroutable-1",
      from: "Sender",
      to: "RandoStrangerAddress1111111111111111111111",
      lamports: 1_000_000_000,
    });

    const stats = await processHeliusWebhookPayload([event], deps);

    expect(stats.unroutable).toBe(1);
    expect(stats.notificationsSent).toBe(0);
    expect(calls.find((c) => c.name === "sendPushToWallet")).toBeUndefined();
  });

  test("per-event error isolation: a bad event increments errors, others process", async () => {
    const wallet = "WaLLetGoodEvent11111111111111111111111111";
    const { deps, calls } = makeDeps({
      registeredAddresses: { [wallet]: wallet },
      mintMetadata: new Map([
        [NATIVE_SOL_MINT, { symbol: "SOL", decimals: 9 }],
      ]),
    });

    const goodEvent = makeSolTransferEvent({
      signature: "sig-good-1",
      from: "Sender",
      to: wallet,
      lamports: 2_000_000_000,
    });

    // Forge a malformed event — tokenTransfers access throws. This
    // simulates a corrupted payload that should be isolated to the
    // single event without poisoning the rest of the batch.
    const badEvent = {
      type: "TRANSFER",
      signature: "sig-bad-1",
      timestamp: 1_700_000_000,
      get tokenTransfers(): never {
        throw new Error("forged: tokenTransfers getter explodes");
      },
    } as unknown as HeliusEnhancedEvent;

    const stats = await processHeliusWebhookPayload(
      [badEvent, goodEvent],
      deps,
    );

    expect(stats.errors).toBeGreaterThanOrEqual(1);
    expect(stats.notificationsSent).toBe(1);
    expect(calls.find((c) => c.name === "sendPushToWallet")).toBeDefined();
  });

  test("recordDelivery is called BEFORE sendPushToWallet", async () => {
    const wallet = "WaLLetCallOrder111111111111111111111111111";
    const { deps, calls } = makeDeps({
      registeredAddresses: { [wallet]: wallet },
      mintMetadata: new Map([
        [NATIVE_SOL_MINT, { symbol: "SOL", decimals: 9 }],
      ]),
    });

    const event = makeSolTransferEvent({
      signature: "sig-order-1",
      from: "Sender",
      to: wallet,
      lamports: 1_000_000_000,
    });

    await processHeliusWebhookPayload([event], deps);

    const recordIdx = calls.findIndex((c) => c.name === "recordDelivery");
    const sendIdx = calls.findIndex((c) => c.name === "sendPushToWallet");

    expect(recordIdx).toBeGreaterThanOrEqual(0);
    expect(sendIdx).toBeGreaterThanOrEqual(0);
    expect(recordIdx).toBeLessThan(sendIdx);
  });

  test("send dispatch is fire-and-catch: handler resolves before slow send completes", async () => {
    const wallet = "WaLLetSloWSend11111111111111111111111111111";

    let resolveSend: ((v: { sentTo: number }) => void) | null = null;
    const slowSend = new Promise<{ sentTo: number }>((resolve) => {
      resolveSend = resolve;
    });

    const { deps } = makeDeps({
      registeredAddresses: { [wallet]: wallet },
      mintMetadata: new Map([
        [NATIVE_SOL_MINT, { symbol: "SOL", decimals: 9 }],
      ]),
      sendPushImpl: () => slowSend,
    });

    const event = makeSolTransferEvent({
      signature: "sig-slow-1",
      from: "Sender",
      to: wallet,
      lamports: 1_000_000_000,
    });

    let handlerResolved = false;
    const handlerPromise = processHeliusWebhookPayload([event], deps).then(
      (stats) => {
        handlerResolved = true;
        return stats;
      },
    );

    // Yield to the microtask queue several times; if the handler awaited
    // the send promise it would still be pending. With fire-and-catch, it
    // should have resolved already.
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }
    // Also yield to the macrotask queue once to be generous.
    await new Promise((r) => setTimeout(r, 0));

    expect(handlerResolved).toBe(true);

    // Resolve the slow send so we don't leak the promise.
    expect(resolveSend).not.toBeNull();
    resolveSend?.({ sentTo: 1 });
    await handlerPromise;
  });
});
