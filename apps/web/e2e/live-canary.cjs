const fs = require("fs");
const { chromium } = require("@playwright/test");
const path = require("node:path");
const { spawn } = require("node:child_process");
const target = process.env.JOURNEY_CANARY_URL;
if (!target || !/^https:\/\/[^/]+\.vercel\.app$/.test(target))
  throw new Error("JOURNEY_CANARY_URL must be an HTTPS Vercel preview origin");
(async () => {
  const fixture = spawn("bun", ["e2e/fixtures/server.ts"], {
    cwd: path.resolve(__dirname, ".."),
    stdio: "ignore",
  });
  let browser;
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (fixture.exitCode !== null) throw new Error("Fixture server exited");
      try {
        const response = await fetch("http://127.0.0.1:4317");
        if (response.ok) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    browser = await chromium.launch({
      ...(process.env.JOURNEY_CHROMIUM_PATH
        ? { executablePath: process.env.JOURNEY_CHROMIUM_PATH }
        : {}),
    });
    const evidence = {
      target,
      startedAt: new Date().toISOString(),
      events: [],
      intakes: [],
      rumShape: [],
    };
    try {
      const page = await browser.newPage();
      page.on("response", (r) => {
        if (r.url().includes("datadoghq.com/api/v2/rum"))
          evidence.intakes.push(r.status());
      });
      page.on("request", (r) => {
        if (r.url().includes("datadoghq.com/api/v2/rum")) {
          try {
            for (const line of (r.postData() || "").split("\n")) {
              const e = JSON.parse(line);
              evidence.rumShape.push({
                type: e.type,
                action: e.action?.target?.name,
                application: e.application?.id,
                flow: e.context?.flow,
                outcome: e.context?.outcome,
                trafficKind: e.context?.traffic_kind,
                contextKeys: Object.keys(e.context || {}),
              });
            }
          } catch {}
        }
      });
      await page.route("**/api/auth/session", (r) =>
        r.fulfill({ status: 401, json: { error: { code: "unauthenticated" } } })
      );
      await page.route("**/api/observability/events", async (route) => {
        const event = route.request().postDataJSON();
        if (event.flowName !== "earn.deposit") {
          await route.fulfill({ status: 202, json: { accepted: true } });
          return;
        }
        const response = await page.request.post(
          target + "/api/observability/events",
          {
            headers: {
              origin: target,
              "x-loyal-synthetic-probe": "1",
              ...(process.env.VERCEL_OIDC_TOKEN
                ? {
                    "x-vercel-trusted-oidc-idp-token":
                      process.env.VERCEL_OIDC_TOKEN,
                  }
                : {}),
            },
            data: event,
          }
        );
        evidence.events.push({
          event,
          status: response.status(),
          response: await response.text(),
        });
        await route.fulfill({
          status: response.status(),
          body: await response.text(),
          contentType: "application/json",
        });
      });
      await page.goto("http://127.0.0.1:4317");
      await page.waitForFunction(() => !!window.journeyFixture);
      const source = fs.readFileSync(
        path.resolve(__dirname, "../../telegram/src/lib/core/datadog.ts"),
        "utf8"
      );
      await page.evaluate((config) => window.journeyFixture.datadog(config), {
        applicationId: source.match(/applicationId:\s*"([^"]+)"/)[1],
        clientToken: source.match(/clientToken:\s*"([^"]+)"/)[1],
      });
      evidence.ids = await page.evaluate(() => {
        const f = window.journeyFixture;
        const success = f.create({
          flowName: "earn.deposit",
          flowVariant: "initial",
        });
        success.start("intent");
        success.complete("position_visible", {
          chainState: "confirmed",
          persistenceState: "recorded",
        });
        const failure = f.create({
          flowName: "earn.deposit",
          flowVariant: "initial",
        });
        failure.start("intent");
        failure.fail("preflight", {
          errorCode: f.classify(
            Object.assign(
              new Error("Controlled fresh wallet missing prerequisite"),
              { name: "SquadsMissingAccountSimulationError" }
            )
          ),
          chainState: "not_submitted",
        });
        const retry = f.create({
          flowName: "earn.deposit",
          flowVariant: "resumed",
        });
        retry.start("intent");
        retry.complete("position_visible", {
          chainState: "confirmed",
          persistenceState: "recorded",
        });
        return {
          success: success.flowId,
          failure: failure.flowId,
          retry: retry.flowId,
        };
      });
      await page.waitForTimeout(35000);
      if (process.env.JOURNEY_CANARY_EVIDENCE)
        fs.writeFileSync(
          process.env.JOURNEY_CANARY_EVIDENCE,
          JSON.stringify(evidence, null, 2),
          { mode: 0o600 }
        );
      console.log(
        JSON.stringify({
          ids: evidence.ids,
          statuses: evidence.events.map((e) => e.status),
          intakes: evidence.intakes,
          rumShape: evidence.rumShape,
        })
      );
      if (
        evidence.events.length !== 6 ||
        evidence.events.some(
          (e) =>
            e.status !== 202 ||
            JSON.parse(e.response).trafficKind !== "synthetic"
        )
      )
        throw new Error(
          "Live telemetry export did not accept every canary event"
        );
      const depositActions = evidence.rumShape.filter(
        (e) => e.flow === "earn.deposit"
      );
      if (
        depositActions.length !== 6 ||
        depositActions.some((e) => e.trafficKind !== "synthetic") ||
        !evidence.intakes.includes(202)
      )
        throw new Error(
          "Datadog did not receive all six actions in the synthetic cohort"
        );
    } finally {
      await browser.close();
    }
  } finally {
    fixture.kill("SIGTERM");
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
