import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Solita } from "@metaplex-foundation/solita";
import { PublicKey } from "@solana/web3.js";
import {
  IGNORED_IDL_TYPES,
  OPERATION_REGISTRY,
  PUBLIC_FEATURE_EXPORTS,
  REQUIRED_ACCOUNTS,
  REQUIRED_INSTRUCTIONS,
  findOperationCoverageIssues,
} from "../sdk/loyal-smart-accounts-core/src/spec/index.ts";
import { pda, smartAccounts } from "../sdk/loyal-smart-accounts/index.ts";

type SmartAccountIdl = {
  address?: string;
  instructions?: Array<{ name: string; discriminator?: number[] }>;
  accounts?: Array<{ name: string }>;
  types?: Array<{ name: string }>;
};

type SyncOptions = {
  repoUrl: string;
  ref?: string;
  upstreamDir?: string;
  allowProgramIdChange?: boolean;
  check?: boolean;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, "..");
const PACKAGE_DIR = resolve(ROOT_DIR, "sdk/loyal-smart-accounts-core");
const PUBLIC_PACKAGE_DIR = resolve(ROOT_DIR, "sdk/loyal-smart-accounts");
const RUST_PACKAGE_DIR = resolve(ROOT_DIR, "sdk/loyal-smart-accounts-rs");
const RAW_IDL_PATH = join(
  PACKAGE_DIR,
  "upstream/raw/squads_smart_account_program.json"
);
const NORMALIZED_IDL_PATH = join(
  PACKAGE_DIR,
  "upstream/normalized/squads_smart_account_program.json"
);
const MANIFEST_PATH = join(PACKAGE_DIR, "upstream/manifest.json");
const RUST_MANIFEST_PATH = join(RUST_PACKAGE_DIR, "upstream/manifest.json");
const RUST_IDL_PATH = join(
  RUST_PACKAGE_DIR,
  "upstream/normalized/squads_smart_account_program.json"
);
const RUST_OPERATION_SPEC_PATH = join(
  RUST_PACKAGE_DIR,
  "upstream/operation-spec.json"
);
const RUST_PARITY_CREATE_PATH = join(
  RUST_PACKAGE_DIR,
  "upstream/parity/create-smart-account.json"
);
const RUST_PARITY_PDA_PATH = join(
  RUST_PACKAGE_DIR,
  "upstream/parity/pda-fixtures.json"
);
const RUST_GENERATED_DIR = join(RUST_PACKAGE_DIR, "src/generated");
const GENERATED_DIR = join(PACKAGE_DIR, "src/generated");
const DEFAULT_REPO_URL =
  "https://github.com/Squads-Protocol/smart-account-program";
const UPSTREAM_IDL_PATH = "sdk/smart-account/idl/squads_smart_account_program.json";
const UPSTREAM_SOLITA_CONFIG_PATH = "sdk/smart-account/.solitarc.js";
const UPSTREAM_PROGRAM_LIB_PATH =
  "programs/squads_smart_account_program/src/lib.rs";
const RUST_EXPORTED_FEATURES = ["smartAccounts"] as const;
const RUST_EXPORTED_OPERATIONS = ["createSmartAccount"] as const;

const IGNORED_TYPES = new Set<string>(IGNORED_IDL_TYPES);

export function normalizeSmartAccountIdl<T>(idl: T): T {
  const transform = (value: unknown): unknown => {
    if (value === "SmallVec<u16,u8>") {
      return "bytes";
    }

    if (Array.isArray(value)) {
      return value.map((entry) => transform(entry));
    }

    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (record.defined === "SmallVec<u16,u8>") {
        return "bytes";
      }

      const next: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(record)) {
        next[key] = transform(nested);
      }
      return next;
    }

    return value;
  };

  const normalized = transform(idl) as SmartAccountIdl;
  if (Array.isArray(normalized.types)) {
    normalized.types = normalized.types.filter(
      (entry) => !IGNORED_TYPES.has(entry.name)
    );
  }

  return normalized as T;
}

export function parseProgramIdFromLibRs(source: string): string {
  const match = source.match(/declare_id!\("([^"]+)"\);/);
  const programId = match?.[1];
  if (!programId) {
    throw new Error("Unable to parse program id from lib.rs");
  }
  return programId;
}

export function parseProgramIdFromSolitaConfig(source: string): string {
  const match = source.match(/programId:\s*"([^"]+)"/);
  const programId = match?.[1];
  if (!programId) {
    throw new Error("Unable to parse program id from .solitarc.js");
  }
  return programId;
}

export function validateIdlSurface(idl: SmartAccountIdl): void {
  const instructionNames = new Set(
    (idl.instructions ?? []).map((instruction) => instruction.name)
  );
  const accountNames = new Set((idl.accounts ?? []).map((account) => account.name));

  const missingInstructions = REQUIRED_INSTRUCTIONS.filter(
    (name) => !instructionNames.has(name)
  );
  const missingAccounts = REQUIRED_ACCOUNTS.filter((name) => !accountNames.has(name));

  if (missingInstructions.length > 0) {
    throw new Error(
      `Upstream IDL is missing required instructions: ${missingInstructions.join(", ")}`
    );
  }

  if (missingAccounts.length > 0) {
    throw new Error(
      `Upstream IDL is missing required accounts: ${missingAccounts.join(", ")}`
    );
  }
}

function assertFeatureCoverage(): void {
  const issues = findOperationCoverageIssues();
  if (issues.missingMappings.length === 0 && issues.duplicateExports.length === 0) {
    return;
  }

  throw new Error(
    `Feature coverage validation failed: missing=[${issues.missingMappings.join(
      ", "
    )}] duplicateExports=[${issues.duplicateExports.join(", ")}]`
  );
}

function assertRuntimeBindingCoverage(): void {
  execFileSync(
    "bun",
    ["run", "--cwd", PUBLIC_PACKAGE_DIR, "validate:surface"],
    {
      stdio: "inherit",
    }
  );
}

function assertRustBindingsCompile(): void {
  execFileSync(
    "cargo",
    ["check", "-p", "loyal-smart-accounts-rs"],
    {
      cwd: ROOT_DIR,
      stdio: "inherit",
    }
  );
}

function samplePubkey(byte: number): PublicKey {
  return new PublicKey(Uint8Array.from(Array(32).fill(byte)));
}

function serializeAccountMeta(meta: {
  pubkey: PublicKey;
  isSigner: boolean;
  isWritable: boolean;
}) {
  return {
    pubkey: meta.pubkey.toBase58(),
    isSigner: meta.isSigner,
    isWritable: meta.isWritable,
  };
}

function buildRustOperationSpecJson() {
  return {
    publicFeatures: [...PUBLIC_FEATURE_EXPORTS],
    rustExportedFeatures: [...RUST_EXPORTED_FEATURES],
    rustExportedOperations: [...RUST_EXPORTED_OPERATIONS],
    operations: Object.entries(OPERATION_REGISTRY)
      .filter(([name]) => RUST_EXPORTED_OPERATIONS.includes(name as never))
      .map(([name, meta]) => ({
        name,
        ...meta,
      })),
  };
}

async function buildCreateSmartAccountParityFixture() {
  const smartAccountsInstructions = smartAccounts.instructions as {
    create(request: unknown): {
      programId: PublicKey;
      keys: Array<{
        pubkey: PublicKey;
        isSigner: boolean;
        isWritable: boolean;
      }>;
      data: Uint8Array;
    };
  };
  const smartAccountsPrepare = smartAccounts.prepare as {
    create(request: unknown): Promise<{
      operation: string;
      payer: PublicKey;
      programId: PublicKey;
      requiresConfirmation: boolean;
      instructions: readonly unknown[];
      lookupTableAccounts: readonly unknown[];
    }>;
  };
  const creator = samplePubkey(1);
  const treasury = samplePubkey(2);
  const settings = samplePubkey(3);
  const settingsAuthority = samplePubkey(4);
  const signer2 = samplePubkey(5);
  const rentCollector = samplePubkey(6);

  const request = {
    creator,
    treasury,
    settings,
    settingsAuthority,
    threshold: 2,
    signers: [
      { key: creator, permissions: { mask: 7 } },
      { key: signer2, permissions: { mask: 3 } },
    ],
    timeLock: 42,
    rentCollector,
    memo: "hello",
  };

  const instruction = smartAccountsInstructions.create(request);
  const prepared = await smartAccountsPrepare.create(request);

  return {
    programId: instruction.programId.toBase58(),
    create: {
      request: {
        creator: creator.toBase58(),
        treasury: treasury.toBase58(),
        settings: settings.toBase58(),
        settingsAuthority: settingsAuthority.toBase58(),
        threshold: 2,
        signers: request.signers.map((signer) => ({
          key: signer.key.toBase58(),
          permissions: signer.permissions,
        })),
        timeLock: 42,
        rentCollector: rentCollector.toBase58(),
        memo: "hello",
      },
      instruction: {
        programId: instruction.programId.toBase58(),
        keys: instruction.keys.map((key) => serializeAccountMeta(key)),
        data: Array.from(instruction.data),
      },
      prepared: {
        operation: prepared.operation,
        payer: prepared.payer.toBase58(),
        programId: prepared.programId.toBase58(),
        requiresConfirmation: prepared.requiresConfirmation,
        instructionCount: prepared.instructions.length,
        lookupTableCount: prepared.lookupTableAccounts.length,
      },
    },
  };
}

function buildPdaParityFixture() {
  const settings = samplePubkey(3);
  const consensus = samplePubkey(7);
  const seed = samplePubkey(8);
  const transactionPda = samplePubkey(9);
  const creator = samplePubkey(1);

  const serializePda = ([address, bump]: [PublicKey, number]) => ({
    address: address.toBase58(),
    bump,
  });

  return {
    pda: {
      programConfig: serializePda(pda.getProgramConfigPda({})),
      settings: serializePda(pda.getSettingsPda({ accountIndex: 1n })),
      smartAccount: serializePda(
        pda.getSmartAccountPda({ settingsPda: settings, accountIndex: 2 })
      ),
      transaction: serializePda(
        pda.getTransactionPda({ settingsPda: settings, transactionIndex: 9n })
      ),
      proposal: serializePda(
        pda.getProposalPda({ settingsPda: settings, transactionIndex: 9n })
      ),
      batchTransaction: serializePda(
        pda.getBatchTransactionPda({
          settingsPda: settings,
          batchIndex: 4n,
          transactionIndex: 3,
        })
      ),
      ephemeralSigner: serializePda(
        pda.getEphemeralSignerPda({
          transactionPda,
          ephemeralSignerIndex: 7,
        })
      ),
      spendingLimit: serializePda(
        pda.getSpendingLimitPda({ settingsPda: settings, seed })
      ),
      transactionBuffer: serializePda(
        pda.getTransactionBufferPda({
          consensusPda: consensus,
          creator,
          bufferIndex: 5,
        })
      ),
      policy: serializePda(
        pda.getPolicyPda({ settingsPda: settings, policySeed: 11 })
      ),
    },
  };
}

function renderRustGeneratedConstants(programId: string, discriminator: number[]) {
  const programIdBytes = [...new PublicKey(programId).toBytes()];
  return `// Generated by scripts/update-loyal-smart-accounts.ts. Do not edit manually.

use solana_sdk::pubkey::Pubkey;

pub const PROGRAM_ADDRESS: &str = "${programId}";
pub const PROGRAM_ID: Pubkey = Pubkey::new_from_array([${programIdBytes.join(", ")}]);
pub const CREATE_SMART_ACCOUNT_DISCRIMINATOR: [u8; 8] = [${discriminator.join(", ")}];
`;
}

function renderRustGeneratedTypes() {
  return `// Generated by scripts/update-loyal-smart-accounts.ts. Do not edit manually.

use borsh::{BorshDeserialize, BorshSerialize};
use solana_sdk::pubkey::Pubkey;

#[derive(Debug, Clone, Copy, PartialEq, Eq, BorshSerialize, BorshDeserialize, Default)]
pub struct Permissions {
    pub mask: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct SmartAccountSigner {
    pub key: Pubkey,
    pub permissions: Permissions,
}

#[derive(Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct CreateSmartAccountArgs {
    pub settings_authority: Option<Pubkey>,
    pub threshold: u16,
    pub signers: Vec<SmartAccountSigner>,
    pub time_lock: u32,
    pub rent_collector: Option<Pubkey>,
    pub memo: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct CreateSmartAccountInstructionArgs {
    pub instruction_discriminator: [u8; 8],
    pub args: CreateSmartAccountArgs,
}
`;
}

function renderRustGeneratedInstructions() {
  return `// Generated by scripts/update-loyal-smart-accounts.ts. Do not edit manually.

use borsh::to_vec;
use solana_sdk::instruction::{AccountMeta, Instruction};
use solana_sdk::pubkey::Pubkey;

use super::constants::{CREATE_SMART_ACCOUNT_DISCRIMINATOR, PROGRAM_ID};
use super::types::{CreateSmartAccountArgs, CreateSmartAccountInstructionArgs};

#[derive(Debug, Clone)]
pub struct CreateSmartAccountAccounts {
    pub program_config: Pubkey,
    pub treasury: Pubkey,
    pub creator: Pubkey,
    pub system_program: Pubkey,
    pub program: Pubkey,
    pub anchor_remaining_accounts: Vec<AccountMeta>,
}

pub fn create_create_smart_account_instruction(
    accounts: CreateSmartAccountAccounts,
    args: CreateSmartAccountArgs,
    program_id: Option<Pubkey>,
) -> Result<Instruction, std::io::Error> {
    let data = to_vec(&CreateSmartAccountInstructionArgs {
        instruction_discriminator: CREATE_SMART_ACCOUNT_DISCRIMINATOR,
        args,
    })?;

    let mut keys = vec![
        AccountMeta::new(accounts.program_config, false),
        AccountMeta::new(accounts.treasury, false),
        AccountMeta::new(accounts.creator, true),
        AccountMeta::new_readonly(accounts.system_program, false),
        AccountMeta::new_readonly(accounts.program, false),
    ];
    keys.extend(accounts.anchor_remaining_accounts);

    Ok(Instruction {
        program_id: program_id.unwrap_or(PROGRAM_ID),
        accounts: keys,
        data,
    })
}
`;
}

function renderRustGeneratedOperationSpec() {
  return `// Generated by scripts/update-loyal-smart-accounts.ts. Do not edit manually.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportedFeature {
    SmartAccounts,
}

impl ExportedFeature {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::SmartAccounts => "smartAccounts",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OperationPhase {
    Offline,
    Online,
}

pub trait OperationSpec: Copy {
    const NAME: &'static str;
    const FEATURE: ExportedFeature;
    const EXPORTED_NAME: &'static str;
    const PHASE: OperationPhase;
    const REQUIRES_CONFIRMATION: bool;
    const REQUIRES_LOOKUP_TABLES: bool;
    const REQUIRES_RPC_STATE: bool;
    const INSTRUCTION_EXPOSED: bool;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CreateSmartAccountOperation;

impl OperationSpec for CreateSmartAccountOperation {
    const NAME: &'static str = "createSmartAccount";
    const FEATURE: ExportedFeature = ExportedFeature::SmartAccounts;
    const EXPORTED_NAME: &'static str = "create";
    const PHASE: OperationPhase = OperationPhase::Offline;
    const REQUIRES_CONFIRMATION: bool = false;
    const REQUIRES_LOOKUP_TABLES: bool = false;
    const REQUIRES_RPC_STATE: bool = false;
    const INSTRUCTION_EXPOSED: bool = true;
}

pub const RUST_EXPORTED_FEATURES: &[ExportedFeature] = &[ExportedFeature::SmartAccounts];
pub const RUST_EXPORTED_OPERATIONS: &[&str] = &[CreateSmartAccountOperation::NAME];
`;
}

function renderRustGeneratedMod() {
  return `pub mod constants;
pub mod instructions;
pub mod operation_spec;
pub mod types;
`;
}

function parseArgs(argv: string[]): SyncOptions {
  const options: SyncOptions = {
    repoUrl: DEFAULT_REPO_URL,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--repo" && next) {
      options.repoUrl = next;
      index += 1;
      continue;
    }
    if (current === "--ref" && next) {
      options.ref = next;
      index += 1;
      continue;
    }
    if (current === "--upstream-dir" && next) {
      options.upstreamDir = resolve(next);
      index += 1;
      continue;
    }
    if (current === "--allow-program-id-change") {
      options.allowProgramIdChange = true;
      continue;
    }
    if (current === "--check") {
      options.check = true;
    }
  }

  return options;
}

function resolveUpstreamDirectory(options: SyncOptions): string {
  if (options.upstreamDir) {
    return options.upstreamDir;
  }

  const cloneDir = join(
    tmpdir(),
    `loyal-smart-accounts-${Date.now().toString(36)}`
  );
  execFileSync("git", ["clone", "--depth=1", options.repoUrl, cloneDir], {
    stdio: "inherit",
  });
  if (options.ref) {
    execFileSync("git", ["-C", cloneDir, "fetch", "--depth=1", "origin", options.ref], {
      stdio: "inherit",
    });
    execFileSync("git", ["-C", cloneDir, "checkout", options.ref], {
      stdio: "inherit",
    });
  }
  return cloneDir;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function normalizeText(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function assertOrWriteFile(args: {
  path: string;
  content: string;
  check?: boolean;
}): void {
  const normalizedContent = normalizeText(args.content);
  const existingContent = existsSync(args.path)
    ? readFileSync(args.path, "utf8")
    : null;

  if (args.check) {
    if (existingContent !== normalizedContent) {
      throw new Error(`Drift detected for ${args.path}`);
    }
    return;
  }

  mkdirSync(dirname(args.path), { recursive: true });
  writeFileSync(args.path, normalizedContent, "utf8");
}

function collectFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root, { recursive: true })
    .filter((entry) => {
      const fullPath = join(root, entry.toString());
      return statSync(fullPath).isFile();
    })
    .map((entry) => entry.toString())
    .sort();
}

function assertOrReplaceDirectory(args: {
  targetDir: string;
  sourceDir: string;
  check?: boolean;
}): void {
  const targetFiles = collectFiles(args.targetDir);
  const sourceFiles = collectFiles(args.sourceDir);

  if (args.check) {
    if (targetFiles.length !== sourceFiles.length) {
      throw new Error(`Generated output drift detected in ${args.targetDir}`);
    }

    for (let index = 0; index < sourceFiles.length; index += 1) {
      if (targetFiles[index] !== sourceFiles[index]) {
        throw new Error(`Generated output drift detected in ${args.targetDir}`);
      }

      const targetContent = readFileSync(
        join(args.targetDir, targetFiles[index]),
        "utf8"
      );
      const sourceContent = readFileSync(
        join(args.sourceDir, sourceFiles[index]),
        "utf8"
      );

      if (targetContent !== sourceContent) {
        throw new Error(`Generated output drift detected in ${args.targetDir}`);
      }
    }

    return;
  }

  rmSync(args.targetDir, { recursive: true, force: true });
  mkdirSync(dirname(args.targetDir), { recursive: true });

  for (const relativePath of sourceFiles) {
    const destinationPath = join(args.targetDir, relativePath);
    mkdirSync(dirname(destinationPath), { recursive: true });
    writeFileSync(
      destinationPath,
      readFileSync(join(args.sourceDir, relativePath), "utf8"),
      "utf8"
    );
  }
}

export async function syncFromUpstream(options: SyncOptions): Promise<{
  commitSha: string;
  programId: string;
}> {
  const upstreamDir = resolveUpstreamDirectory(options);
  const rawIdlPath = join(upstreamDir, UPSTREAM_IDL_PATH);
  const solitaConfigPath = join(upstreamDir, UPSTREAM_SOLITA_CONFIG_PATH);
  const programLibPath = join(upstreamDir, UPSTREAM_PROGRAM_LIB_PATH);
  const upstreamPackageJsonPath = join(upstreamDir, "sdk/smart-account/package.json");

  const rawIdl = readJson<SmartAccountIdl>(rawIdlPath);
  const normalizedIdl = normalizeSmartAccountIdl(rawIdl);
  validateIdlSurface(normalizedIdl);

  const libProgramId = parseProgramIdFromLibRs(readFileSync(programLibPath, "utf8"));
  const solitaProgramId = parseProgramIdFromSolitaConfig(
    readFileSync(solitaConfigPath, "utf8")
  );
  const idlProgramId = normalizedIdl.address ?? solitaProgramId;
  const programId = idlProgramId;

  if (libProgramId !== programId || solitaProgramId !== programId) {
    throw new Error(
      `Upstream program id mismatch: lib.rs=${libProgramId}, solita=${solitaProgramId}, idl=${idlProgramId}`
    );
  }

  const currentManifest = existsSync(MANIFEST_PATH)
    ? readJson<{ programId: string; fetchedAt?: string }>(MANIFEST_PATH)
    : null;
  if (
    currentManifest &&
    currentManifest.programId !== programId &&
    !options.allowProgramIdChange
  ) {
    throw new Error(
      `Program id changed from ${currentManifest.programId} to ${programId}. Re-run with --allow-program-id-change if intended.`
    );
  }

  mkdirSync(join(PACKAGE_DIR, "upstream/raw"), { recursive: true });
  mkdirSync(join(PACKAGE_DIR, "upstream/normalized"), { recursive: true });

  const commitSha = execFileSync("git", ["-C", upstreamDir, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const upstreamPackage = readJson<{ name: string; version: string }>(
    upstreamPackageJsonPath
  );
  const manifest = {
    repoUrl: options.repoUrl,
    commitSha,
    fetchedAt:
      options.check && currentManifest?.fetchedAt
        ? currentManifest.fetchedAt
        : new Date().toISOString().slice(0, 10),
    sourceIdlPath: UPSTREAM_IDL_PATH,
    sourceProgramLibPath: UPSTREAM_PROGRAM_LIB_PATH,
    sourceSolitaConfigPath: UPSTREAM_SOLITA_CONFIG_PATH,
    normalizedIdlPath: "upstream/normalized/squads_smart_account_program.json",
    generatedFromNormalizedIdl: true,
    generator: "@metaplex-foundation/solita@0.20.0",
    programId,
    upstreamPackageName: upstreamPackage.name,
    upstreamPackageVersion: upstreamPackage.version,
  };
  const createSmartAccountInstruction = normalizedIdl.instructions?.find(
    (instruction) => instruction.name === "createSmartAccount"
  );
  const createSmartAccountDiscriminator =
    createSmartAccountInstruction?.discriminator;

  if (
    !createSmartAccountDiscriminator ||
    createSmartAccountDiscriminator.length !== 8
  ) {
    throw new Error(
      "Unable to resolve createSmartAccount discriminator from normalized IDL"
    );
  }

  assertOrWriteFile({
    path: RAW_IDL_PATH,
    content: JSON.stringify(rawIdl, null, 2),
    check: options.check,
  });
  assertOrWriteFile({
    path: NORMALIZED_IDL_PATH,
    content: JSON.stringify(normalizedIdl, null, 2),
    check: options.check,
  });
  assertOrWriteFile({
    path: MANIFEST_PATH,
    content: JSON.stringify(manifest, null, 2),
    check: options.check,
  });
  assertOrWriteFile({
    path: RUST_MANIFEST_PATH,
    content: JSON.stringify(manifest, null, 2),
    check: options.check,
  });
  assertOrWriteFile({
    path: RUST_IDL_PATH,
    content: JSON.stringify(normalizedIdl, null, 2),
    check: options.check,
  });
  assertOrWriteFile({
    path: RUST_OPERATION_SPEC_PATH,
    content: JSON.stringify(buildRustOperationSpecJson(), null, 2),
    check: options.check,
  });
  assertOrWriteFile({
    path: RUST_PARITY_CREATE_PATH,
    content: JSON.stringify(await buildCreateSmartAccountParityFixture(), null, 2),
    check: options.check,
  });
  assertOrWriteFile({
    path: RUST_PARITY_PDA_PATH,
    content: JSON.stringify(buildPdaParityFixture(), null, 2),
    check: options.check,
  });

  const tempGeneratedDir = join(
    tmpdir(),
    `loyal-smart-accounts-generated-${Date.now().toString(36)}`
  );
  const generator = new Solita(normalizedIdl as any, {
    formatCode: true,
  });
  await generator.renderAndWriteTo(tempGeneratedDir);

  assertOrReplaceDirectory({
    targetDir: GENERATED_DIR,
    sourceDir: tempGeneratedDir,
    check: options.check,
  });

  const tempRustGeneratedDir = join(
    tmpdir(),
    `loyal-smart-accounts-rs-generated-${Date.now().toString(36)}`
  );
  mkdirSync(tempRustGeneratedDir, { recursive: true });
  writeFileSync(join(tempRustGeneratedDir, "mod.rs"), renderRustGeneratedMod(), "utf8");
  writeFileSync(
    join(tempRustGeneratedDir, "constants.rs"),
    renderRustGeneratedConstants(programId, createSmartAccountDiscriminator),
    "utf8"
  );
  writeFileSync(
    join(tempRustGeneratedDir, "types.rs"),
    renderRustGeneratedTypes(),
    "utf8"
  );
  writeFileSync(
    join(tempRustGeneratedDir, "instructions.rs"),
    renderRustGeneratedInstructions(),
    "utf8"
  );
  writeFileSync(
    join(tempRustGeneratedDir, "operation_spec.rs"),
    renderRustGeneratedOperationSpec(),
    "utf8"
  );

  assertOrReplaceDirectory({
    targetDir: RUST_GENERATED_DIR,
    sourceDir: tempRustGeneratedDir,
    check: options.check,
  });

  assertFeatureCoverage();
  assertRuntimeBindingCoverage();
  assertRustBindingsCompile();

  return {
    commitSha,
    programId,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await syncFromUpstream(options);
  console.log(
    `${options.check ? "Validated" : "Updated"} loyal-smart-accounts from ${options.repoUrl} at ${result.commitSha} (${result.programId})`
  );
}

if (import.meta.main) {
  await main();
}
