import { describe, expect, test } from "bun:test";

import { selectMirrorsForChangedPaths } from "./selection";

function reposFor(paths: string[]): string[] {
  return selectMirrorsForChangedPaths(paths).map((mirror) => mirror.repo);
}

describe("selectMirrorsForChangedPaths", () => {
  test("selects only the directly changed app mirror when root lockfile also changes", () => {
    expect(
      reposFor([
        "bun.lock",
        "extension/package.json",
        "extension/src/components/wallet/wallet-provider.tsx",
      ])
    ).toEqual(["loyal-labs/loyal-extension"]);
  });

  test("fans package changes out to generated app mirrors and the packages mirror", () => {
    expect(reposFor(["packages/shared/src/index.ts"])).toEqual([
      "loyal-labs/loyal-webapp",
      "loyal-labs/loyal-telegram-app",
      "loyal-labs/loyal-mobile",
      "loyal-labs/loyal-extension",
      "loyal-labs/loyal-packages",
    ]);
  });

  test("fans sdk changes out to generated app mirrors and the sdk mirror", () => {
    expect(reposFor(["sdk/private-transactions/index.ts"])).toEqual([
      "loyal-labs/loyal-webapp",
      "loyal-labs/loyal-telegram-app",
      "loyal-labs/loyal-mobile",
      "loyal-labs/loyal-extension",
      "loyal-labs/loyal-sdk",
    ]);
  });

  test("selects every mirror when the mirror generator changes", () => {
    expect(reposFor(["scripts/mirror-repos/file-rewrites.ts"])).toEqual([
      "loyal-labs/loyal-webapp",
      "loyal-labs/loyal-telegram-app",
      "loyal-labs/loyal-mobile",
      "loyal-labs/loyal-extension",
      "loyal-labs/loyal-sdk",
      "loyal-labs/loyal-packages",
      "loyal-labs/loyal-cli",
      "loyal-labs/loyal-contracts",
    ]);
  });

  test("skips unrelated repository areas", () => {
    expect(reposFor(["admin/src/app/page.tsx", "docs/notes.md"])).toEqual([]);
  });
});
