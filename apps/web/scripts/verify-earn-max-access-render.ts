#!/usr/bin/env bun

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import React from "react";
import ts from "typescript";

// Render the real workspace branches without loading signing SDKs or a session.
const webRoot = resolve(import.meta.dir, "..");
const require = createRequire(`${webRoot}/package.json`);
const { renderToStaticMarkup } = require("react-dom/server");
const source = readFileSync(
  `${webRoot}/src/components/wallet-workspace/facelift/earn-max-pane.tsx`,
  "utf8"
);
const ast = ts.createSourceFile(
  "pane.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const names = new Set([
  "ASSET_BASE",
  "EARN_MAX_TOOLTIP_TEXT",
  "EARN_MAX_CHART_TABS",
  "GrayInfinityIcon",
  "PanelHeader",
  "EarnMaxStrategiesCard",
  "isEarnMaxUntouched",
  "EarnMaxWorkspace",
]);
const declarations = ast.statements
  .filter((statement) => {
    const identifier = ts.isFunctionDeclaration(statement)
      ? statement.name
      : ts.isVariableStatement(statement)
      ? statement.declarationList.declarations[0].name
      : undefined;
    return (
      identifier && ts.isIdentifier(identifier) && names.has(identifier.text)
    );
  })
  .map((statement) => statement.getText(ast))
  .join("\n");
const code = ts.transpileModule(declarations, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
}).outputText;
let auth = { isHydrated: true, isSignedIn: false };
const Children = ({ children }: { children: React.ReactNode }) => children;
const Empty = () => null;
const context = {
  ...React,
  require,
  exports: {} as {
    EarnMaxWorkspace: React.ComponentType<Record<string, unknown>>;
  },
  useAuthCapability: () => auth,
  EARN_MAX_STRATEGY_NAME: "RWA Loop",
  InfinityIcon: Empty,
  InfoTooltip: ({ text }: { text: string }) =>
    React.createElement("span", null, text),
  ThemedIcon: Empty,
  MiddlePaneSlide: Children,
  PaneReveal: Children,
  SheetReveal: Empty,
  EarnEmptyPane: Empty,
  EarnMaxInvitePane: Empty,
  EarnMaxInfoFaqsCard: () =>
    React.createElement("section", { "data-panel": "earn-max-explainer" }),
  EarnStatsPanel: Empty,
  formatEarnMaxApyLabel: (bps: number) => `${bps / 100}%`,
};
runInNewContext(code, context);
const view = {
  activity: [],
  isLoading: false,
  balanceUsd: 0,
  withdrawal: null,
  forecastApyBps: 1079,
  apyWindowDays: 3,
};
function render(
  isHydrated: boolean,
  isSignedIn: boolean,
  redeemed: boolean | null
) {
  auth = { isHydrated, isSignedIn };
  return renderToStaticMarkup(
    React.createElement(context.exports.EarnMaxWorkspace, {
      earnData: { walletAddress: "fixture-wallet" },
      earnMax: { view, actions: {} },
      invite: { redeemed, redeem: async () => "invalid" },
      onBack: () => {},
      onOpenSettings: () => {},
      onViewAllActivity: () => {},
    })
  );
}
for (const [hydrated, signedIn, redeemed] of [
  [false, false, null],
  [true, false, null],
  [true, false, true],
  [false, true, true],
  [true, true, null],
  [true, true, false],
] as const) {
  const html = render(hydrated, signedIn, redeemed);
  assert.match(html, /data-panel="earn-max-explainer"/);
  assert.doesNotMatch(html, /Strategies|RWA Loop/);
  assert.doesNotMatch(html, /Average Net APY|10\.79%|Vault share-price growth/);
}
assert.match(render(true, true, true), /Strategies/);
assert.doesNotMatch(render(true, true, true), /data-panel="earn-max-explainer"/);
assert.match(render(true, true, true), /Average Net APY/);
assert.match(render(true, true, true), /10\.79%/);
assert.match(render(true, true, true), /over the 3 days since launch/);
view.balanceUsd = 100;
assert.match(render(false, true, true), /data-panel="earn-max-explainer"/);
console.log(
  "PASS: explainer before invite access; Strategies and APY only after confirmed access"
);
