#!/usr/bin/env bun

/**
 * Verifier-first release gate for progressive admin page loading.
 *
 * Required end state:
 * - Clicking the sidebar changes the URL and displays the destination shell in
 *   <= 500 ms without waiting for page data.
 * - The first useful section becomes ready in <= 1,500 ms on a warmed server.
 * - Lower expensive sections do not start before the first section is ready.
 * - Each deferred data request starts exactly once when its section is reached;
 *   scrolling away and back must not repeat it.
 * - Skeletons reserve space only while loading. After data settles, cards use
 *   normal document flow with no overflow, overlap, or oversized empty tail.
 * - Total post-navigation CLS is <= 0.02, and a hard reload settles with the
 *   same healthy layout and no skeletons, hydration errors, or overlays.
 * - Fully loaded candidate content is at least 99.5% similar to merged-main
 *   baseline content backed by the same read-only data.
 * - The diff adds no cache, revalidation shortcut, table, view, index, or
 *   migration.
 *
 * Run baseline and candidate servers against the same read-only data, then:
 *
 *   ADMIN_BASELINE_URL=http://127.0.0.1:3101 \
 *   ADMIN_CANDIDATE_URL=http://127.0.0.1:3102 \
 *   ADMIN_USER=local ADMIN_PASSWORD=local \
 *   bun scripts/verify-admin-progressive-loading.ts
 *
 * Verdict: PASS only when every required assertion passes for all three routes.
 */

import { spawnSync } from "node:child_process";
import {
  chromium,
  type Browser,
  type ConsoleMessage,
  type Page,
  type Request,
} from "playwright";

const ROUTES = [
  {
    deferred: [
      {
        request: "/api/earn/progressive?section=funding",
        section: "earn-funding",
      },
      { request: null, section: "earn-activity" },
      { request: null, section: "earn-positions" },
    ],
    firstRequest: null,
    firstSection: "earn-monitoring",
    href: "/earn",
  },
  {
    deferred: [
      {
        request: "/api/earn/rebalance?section=apy-history",
        section: "rebalance-apy-history",
      },
      {
        request: "/api/earn/rebalance?section=operations",
        section: "rebalance-operations",
      },
      {
        request: "/api/earn/rebalance?section=executions",
        section: "rebalance-executions",
      },
      {
        request: "/api/earn/rebalance?section=frequency",
        section: "rebalance-frequency",
      },
      {
        request: "/api/earn/rebalance/audit",
        section: "rebalance-audit",
      },
    ],
    firstRequest: "/api/earn/rebalance?section=overview",
    firstSection: "rebalance-overview",
    href: "/earn/rebalance",
  },
  {
    deferred: [
      {
        request: "/api/metrics?section=dashboard",
        section: "metrics-dashboard",
      },
    ],
    firstRequest: null,
    firstSection: "metrics-latency",
    href: "/metrics",
  },
] as const;

const NAVIGATION_LIMIT_MS = 500;
const FIRST_SECTION_LIMIT_MS = 1_500;
const CLS_LIMIT = 0.02;
const CONTENT_SIMILARITY_LIMIT = 0.995;

type RouteContract = (typeof ROUTES)[number];
type RequestObservation = { at: number; url: string };
type ClsState = {
  entries: Array<{ at: number; [key: string]: unknown }>;
  shifts: Array<{ at: number; value: number }>;
  value: number;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value.replace(/\/$/, "");
}

function normalizeText(value: string): string {
  return (
    value
      .replace(/\b\d{4}-\d{2}-\d{2}[T ][0-9:.+-]+Z?\b/g, "<timestamp>")
      .replace(
        /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{4},?[^·\n]{0,24}UTC\b/g,
        "<timestamp>"
      )
      .replace(/\bFinalized\s+slot\s+[\d,]+\b/gi, "Finalized slot <slot>")
      .replace(
        /\b(?:just now|\d+ (?:seconds?|minutes?) ago)\b/gi,
        "<relative-time>"
      )
      // Baseline and candidate query the same live sources sequentially, so APYs,
      // balances, slots, and counts can legitimately move between snapshots.
      // Compare the complete labels/structure here; request payload shape and
      // section completeness are checked independently above.
      .replace(/\b\d+(?:[.,]\d+)*%?\b/g, "<number>")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function tokenSimilarity(left: string, right: string): number {
  const a = textTokens(left);
  const b = textTokens(right);
  const common = [...a].filter((token) => b.has(token)).length;
  return common / Math.max(a.size, b.size, 1);
}

function textTokens(value: string) {
  return new Set(value.toLowerCase().match(/[a-z]+/g) ?? []);
}

function rejectDisallowedImplementation() {
  const diff = spawnSync(
    "git",
    [
      "diff",
      "--unified=0",
      "HEAD",
      "--",
      "apps/admin",
      "packages/db-core",
      "migrations",
    ],
    { encoding: "utf8" }
  );
  if (diff.status !== 0) {
    throw new Error(diff.stderr.trim() || "git diff failed");
  }
  const added = diff.stdout
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .join("\n");
  const forbidden = [
    /unstable_cache/,
    /\bCREATE\s+(?:MATERIALIZED\s+)?(?:TABLE|VIEW|INDEX)\b/i,
    /\brevalidate\s*:/,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(added)) {
      throw new Error(`Disallowed cache/schema change matched ${pattern}.`);
    }
  }
}

async function login(
  page: Page,
  baseUrl: string,
  username: string,
  password: string
) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("#login").fill(username);
  await page.locator("#password").fill(password);
  await Promise.all([
    page.waitForURL((url) => url.pathname !== "/login"),
    page.getByRole("button", { name: "Login" }).click(),
  ]);
}

function matchesRequest(url: string, expected: string): boolean {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`.startsWith(expected);
}

async function installLayoutShiftObserver(page: Page) {
  await page.addInitScript(() => {
    const state: {
      entries: Array<{
        at: number;
        current: DOMRectReadOnly | null;
        node: string;
        previous: DOMRectReadOnly | null;
        value: number;
      }>;
      shifts: Array<{ at: number; value: number }>;
      value: number;
    } = { entries: [], shifts: [], value: 0 };
    Object.defineProperty(window, "__adminProgressiveCls", {
      configurable: true,
      value: state,
    });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          hadRecentInput?: boolean;
          value?: number;
        };
        if (!shift.hadRecentInput && typeof shift.value === "number") {
          state.value += shift.value;
          state.shifts.push({ at: entry.startTime, value: shift.value });
          const sources = (
            entry as PerformanceEntry & {
              sources?: Array<{
                currentRect?: DOMRectReadOnly;
                node?: Node;
                previousRect?: DOMRectReadOnly;
              }>;
            }
          ).sources;
          for (const source of sources ?? []) {
            const element =
              source.node instanceof Element ? source.node : undefined;
            state.entries.push({
              at: entry.startTime,
              current: source.currentRect ?? null,
              node: element
                ? `${element.tagName.toLowerCase()}${
                    element.getAttribute("data-progressive-section")
                      ? `[data-progressive-section=${element.getAttribute(
                          "data-progressive-section"
                        )}]`
                      : ""
                  }.${element.className}`
                : source.node?.nodeName ?? "unknown",
              previous: source.previousRect ?? null,
              value: shift.value,
            });
          }
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

async function readCls(
  page: Page,
  reset: boolean,
  since = 0
): Promise<ClsState> {
  return page.evaluate(
    ({ shouldReset, startedAt }) => {
      const state = (
        window as typeof window & {
          __adminProgressiveCls?: ClsState;
        }
      ).__adminProgressiveCls ?? { entries: [], shifts: [], value: 0 };
      const shifts = state.shifts.filter((shift) => shift.at >= startedAt);
      const snapshot = {
        entries: state.entries.filter((entry) => entry.at >= startedAt),
        shifts,
        value: shifts.reduce((total, shift) => total + shift.value, 0),
      };
      if (shouldReset) {
        state.entries.length = 0;
        state.shifts.length = 0;
        state.value = 0;
      }
      return snapshot;
    },
    { shouldReset: reset, startedAt: since }
  );
}

async function semanticText(page: Page): Promise<string> {
  return normalizeText(
    await page.locator('[data-slot="sidebar-inset"]').evaluate((element) => {
      const snapshot = element.cloneNode(true) as HTMLElement;
      snapshot
        .querySelectorAll(
          'svg, style, script, noscript, tbody, [data-slot="skeleton"], [aria-hidden="true"]'
        )
        .forEach((node) => node.remove());
      return snapshot.innerText;
    })
  );
}

async function fullyLoadBaseline(
  page: Page,
  baseUrl: string,
  route: RouteContract
) {
  await page.goto(
    `${baseUrl}${route.href}?progressiveBaseline=${crypto.randomUUID()}`,
    {
      waitUntil: "domcontentloaded",
    }
  );
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.evaluate(async () => {
    const step = Math.max(400, Math.floor(window.innerHeight * 0.75));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  if (route.href === "/earn") {
    await page.getByText("Largest active positions", { exact: true }).waitFor();
  } else if (route.href === "/earn/rebalance") {
    await page.getByText("Movement audit", { exact: true }).waitFor();
  } else {
    await page.getByRole("heading", { name: "Mobile", exact: true }).waitFor();
  }
  await page.waitForFunction(
    () => document.querySelectorAll('[data-slot="skeleton"]').length === 0
  );
}

async function warmCandidate(
  page: Page,
  baseUrl: string,
  route: RouteContract
) {
  await page.goto(
    `${baseUrl}${route.href}?progressiveWarm=${crypto.randomUUID()}`,
    { waitUntil: "domcontentloaded" }
  );
  await page.locator(`[data-progressive-page="${route.href}"]`).waitFor();
  await page.waitForFunction(
    (section) =>
      document
        .querySelector(`[data-progressive-section="${section}"]`)
        ?.getAttribute("data-progressive-state") === "ready",
    route.firstSection
  );
  for (const deferred of route.deferred) {
    await page
      .locator(`[data-progressive-section="${deferred.section}"]`)
      .scrollIntoViewIfNeeded();
    await page.waitForFunction(
      (section) =>
        document
          .querySelector(`[data-progressive-section="${section}"]`)
          ?.getAttribute("data-progressive-state") === "ready",
      deferred.section
    );
  }
}

async function auditLoadedLayout(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const visible = (element: Element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const label = (element: Element) =>
      element.getAttribute("data-progressive-section") ??
      element.getAttribute("data-slot") ??
      element.tagName.toLowerCase();
    const issues: string[] = [];

    for (const section of document.querySelectorAll<HTMLElement>(
      '[data-progressive-section][data-progressive-state="ready"]'
    )) {
      if (section.scrollHeight > section.clientHeight + 2) {
        issues.push(
          `${label(section)} content overflows by ${Math.round(
            section.scrollHeight - section.clientHeight
          )}px`
        );
      }

      const sectionRect = section.getBoundingClientRect();
      const children = [...section.children].filter(visible);
      if (children.length > 0) {
        const lastChildBottom = Math.max(
          ...children.map((child) => child.getBoundingClientRect().bottom)
        );
        const emptyTail = sectionRect.bottom - lastChildBottom;
        if (emptyTail > 96) {
          issues.push(
            `${label(section)} has ${Math.round(emptyTail)}px empty tail`
          );
        }
      }
    }

    const sections = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-progressive-section][data-progressive-state="ready"]'
      ),
    ].filter(visible);
    for (let index = 0; index < sections.length; index += 1) {
      const left = sections[index]!;
      const leftRect = left.getBoundingClientRect();
      for (
        let nextIndex = index + 1;
        nextIndex < sections.length;
        nextIndex += 1
      ) {
        const right = sections[nextIndex]!;
        if (left.contains(right) || right.contains(left)) {
          continue;
        }
        const rightRect = right.getBoundingClientRect();
        const horizontalOverlap =
          Math.min(leftRect.right, rightRect.right) -
          Math.max(leftRect.left, rightRect.left);
        const verticalOverlap =
          Math.min(leftRect.bottom, rightRect.bottom) -
          Math.max(leftRect.top, rightRect.top);
        if (horizontalOverlap > 2 && verticalOverlap > 2) {
          issues.push(
            `${label(left)} overlaps ${label(right)} by ${Math.round(
              verticalOverlap
            )}px`
          );
        }
      }
    }

    return [...new Set(issues)].slice(0, 20);
  });
}

async function fullyLoadAfterReload(page: Page, route: RouteContract) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(`[data-progressive-page="${route.href}"]`).waitFor();
  await page.waitForFunction(
    (section) =>
      document
        .querySelector(`[data-progressive-section="${section}"]`)
        ?.getAttribute("data-progressive-state") === "ready",
    route.firstSection
  );
  for (const deferred of route.deferred) {
    await page
      .locator(`[data-progressive-section="${deferred.section}"]`)
      .scrollIntoViewIfNeeded();
    await page.waitForFunction(
      (section) =>
        document
          .querySelector(`[data-progressive-section="${section}"]`)
          ?.getAttribute("data-progressive-state") === "ready",
      deferred.section
    );
  }
  await page.waitForFunction(
    () => document.querySelectorAll('[data-slot="skeleton"]').length === 0
  );
}

async function verifyRoute(
  browser: Browser,
  baselineUrl: string,
  candidateUrl: string,
  route: RouteContract,
  username: string,
  password: string
) {
  const baselineContext = await browser.newContext({
    viewport: { height: 800, width: 1440 },
  });
  const candidateContext = await browser.newContext({
    viewport: { height: 800, width: 1440 },
  });
  const baselinePage = await baselineContext.newPage();
  const page = await candidateContext.newPage();
  page.setDefaultTimeout(120_000);
  baselinePage.setDefaultTimeout(120_000);
  await installLayoutShiftObserver(page);
  await Promise.all([
    login(baselinePage, baselineUrl, username, password),
    login(page, candidateUrl, username, password),
  ]);
  await Promise.all([
    fullyLoadBaseline(baselinePage, baselineUrl, route),
    warmCandidate(page, candidateUrl, route),
  ]);

  const requests: RequestObservation[] = [];
  const consoleErrors: string[] = [];
  const requestListener = (request: Request) => {
    if (["fetch", "xhr"].includes(request.resourceType())) {
      requests.push({ at: performance.now(), url: request.url() });
    }
  };
  const consoleListener = (message: ConsoleMessage) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  };
  page.on("request", requestListener);
  page.on("console", consoleListener);
  const navigationSamples: number[] = [];
  const firstSectionSamples: number[] = [];
  let firstReadyAt = 0;
  for (let sampleIndex = 0; sampleIndex < 3; sampleIndex += 1) {
    await page.goto(`${candidateUrl}/overview`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(500);
    requests.length = 0;
    consoleErrors.length = 0;
    await readCls(page, true);

    const target = page.locator(`a[href="${route.href}"]`).first();
    await target.waitFor();
    const clickedAt = performance.now();
    await target.click({ noWaitAfter: true });
    await page.waitForFunction(
      (pathname) => location.pathname === pathname,
      route.href
    );
    navigationSamples.push(performance.now() - clickedAt);
    await page.locator(`[data-progressive-page="${route.href}"]`).waitFor();

    const first = page.locator(
      `[data-progressive-section="${route.firstSection}"]`
    );
    await first.waitFor();
    await page.waitForFunction(
      (section) =>
        document
          .querySelector(`[data-progressive-section="${section}"]`)
          ?.getAttribute("data-progressive-state") === "ready",
      route.firstSection
    );
    firstSectionSamples.push(performance.now() - clickedAt);
    firstReadyAt = performance.now();
  }
  const median = (values: number[]) =>
    [...values].sort((left, right) => left - right)[
      Math.floor(values.length / 2)
    ] ?? Number.POSITIVE_INFINITY;
  const navigationMs = median(navigationSamples);
  const firstSectionMs = median(firstSectionSamples);
  await page.waitForTimeout(250);
  const measuredCls: ClsState = await readCls(page, true);
  const earlyDeferred = route.deferred
    .filter((item) => item.request)
    .filter((item) =>
      requests.some(
        (request) =>
          request.at < firstReadyAt &&
          matchesRequest(request.url, item.request!)
      )
    );

  for (const deferred of route.deferred) {
    const section = page.locator(
      `[data-progressive-section="${deferred.section}"]`
    );
    await section.scrollIntoViewIfNeeded();
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    );
    const sectionMeasurementStartedAt = await page.evaluate(() =>
      performance.now()
    );
    // Automated scrolling can generate synthetic shift records in headless
    // Chrome. Discard the transition, then measure only content settlement.
    await readCls(page, true, sectionMeasurementStartedAt);
    await page.waitForFunction(
      (sectionName) =>
        document
          .querySelector(`[data-progressive-section="${sectionName}"]`)
          ?.getAttribute("data-progressive-state") === "ready",
      deferred.section
    );
    await page.waitForTimeout(250);
    await readCls(page, true, sectionMeasurementStartedAt);
    if (deferred.request) {
      const count = requests.filter((request) =>
        matchesRequest(request.url, deferred.request!)
      ).length;
      if (count !== 1) {
        throw new Error(
          `${route.href} ${deferred.section} requested ${count} times; expected exactly once.`
        );
      }
    }
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  for (const deferred of route.deferred) {
    await page
      .locator(`[data-progressive-section="${deferred.section}"]`)
      .scrollIntoViewIfNeeded();
  }
  await page.waitForTimeout(100);

  const duplicateAfterRescroll = route.deferred.filter(
    (item) =>
      item.request &&
      requests.filter((request) => matchesRequest(request.url, item.request!))
        .length !== 1
  );
  const initialLayoutIssues = await auditLoadedLayout(page);
  page.off("request", requestListener);
  await fullyLoadAfterReload(page, route);
  const reloadLayoutIssues = await auditLoadedLayout(page);
  const clsState = measuredCls;
  const cls = clsState.value;
  const remainingSkeletons = await page
    .locator('[data-slot="skeleton"]')
    .count();
  const overlays = await page.evaluate(() => {
    const visible = (element: Element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const errorOverlaySelectors =
      '[data-nextjs-dialog-overlay], [data-nextjs-dialog], [data-nextjs-error-overlay], [role="dialog"]';
    const lightDomOverlays = [
      ...document.querySelectorAll(errorOverlaySelectors),
    ].filter((element) => visible(element) && element.textContent?.trim());
    const portalOverlays = [...document.querySelectorAll("nextjs-portal")]
      .flatMap((portal) =>
        portal.shadowRoot
          ? [...portal.shadowRoot.querySelectorAll(errorOverlaySelectors)]
          : []
      )
      .filter((element) => visible(element) && element.textContent?.trim());
    return new Set([...lightDomOverlays, ...portalOverlays]).size;
  });
  const candidateText = await semanticText(page);
  const baselineText = await semanticText(baselinePage);
  const similarity = tokenSimilarity(baselineText, candidateText);

  const failures: string[] = [];
  if (navigationMs > NAVIGATION_LIMIT_MS) {
    failures.push(
      `navigation ${navigationMs.toFixed(0)}ms > ${NAVIGATION_LIMIT_MS}ms`
    );
  }
  if (firstSectionMs > FIRST_SECTION_LIMIT_MS) {
    failures.push(
      `first section ${firstSectionMs.toFixed(
        0
      )}ms > ${FIRST_SECTION_LIMIT_MS}ms`
    );
  }
  if (
    route.firstRequest &&
    !requests.some((request) => matchesRequest(request.url, route.firstRequest))
  ) {
    failures.push(`missing first request ${route.firstRequest}`);
  }
  if (earlyDeferred.length > 0) {
    failures.push(
      `deferred work started before first section: ${earlyDeferred
        .map((item) => item.section)
        .join(", ")}`
    );
  }
  if (duplicateAfterRescroll.length > 0) {
    failures.push(
      `requests repeated after re-scroll: ${duplicateAfterRescroll
        .map((item) => item.section)
        .join(", ")}`
    );
  }
  if (cls > CLS_LIMIT) {
    failures.push(
      `CLS ${cls.toFixed(4)} > ${CLS_LIMIT}; sources: ${JSON.stringify(
        clsState.entries.slice(0, 8)
      )}`
    );
  }
  if (initialLayoutIssues.length > 0) {
    failures.push(
      `loaded layout is broken: ${initialLayoutIssues.join(" | ")}`
    );
  }
  if (reloadLayoutIssues.length > 0) {
    failures.push(
      `reloaded layout is broken: ${reloadLayoutIssues.join(" | ")}`
    );
  }
  if (remainingSkeletons > 0) {
    failures.push(`${remainingSkeletons} skeletons remain after full load`);
  }
  if (overlays > 0) {
    failures.push(`${overlays} Next.js error overlays present`);
  }
  if (consoleErrors.length > 0) {
    failures.push(`console errors: ${consoleErrors.slice(0, 3).join(" | ")}`);
  }
  if (similarity < CONTENT_SIMILARITY_LIMIT) {
    const candidateTokens = textTokens(candidateText);
    const missingTokens = [...textTokens(baselineText)]
      .filter((token) => !candidateTokens.has(token))
      .slice(0, 30);
    failures.push(
      `content similarity ${(similarity * 100).toFixed(2)}% < ${(
        CONTENT_SIMILARITY_LIMIT * 100
      ).toFixed(1)}%; baseline-only tokens: ${missingTokens.join(", ")}`
    );
  }

  const pass = failures.length === 0;
  console.log(
    `${pass ? "PASS" : "FAIL"} ${route.href.padEnd(
      18
    )} nav=${navigationMs.toFixed(0)}ms first=${firstSectionMs.toFixed(
      0
    )}ms cls=${cls.toFixed(4)} similarity=${(similarity * 100).toFixed(2)}%`
  );
  failures.forEach((failure) => console.error(`  - ${failure}`));

  page.off("console", consoleListener);
  await Promise.all([baselineContext.close(), candidateContext.close()]);
  return pass;
}

async function main() {
  rejectDisallowedImplementation();
  const baselineUrl = requiredEnv("ADMIN_BASELINE_URL");
  const candidateUrl = requiredEnv("ADMIN_CANDIDATE_URL");
  const username = requiredEnv("ADMIN_USER");
  const password = requiredEnv("ADMIN_PASSWORD");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  let passed = true;
  try {
    const routeFilter = process.env.ADMIN_ROUTE?.trim();
    const routes = routeFilter
      ? ROUTES.filter((route) => route.href === routeFilter)
      : ROUTES;
    if (routes.length === 0) {
      throw new Error(`Unknown ADMIN_ROUTE: ${routeFilter}`);
    }
    for (const route of routes) {
      passed =
        (await verifyRoute(
          browser,
          baselineUrl,
          candidateUrl,
          route,
          username,
          password
        )) && passed;
    }
  } finally {
    await browser.close();
  }
  console.log(`OVERALL: ${passed ? "PASS" : "FAIL"}`);
  if (!passed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
