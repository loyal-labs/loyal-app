import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const repoRoot = resolve(packageRoot, "../..");
const schemaPath = resolve(repoRoot, "crates/loyal-hub-abi/schema/loyal_hub_abi.schema");
const outputPath = resolve(packageRoot, "src/generated/loyal-hub-abi.ts");

type Field = { name: string; kind: string };

if (!existsSync(schemaPath)) {
  if (existsSync(outputPath)) {
    console.warn(
      `Skipping Loyal Hub ABI generation because ${schemaPath} does not exist.`,
    );
    process.exit(0);
  }
  throw new Error(
    `Missing Loyal Hub ABI schema at ${schemaPath} and no generated output exists.`,
  );
}

const source = readFileSync(schemaPath, "utf8");
const seeds = new Map<string, string>();
const limits = new Map<string, number>();
const instructions = new Map<string, number>();
const accounts = new Map<string, Map<string, number>>();
const records = new Map<string, Field[]>();
const instructionRecords = new Map<string, string>();
let currentRecord: string | undefined;

for (const rawLine of source.split("\n")) {
  const line = rawLine.split("#")[0]?.trim();
  if (!line) {
    continue;
  }
  const parts = line.split(/\s+/);
  const [kind] = parts;
  if (kind === "seed") {
    seeds.set(parts[1] ?? "", parts.slice(2).join(" "));
    continue;
  }
  if (kind === "limit") {
    limits.set(parts[1] ?? "", Number(parts[2]));
    continue;
  }
  if (kind === "instruction") {
    instructions.set(parts[1] ?? "", Number(parts[2]));
    continue;
  }
  if (kind === "account") {
    const [, instruction, name, index] = parts;
    const byInstruction = accounts.get(instruction) ?? new Map<string, number>();
    byInstruction.set(name, Number(index));
    accounts.set(instruction, byInstruction);
    continue;
  }
  if (kind === "record") {
    currentRecord = parts[1];
    records.set(currentRecord, []);
    continue;
  }
  if (kind === "field" && currentRecord) {
    records.get(currentRecord)?.push({ name: parts[1] ?? "", kind: parts[2] ?? "" });
    continue;
  }
  if (kind === "end") {
    currentRecord = undefined;
    continue;
  }
  if (kind === "instruction_record") {
    instructionRecords.set(parts[1] ?? "", parts[2] ?? "");
  }
}

const swapRecord = instructionRecords.get("SWAP_EXACT_IN");
if (!swapRecord) {
  throw new Error("SWAP_EXACT_IN has no instruction_record");
}

const swapOffsets = recordOffsets(records.get(swapRecord) ?? []);
const swapAccounts = accounts.get("SWAP_EXACT_IN");
if (!swapAccounts) {
  throw new Error("SWAP_EXACT_IN has no account list");
}

const generated = `// Generated from crates/loyal-hub-abi/schema/loyal_hub_abi.schema.
// Run \`bun run generate:abi\` in packages/loyal-actions after schema changes.

export const CONFIG_SEED = new Uint8Array([${bytesLiteral(seed("CONFIG_SEED"))}]);
export const HUB_AUTHORITY_SEED = new Uint8Array([${bytesLiteral(seed("HUB_AUTHORITY_SEED"))}]);
export const MAX_ALLOWED_MINTS = ${limit("MAX_ALLOWED_MINTS")};
export const MAX_REBALANCE_TRANSFERS = ${limit("MAX_REBALANCE_TRANSFERS")};
export const MAX_FEE_BPS = ${limit("MAX_FEE_BPS")};
export const SWAP_EXACT_IN = ${instruction("SWAP_EXACT_IN")};
export const SWAP_EXACT_IN_TAG_OFFSET = 0;
export const SWAP_EXACT_IN_MAX_FEE_BPS_DATA_OFFSET = ${1 + offset("MAX_FEE_BPS")};

export const swapExactInAccounts = {
${[...swapAccounts.entries()].map(([name, index]) => `  ${name}: ${index},`).join("\n")}
} as const;
`;

writeFileSync(outputPath, generated);

function seed(name: string): string {
  const value = seeds.get(name);
  if (!value) {
    throw new Error(`missing seed ${name}`);
  }
  return value;
}

function limit(name: string): number {
  const value = limits.get(name);
  if (value === undefined) {
    throw new Error(`missing limit ${name}`);
  }
  return value;
}

function instruction(name: string): number {
  const value = instructions.get(name);
  if (value === undefined) {
    throw new Error(`missing instruction ${name}`);
  }
  return value;
}

function offset(name: string): number {
  const value = swapOffsets.get(name);
  if (value === undefined) {
    throw new Error(`missing SWAP_EXACT_IN offset ${name}`);
  }
  return value;
}

function bytesLiteral(value: string): string {
  return [...new TextEncoder().encode(value)].join(", ");
}

function recordOffsets(fields: Field[]): Map<string, number> {
  const offsets = new Map<string, number>();
  let cursor = 0;
  for (const field of fields) {
    offsets.set(field.name, cursor);
    cursor += fieldLen(field.kind);
  }
  return offsets;
}

function fieldLen(kind: string): number {
  switch (kind) {
    case "bool":
    case "u8":
      return 1;
    case "u16":
      return 2;
    case "u64":
      return 8;
    case "pubkey":
      return 32;
    case "bytes8":
      return 8;
    default:
      throw new Error(`unsupported field kind ${kind}`);
  }
}
