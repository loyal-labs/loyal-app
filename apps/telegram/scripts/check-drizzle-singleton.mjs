import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const appRequire = createRequire(import.meta.url);

const findPackageJson = (resolvedEntry) => {
  let currentDir = path.dirname(resolvedEntry);

  while (true) {
    const candidate = path.join(currentDir, "package.json");

    if (fs.existsSync(candidate)) return candidate;

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`Unable to locate package.json for: ${resolvedEntry}`);
    }

    currentDir = parentDir;
  }
};

const appDrizzlePackageJson = findPackageJson(appRequire.resolve("drizzle-orm"));
const dbCorePackageJson = appRequire.resolve("@loyal-labs/db-core");
const dbCoreRequire = createRequire(dbCorePackageJson);
const dbCoreDrizzlePackageJson = findPackageJson(
  dbCoreRequire.resolve("drizzle-orm")
);

if (appDrizzlePackageJson !== dbCoreDrizzlePackageJson) {
  const relativeAppPath = path.relative(process.cwd(), appDrizzlePackageJson);
  const relativeCorePath = path.relative(process.cwd(), dbCoreDrizzlePackageJson);

  console.error(
    [
      "Detected multiple drizzle-orm resolution paths.",
      `- app resolves drizzle-orm at: ${relativeAppPath}`,
      `- @loyal-labs/db-core resolves drizzle-orm at: ${relativeCorePath}`,
      "Use workspace install only (run `bun install` from repo root), then remove app-local node_modules if present.",
    ].join("\n")
  );
  process.exit(1);
}
