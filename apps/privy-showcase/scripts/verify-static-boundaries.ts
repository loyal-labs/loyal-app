import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const source = join(root, "src");

async function files(dir: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === ".next" || entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else result.push(path);
  }
  return result;
}

const violations: string[] = [];
const allSourceFiles = (await files(source)).filter((path) =>
  /\.(ts|tsx)$/.test(path)
);
for (const path of allSourceFiles) {
  const text = await readFile(path, "utf8");
  const serverOnly =
    path.includes("/lib/server/") || path.includes("/app/api/");
  if (
    !serverOnly &&
    /PRIVY_APP_SECRET|PRIVY_SHOWCASE_POLICY_SIGNER_PK|fromSecretKey/.test(text)
  ) {
    violations.push(
      `${path}: server secret boundary appears in client/shared source`
    );
  }
  if (
    (path.endsWith(".test.ts") || path.includes("/scripts/")) &&
    /sendRawTransaction|signAndSendTransaction/.test(text)
  ) {
    violations.push(`${path}: automated verification may submit a transaction`);
  }
}

const apiRoot = join(source, "app/api");
const routePaths = (await files(apiRoot))
  .filter((path) => basename(path) === "route.ts")
  .map((path) => path.slice(apiRoot.length))
  .sort();
const expectedRoutes = [
  "/sweep/challenge/route.ts",
  "/sweep/config/route.ts",
  "/sweep/execute/route.ts",
];
if (JSON.stringify(routePaths) !== JSON.stringify(expectedRoutes)) {
  violations.push(`Unexpected API surface: ${routePaths.join(", ")}`);
}

const envExample = await readFile(join(root, ".env.example"), "utf8");
for (const name of ["PRIVY_APP_SECRET", "PRIVY_SHOWCASE_POLICY_SIGNER_PK"]) {
  const match = envExample.match(new RegExp(`^${name}=(.*)$`, "m"));
  if (!match || match[1] !== "")
    violations.push(`.env.example must leave ${name} blank`);
}

if (violations.length > 0) throw new Error(violations.join("\n"));
console.log(
  "PASS: secret, API, and no-automated-submission boundaries verified"
);
