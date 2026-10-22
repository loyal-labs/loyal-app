// Read-only checks: no wallet, signing, transaction submission, or session mutation.
import assert from "node:assert/strict";

const checks = [
  ["Web entry", "https://app.askloyal.com/app", "text/html"],
  [
    "ClickStack API",
    "https://observability.5.161.121.229.sslip.io/api/health",
    "application/json",
  ],
];
const failures = [];
for (const [name, url, contentType] of checks) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    assert.equal(response.status, 200, `${name}: HTTP ${response.status}`);
    assert(
      response.headers.get("content-type")?.includes(contentType),
      `${name}: unexpected response type`
    );
    const body = await response.text();
    assert(body.length > 0, `${name}: empty response`);
    console.log(`${name}: reachable`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
}
