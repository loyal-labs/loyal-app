#!/usr/bin/env bun

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { resolve } from "node:path";
import React from "react";
import ts from "typescript";

// Render the chart's real declarations without loading unrelated wallet SDKs.
const webRoot = resolve(import.meta.dir, "..");
const require = createRequire(`${webRoot}/package.json`);
const { renderToStaticMarkup } = require("react-dom/server");
const source = readFileSync(
  process.argv[2] ??
    `${webRoot}/src/components/wallet-sidebar/earn-detail-view.tsx`,
  "utf8"
);
const ast = ts.createSourceFile(
  "chart.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const names = new Set([
  "font",
  "secondary",
  "LOYAL_EARN_BRAND_COLOR",
  "EARN_COMPARISON_SERIES",
  "EARN_SERIES_DISPLAY",
  "toHistoricalApySamples",
  "toHistoricalBenchmarkSamples",
  "nearestHistoricalApyPercent",
  "smoothChartLinePath",
  "downsampleHistoricalApySamples",
  "historicalApyValueSegments",
  "subscribeToHistoricalChartHydration",
  "getHistoricalChartClientSnapshot",
  "getHistoricalChartServerSnapshot",
  "HistoricalApyChart",
  "HydratedHistoricalApyChart",
]);
const declarations = ast.statements
  .filter((statement) => {
    const identifier = ts.isFunctionDeclaration(statement)
      ? statement.name
      : ts.isVariableStatement(statement)
      ? statement.declarationList.declarations[0].name
      : undefined;
    const name =
      identifier && ts.isIdentifier(identifier) ? identifier.text : "";
    return names.has(name) || name?.startsWith("HISTORICAL_");
  })
  .map((statement) => statement.getText(ast))
  .join("\n");
const code = ts.transpileModule(declarations, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
let samples = [
  { apyBps: 725, observedAt: new Date(Date.now() - 3600_000).toISOString() },
];
let availability = "available";
let historyReads = 0;
const context = {
  ...React,
  exports: {} as { Chart: React.ComponentType<{ rangeId: string }> },
  require,
  useSyncExternalStore: () => true,
  useEarnForecastApy: () => ({ availability }),
  // A newly mounted history consumer starts empty, even with a loaded parent.
  useEarnForecastApyHistory: () => ({
    samples: ++historyReads === 1 ? samples : [],
  }),
  ApyRevealText: ({ segments }: { segments: { text: string }[] }) =>
    React.createElement(
      "span",
      null,
      segments.map((part) => part.text).join("")
    ),
};
runInNewContext(`${code}\nexports.Chart = HistoricalApyChart;`, context);
function render() {
  historyReads = 0;
  return renderToStaticMarkup(
    React.createElement(context.exports.Chart, { rangeId: "30D" })
  );
}
assert.match(render(), /7\.25%/);
samples = [{ apyBps: 650, observedAt: new Date().toISOString() }];
assert.match(render(), /6\.50%/);
samples = [];
assert.match(render(), /Historical APY unavailable/);
samples = [
  {
    apyBps: 725,
    observedAt: new Date(Date.now() - 31 * 86400_000).toISOString(),
  },
];
assert.match(render(), /Historical APY unavailable/);
samples = [{ apyBps: 725, observedAt: new Date().toISOString() }];
availability = "unavailable";
assert.match(render(), /Historical APY unavailable/);
availability = "stale";
assert.match(render(), /APY data is stale/);
console.log(
  "PASS: loaded, refreshed, empty, out-of-range, unavailable, and stale chart renders"
);
