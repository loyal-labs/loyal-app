/** Controlled real-component checks. Every nonlocal request is mocked or aborted. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { chromium } from "playwright-core";
const base = new URL(process.env.LOYAL_VAULT_DEMO_BROWSER_BASE_URL ?? "http://127.0.0.1:3037");
assert(base.protocol === "http:" && base.hostname === "127.0.0.1" && base.pathname === "/", "Browser verifier accepts only a local dev server root");
const session = `loyal-vault-check-${process.pid}`;
const cli = (...args) => execFileSync("bunx", ["agent-browser", "--session", session, ...args], { encoding: "utf8", timeout: 30000 });
const buildFixture = (wallet, hashByte = "2") => JSON.parse(execFileSync("bun", [fileURLToPath(new URL("./fixture.ts", import.meta.url)), wallet, hashByte], { encoding: "utf8", timeout: 10000 }));
let browser, context, fixture, secondFixture, submissions = 0, blockedOther = 0;
const mode = { expired: false, unknown: false, pauseQuote: false, vaultUnavailable: false, workerAvailable: false, finalizedFailure: false };
let releaseQuote;
const readCounts = new Map();
try {
  cli("open", "about:blank");
  const cdp = cli("get", "cdp-url").trim();
  assert(new URL(cdp).hostname === "127.0.0.1", "Local browser connection required");
  browser = await chromium.connectOverCDP(cdp, { timeout: 10000 });
  context = browser.contexts()[0];
  context.setDefaultTimeout(10000);
  await context.addInitScript({ content: "window.__staticWalletFixture=" + readFileSync(new URL("./wallet.json", import.meta.url), "utf8") + ";\n" + readFileSync(new URL("./wallet-init.js", import.meta.url), "utf8") });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
    if (url.origin === base.origin) {
      if (!url.pathname.startsWith("/api/")) return route.continue();
      readCounts.set(url.pathname, (readCounts.get(url.pathname) ?? 0) + 1);
      if (!fixture) return json({ unavailable: true, reason: "Fixture initializing" }, 503);
      if (url.pathname === "/api/vault") return mode.vaultUnavailable ? json({ unavailable: true, reason: "Controlled RPC failure" }, 503) : json(fixture.vault);
      if (url.pathname === "/api/position") {
        const position = [fixture.position, secondFixture?.position].find(value => value?.wallet === url.searchParams.get("wallet"));
        return position ? json(position) : json({}, 503);
      }
      if (url.pathname === "/api/worker" && mode.workerAvailable) return json({ source: "yield-worker-journal", observedAt: new Date().toISOString(), observedSlot: "1", leaseActive: true, freshness: "fresh", routeStatus: "idle", operation: null });
      if (url.pathname === "/api/holdings") return json({ observedSlot: 1, observedAt: new Date().toISOString(), owner: fixture.vault.identity.manager, holdings: [] });
      if (url.pathname === "/api/kamino") return json({ observedSlot: 1, observedAt: new Date().toISOString(), owner: fixture.vault.identity.manager, coverage: "owner-scan", positions: [], unrecognized: [] });
      if (url.pathname === "/api/transactions/prepare") {
        if (mode.pauseQuote) await new Promise(resolve => { releaseQuote = resolve; });
        const quote = structuredClone(fixture.quote), now = new Date().toISOString();
        quote.quote.preparedAt = quote.observation.vaultObservedAt = quote.observation.positionObservedAt = now;
        return json(quote).catch(() => {});
      }
      if (url.pathname === "/api/transactions/status" && mode.finalizedFailure) return json({ schemaVersion: "loyal-vault-demo.transaction-status/1", state: "failed", finalized: true, action: "claim", wallet: url.searchParams.get("wallet"), signature: url.searchParams.get("signature"), observation: { messageSha256: fixture.quote.transaction.messageSha256 }, reason: "Controlled finalized failure" });
      if (url.pathname === "/api/transactions/status" && mode.unknown) return json({ schemaVersion: "loyal-vault-demo.transaction-status/1", state: "unknown", finalized: false, action: null,
        wallet: url.searchParams.get("wallet"), signature: url.searchParams.get("signature"), observation: {}, reason: "Controlled absent signature" });
      return json({ unavailable: true, reason: "Controlled unavailable service" }, 503);
    }
    if (url.hostname === "solana-rpc.publicnode.com") {
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" } });
      let body; try { body = request.postDataJSON(); } catch { return route.abort("blockedbyclient"); }
      if (body.method === "sendTransaction") { submissions++; return route.abort("failed"); }
      const result = body.method === "getGenesisHash" ? "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" :
        body.method === "isBlockhashValid" ? { context: { slot: 2 }, value: !mode.expired } :
        body.method === "getSignatureStatuses" ? { context: { slot: 2 }, value: [null] } : null;
      return json({ jsonrpc: "2.0", id: body.id, result });
    }
    blockedOther++; return route.abort("blockedbyclient");
  });
  const page = context.pages()[0];
  await page.goto(base.href, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__recoveryVerifier?.address);
  const wallet = await page.evaluate(() => window.__recoveryVerifier.address);
  fixture = buildFixture(wallet);
  let secondBytes = new Uint8Array(32).fill(4);
  while (!PublicKey.isOnCurve(secondBytes)) secondBytes[0]++;
  const secondWallet = new PublicKey(secondBytes).toBase58();
  secondFixture = buildFixture(secondWallet);
  // Distinct pending receipt amounts make accidental cross-wallet display observable.
  secondFixture.position.receipt.assetEffectiveRaw = "2000000";
  const switchTo = async (address, bytes) => {
    await page.evaluate(({ address, bytes }) => window.__recoveryVerifier.switchAccount(address, bytes), { address, bytes: Array.from(bytes) });
    await page.waitForFunction(address => window.__recoveryVerifier.activeAddress === address, address);
    await page.waitForTimeout(100);
  };
  const firstBytes = await page.evaluate(() => Array.from(window.__recoveryVerifier.publicKey));
  // Refresh fixture-dependent reads without resetting the test wallet.
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  const connect = async target => {
    const connectButton = target.getByRole("button", { name: "Connect wallet", exact: true }).first();
    for (let attempt = 0; attempt < 20 && await connectButton.getAttribute("aria-expanded") !== "true"; attempt++) {
      await connectButton.click();
      await target.waitForTimeout(100);
    }
    assert.equal(await connectButton.getAttribute("aria-expanded"), "true", "Wallet menu must be interactive");
    await target.getByRole("button", { name: "Unfunded recovery verifier", exact: true }).click();
    const claimTab = target.getByRole("tab", { name: "Claim", exact: true });
    if (await claimTab.getAttribute("aria-selected") !== "true") await claimTab.click();
  };
  const record = target => target.evaluate(() => JSON.parse(localStorage.getItem("loyal-vault-demo:pending-transaction:" + window.__recoveryVerifier.address)));
  await connect(page);
  const paths = ["/api/vault", "/api/position", "/api/kamino", "/api/worker", "/api/holdings"];
  await page.waitForTimeout(100);
  mode.workerAvailable = true;
  const beforeRefresh = paths.map(path => readCounts.get(path) ?? 0);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  for (let attempt = 0; attempt < 100 && paths.some((path, index) => (readCounts.get(path) ?? 0) <= beforeRefresh[index]); attempt++) await page.waitForTimeout(20);
  paths.forEach((path, index) => assert((readCounts.get(path) ?? 0) > beforeRefresh[index], `Manual refresh must include ${path}`));
  await page.waitForFunction(() => document.body.textContent.includes("A manager is assigned to service this vault."));
  // Controlled visibility transition exercises the real hooks, not native OS tab management.
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    window.__readHidden = true;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => window.__readHidden });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(100);
  const hiddenCounts = paths.map(path => readCounts.get(path) ?? 0);
  await page.waitForTimeout(5_500);
  paths.forEach((path, index) => assert.equal(readCounts.get(path) ?? 0, hiddenCounts[index], `Hidden dashboard must stop scheduled ${path} reads`));
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  for (let attempt = 0; attempt < 100 && paths.some((path, index) => (readCounts.get(path) ?? 0) <= hiddenCounts[index]); attempt++) await page.waitForTimeout(20);
  paths.forEach((path, index) => assert((readCounts.get(path) ?? 0) > hiddenCounts[index], `Visible dashboard must resume ${path} reads`));
  mode.workerAvailable = false;
  mode.vaultUnavailable = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.waitForFunction(() => document.body.textContent.includes("Last successful vault read:"));
  assert(!(await page.locator(".overview").innerText()).includes("USDC"), "Failed read must hide unavailable balances rather than present cached values as current");
  mode.vaultUnavailable = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".overview")?.textContent.includes("USDC"));
  mode.pauseQuote = true;
  await page.getByRole("button", { name: "Review claim", exact: true }).click();
  for (let attempt = 0; attempt < 100 && !releaseQuote; attempt++) await page.waitForTimeout(20);
  assert(releaseQuote, "Quote request must reach the controlled delay");
  await page.getByRole("button", { name: /Disconnect/ }).click();
  mode.pauseQuote = false; releaseQuote();
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole("button", { name: "Sign claim in wallet", exact: true }).count(), 0);
  assert.equal(await record(page), null);
  assert.equal(submissions, 0);
  await connect(page);
  mode.pauseQuote = true; releaseQuote = undefined;
  await page.getByRole("button", { name: "Review claim", exact: true }).click();
  for (let attempt = 0; attempt < 100 && !releaseQuote; attempt++) await page.waitForTimeout(20);
  assert(releaseQuote, "Second quote must reach the controlled delay");
  await switchTo(secondWallet, secondBytes);
  mode.pauseQuote = false; releaseQuote();
  await page.waitForFunction(() => document.querySelector(".claim-amount")?.textContent.trim().startsWith("2 "));
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole("button", { name: "Sign claim in wallet", exact: true }).count(), 0);
  assert.equal(await record(page), null);
  assert.equal(submissions, 0, "Late A quote cannot become an executable quote for B");
  assert.equal(await page.evaluate(() => window.__recoveryVerifier.signCalls), 0);
  await switchTo(wallet, firstBytes);
  await page.evaluate(() => { window.__recoveryVerifier.refuse = true; });
  await page.getByRole("button", { name: "Review claim", exact: true }).click();
  await page.getByRole("button", { name: "Sign claim in wallet", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#vault-action-panel")?.textContent.includes("Controlled signature refusal"));
  assert.equal(await record(page), null);
  assert.equal(submissions, 0);
  await page.evaluate(() => { window.__recoveryVerifier.refuse = false; window.__recoveryVerifier.hold = true; });
  await page.getByRole("button", { name: "Review claim", exact: true }).click();
  await page.getByRole("button", { name: "Sign claim in wallet", exact: true }).click();
  await page.waitForFunction(() => typeof window.__recoveryVerifier.releaseSigning === "function");
  await page.getByRole("button", { name: /Disconnect/ }).click();
  await page.evaluate(() => { window.__recoveryVerifier.hold = false; window.__recoveryVerifier.releaseSigning(); });
  await page.waitForTimeout(100);
  assert.equal(await record(page), null);
  assert.equal(submissions, 0, "Late wallet response after disconnect must not submit");
  await connect(page);
  // A -> B -> A must invalidate an in-flight signature even when A returns.
  await page.evaluate(() => { window.__recoveryVerifier.hold = true; delete window.__recoveryVerifier.releaseSigning; });
  await page.getByRole("button", { name: "Review claim", exact: true }).click();
  await page.getByRole("button", { name: "Sign claim in wallet", exact: true }).click();
  await page.waitForFunction(() => typeof window.__recoveryVerifier.releaseSigning === "function");
  await switchTo(secondWallet, secondBytes);
  assert.equal(await page.getByRole("button", { name: "Sign claim in wallet", exact: true }).count(), 0);
  await switchTo(wallet, firstBytes);
  await page.evaluate(() => { window.__recoveryVerifier.hold = false; window.__recoveryVerifier.releaseSigning(); });
  await page.waitForTimeout(100);
  assert.equal(submissions, 0, "Returning to A cannot revive A's obsolete signature request");
  assert.equal(await record(page), null);
  const promptsBeforeSend = await page.evaluate(() => window.__recoveryVerifier.signCalls);
  await page.getByRole("button", { name: "Review claim", exact: true }).click();
  await page.getByRole("button", { name: "Sign claim in wallet", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#vault-action-panel")?.textContent.includes("tracked"));
  const first = await record(page);
  assert(first?.signature && submissions === 1, "Lost response must retain one submitted signature");
  await page.getByRole("button", { name: /Disconnect/ }).click();
  await connect(page);
  assert.equal((await record(page)).signature, first.signature);
  assert.equal(await page.evaluate(() => window.__recoveryVerifier.signCalls), promptsBeforeSend + 1);
  assert.equal(submissions, 1, "Reconnect must not resend");
  await switchTo(secondWallet, secondBytes);
  await page.waitForFunction(() => !document.querySelector("#vault-action-panel")?.textContent.includes("tracked"));
  assert.equal(await page.locator(`#vault-action-panel a[href*="${first.signature}"]`).count(), 0, "B cannot see A's pending signature action");
  assert.equal(await page.evaluate(address => localStorage.getItem("loyal-vault-demo:pending-transaction:" + address), secondWallet), null);
  assert.equal((await record(page)).signature, first.signature, "Switching to B must preserve A's recovery record");
  await page.waitForFunction(() => document.querySelector(".claim-amount")?.textContent.trim().startsWith("2 "));
  const promptsBeforeForeignQuote = await page.evaluate(() => window.__recoveryVerifier.signCalls);
  // The prepare interceptor intentionally returns A's quote to B's request.
  await page.getByRole("button", { name: "Review claim", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#vault-action-panel")?.textContent.includes("quote is bound to wallet"));
  assert.equal(await page.getByRole("button", { name: "Sign claim in wallet", exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => window.__recoveryVerifier.signCalls), promptsBeforeForeignQuote);
  assert.equal(submissions, 1, "Foreign wallet quote must be rejected before any additional send");
  assert.equal((await record(page)).signature, first.signature);
  await switchTo(wallet, firstBytes);
  await page.waitForFunction(() => document.querySelector("#vault-action-panel")?.textContent.includes("tracked"));
  assert.equal(submissions, 1, "Switching accounts must not resend A's pending transaction");
  mode.expired = mode.unknown = true;
  await page.getByRole("button", { name: "Check transaction status", exact: true }).click();
  await page.waitForFunction(() => !localStorage.getItem("loyal-vault-demo:pending-transaction:" + window.__recoveryVerifier.address));
  assert.equal(submissions, 1, "Expiry must not auto-submit");
  assert((await page.locator("#vault-action-panel").innerText()).includes("expired"));
  mode.expired = mode.unknown = false;
  fixture = buildFixture(wallet, "3");
  const popupEvent = page.waitForEvent("popup");
  await page.evaluate(url => window.open(url, "competing-vault-tab"), base.href);
  const other = await popupEvent;
  await other.waitForFunction(() => !!window.__recoveryVerifier?.address);
  assert.equal(await other.evaluate(() => window.__recoveryVerifier.address), wallet);
  await connect(other);
  await Promise.all([page, other].map(target => target.getByRole("button", { name: "Review claim", exact: true }).click()));
  await Promise.all([page, other].map(target => target.getByRole("button", { name: "Sign claim in wallet", exact: true }).click()));
  await page.waitForFunction(() => !!localStorage.getItem("loyal-vault-demo:pending-transaction:" + window.__recoveryVerifier.address));
  await page.waitForTimeout(300);
  assert.equal(submissions, 2, "Two competing tabs may send only one additional transaction");
  assert.equal((await record(page)).signature, (await record(other)).signature);
  await other.close();
  const tracked = await record(page);
  const siblingRecord = { ...tracked, wallet: secondWallet };
  await page.evaluate(({ wallet, record }) => localStorage.setItem("loyal-vault-demo:pending-transaction:" + wallet, JSON.stringify(record)), { wallet: secondWallet, record: siblingRecord });
  const beforeOutcome = paths.map(path => readCounts.get(path) ?? 0);
  mode.finalizedFailure = true;
  await page.getByRole("button", { name: "Check transaction status", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#vault-action-panel")?.textContent.includes("Controlled finalized failure"));
  for (let attempt = 0; attempt < 100 && paths.some((path, index) => (readCounts.get(path) ?? 0) <= beforeOutcome[index]); attempt++) await page.waitForTimeout(20);
  paths.forEach((path, index) => assert((readCounts.get(path) ?? 0) > beforeOutcome[index], `Finalized failure must refresh ${path}`));
  assert.equal(await record(page), null, "Finalized bound failure clears its recovery record");
  assert.equal(await page.evaluate(wallet => JSON.parse(localStorage.getItem("loyal-vault-demo:pending-transaction:" + wallet)).wallet, secondWallet), secondWallet, "Resolving A must preserve B's recovery record");
  assert.equal(submissions, 2, "Finalized failure must not retry a transaction");
  console.log(JSON.stringify({ passed: 14, finalizedFailureRefreshesWithoutRetry: true, inFlightQuoteWalletChangeDiscarded: true, foreignQuoteRejectedBeforePrompt: true, hiddenReadsStopped: true, visibleReadsResumed: true, failedReadPreservesTimestampOnly: true, refreshIncludesPositionsAndWorker: true, walletRoundTripInvalidatesSignature: true, pendingSignatureIsolated: true, quoteDisconnectDiscarded: true, signatureRefusalDidNotSend: true, signingDisconnectDidNotSend: true, networkSubmissions: 0, interceptedSubmissionAttempts: submissions, lostResponseTracked: true, reconnectDidNotResend: true, expiryDidNotResend: true, competingTabsSentOnce: true, blockedOther }));
} catch (error) {
  if (context) for (const target of context.pages()) console.error(await target.locator(".wallet-control").innerText().catch(() => "No wallet UI"));
  throw error;
} finally {
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  try { cli("close"); } catch { /* Context may already be closed. */ }
}
