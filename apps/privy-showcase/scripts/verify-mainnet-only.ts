import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const forbidden = [
  "api.devnet.solana.com",
  "api.testnet.solana.com",
  "localhost:8899",
  "127.0.0.1:8899",
];
const extensions = new Set([".ts", ".tsx", ".json", ".md", ".example"]);

async function files(dir: string): Promise<string[]> {
  const output: string[] = [];
  for (const name of await readdir(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const path = join(dir, name);
    const info = await stat(path);
    if (info.isDirectory()) output.push(...(await files(path)));
    else if ([...extensions].some((extension) => path.endsWith(extension)))
      output.push(path);
  }
  return output;
}

const violations: string[] = [];
for (const path of await files(root)) {
  const contents = await readFile(path, "utf8");
  for (const value of forbidden) {
    if (contents.includes(value) && !path.endsWith("verify-mainnet-only.ts")) {
      violations.push(`${path}: contains ${value}`);
    }
  }
}

if (violations.length > 0) {
  throw new Error(`Non-mainnet configuration found:\n${violations.join("\n")}`);
}

console.log("PASS: showcase source is locked to Solana mainnet-beta");
