// Run with: bun scripts/verify-earned-refresh.ts
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const entry = `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useEarnEarnings } from '@/hooks/use-earn-earnings';
function Chart() {
  const { freshness, isLoading } = useEarnEarnings({
    cacheKey: 'refresh-verification', enabled: true, revalidationKey: '1000000',
  });
  return createElement('output', null, JSON.stringify({ freshness, isLoading }));
}
createRoot(document.getElementById('root')).render(createElement(Chart));
`;
const bundle = await Bun.build({
  entrypoints: ["earn-refresh-fixture"],
  target: "browser",
  plugins: [
    {
      name: "fixture",
      setup(build) {
        build.onResolve({ filter: /^earn-refresh-fixture$/ }, () => ({
          path: "fixture",
          namespace: "fixture",
        }));
        build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: entry,
          loader: "tsx",
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
});
assert(bundle.success, String(bundle.logs));
const range = {
  bars: [],
  currentApyBps: 600,
  lastDepositAt: null,
  lifetimeEarnedUsd: 1,
  principalAmountRaw: "1000000",
  principalUsd: 1,
  rangeEarnedUsd: 1,
  sinceLastDepositEarnedUsd: 1,
  todayEarnedUsd: 1,
};
const payload = {
  freshness: "stale",
  generatedAt: new Date().toISOString(),
  historyRevision: "fixture",
  outcome: "ready",
  principalMatchesHistory: true,
  sourcePrincipalAmountRaw: "1000000",
  snapshotAgeMs: 0,
  staleReason: "snapshot_expired",
  coverage: {},
  ranges: Object.fromEntries(
    ["7D", "30D", "1Y", "ALL"].map((key) => [key, range])
  ),
};
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    return new URL(request.url).pathname === "/runtime.js"
      ? new Response(bundle.outputs[0], {
          headers: { "content-type": "text/javascript" },
        })
      : new Response(
          '<div id="root"></div><script type="module" src="/runtime.js"></script>',
          { headers: { "content-type": "text/html" } }
        );
  },
});
const browser = await chromium.launch({
  executablePath: process.env.JOURNEY_CHROMIUM_PATH,
});
try {
  for (const failure of [false, true]) {
    const page = await browser.newPage();
    await page.clock.install();
    let requests = 0;
    await page.route(
      "**/api/smart-accounts/yield-optimization/earnings?*",
      (route) => {
        requests++;
        return failure
          ? route.fulfill({ status: 401, json: {} })
          : route.fulfill({
              json: {
                ...payload,
                freshness: requests === 1 ? "stale" : "fresh",
              },
            });
      }
    );
    await page.goto(server.url.toString());
    await page.waitForFunction(() =>
      document
        .querySelector("output")
        ?.textContent?.includes('"isLoading":false')
    );
    assert.equal(requests, 1);
    await page.clock.runFor(5500);
    if (failure) {
      assert.equal(requests, 1, "Errors must retain their longer backoff");
    } else {
      await page.waitForFunction(() =>
        document
          .querySelector("output")
          ?.textContent?.includes('"freshness":"fresh"')
      );
      assert.equal(
        requests,
        2,
        "A pending chart must refresh without a focus event"
      );
      await page.clock.runFor(10000);
      assert.equal(requests, 2, "Fresh charts must stop frequent polling");
    }
    await page.close();
  }
  console.log(
    "PASS: visible stale chart refreshes within five seconds; fresh charts and failures do not poll rapidly."
  );
} finally {
  await browser.close();
  server.stop();
}
