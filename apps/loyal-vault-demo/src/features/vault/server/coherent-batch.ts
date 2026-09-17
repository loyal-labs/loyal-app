/**
 * One coherent accounting batch.
 *
 * Every account the vault accounting needs is derived up front and read in a
 * single finalized `getMultipleAccounts` call, so chain time, vault fields,
 * supplies, custody and strategy receipts all belong to one slot. Decoding and
 * validation happen here, typed: a required account that is missing, an account
 * owned by the wrong program, an uninitialized/mistokened SPL account or a
 * failed decode is a failed observation, never a zero.
 */

import {
  findStrategyInitReceiptPda,
  findVaultAssetIdleAuthPda,
  getStrategyInitReceiptDecoder,
  getVaultDecoder,
  VAULT_DISCRIMINATOR,
  STRATEGY_INIT_RECEIPT_DISCRIMINATOR,
} from "@voltr/vault-sdk";
import { findAssociatedTokenPda } from "@solana-program/token";
import { getAddressDecoder } from "@solana/kit";

import type { AccountData } from "./rpc";
import { VAULT_IDENTITY } from "./config";

type DecodedVault = ReturnType<ReturnType<typeof getVaultDecoder>["decode"]>;

const vaultDecoder = getVaultDecoder();
const strategyReceiptDecoder = getStrategyInitReceiptDecoder();
const addressDecoder = getAddressDecoder();

export type CoreFailureKind = "rpc-error" | "account-missing" | "decode-error";
export type CoreFailure = Readonly<{
  ok: false;
  reason: string;
  kind: CoreFailureKind;
}>;

const CONFIG_DISCRIMINATOR = [46, 154, 12, 115, 203, 165, 199, 235] as const;
const CONFIG_EXPECTED_VERSION = 2;
const CONFIG_LENGTH = 472;
const CONFIG_PUBKEY_NAMES = [
  "voltrProgram",
  "voltrVault",
  "strategy",
  "strategyAuth",
  "squadsProgram",
  "settings",
  "settingsSigner",
  "squadsVault",
  "assetMint",
  "tokenProgram",
  "squadsAssetAta",
] as const;
const CONFIG_NUMBER_NAMES = [
  "maxReportNavRaw",
  "maxReportAgeSlots",
] as const;

export type AdaptorReport = Readonly<{
  ok: true;
  configAddress: string;
  adaptorProgram: string;
  version: number;
  vaultIndex: number;
  maxReportNavRaw: string;
  maxReportAgeSlots: string;
  /** True when every decoded binding equals its pinned counterpart. */
  bindingsMatchPinned: boolean;
  bindingMismatches: readonly string[];
}>;

export type StrategyAttribution = Readonly<
  | {
      strategy: string;
      status: "attributed";
      receiptAddress: string;
      adaptorProgram: string;
      positionValueRaw: bigint;
      custodyTrackedRaw: bigint;
      lastUpdatedTs: bigint;
    }
  | { strategy: string; status: "not-bound" }
  | { strategy: string; status: "attribution-failed"; reason: string }
>;

export type VaultCore = Readonly<{
  /** Single slot every account in the batch was read at. */
  slot: number;
  /** Chain time from the Clock sysvar of that same slot. */
  chainTimeSec: bigint;
  vault: DecodedVault;
  assetTotalValue: bigint;
  lpSupplyRaw: bigint;
  lpDecimals: number;
  idleCustodyRaw: bigint;
  idleAuthority: string;
  managerCustody: { address: string; amountRaw: bigint; exists: boolean } | null;
  strategyAttributions: readonly StrategyAttribution[];
  adaptorReport: AdaptorReport | null;
  reportTicket: ReportTicket | null;
  /** Decoded but unattributed findings that keep reconciliation open. */
  disclosures: readonly string[];
}>;

/** Batch entries are addressed by key so a batch can carry wallet accounts too. */
export type BatchAddress = Readonly<{ key: string; address: string }>;

/** Consumed sequence identifies a report; it does not establish its NAV or age. */
export type ReportTicket = Readonly<{ lastConsumedSequence: string; armed: boolean }>;
export function decodeReportTicket(account: AccountData): ReportTicket | null {
  const data = account.data;
  const program = VAULT_IDENTITY.expectedAdaptorProgramByStrategy[VAULT_IDENTITY.adaptorConfigStrategy];
  if (account.address !== VAULT_IDENTITY.reportTicket || account.owner !== program || account.executable !== false ||
      account.lamports <= 0 || data.length !== 96 ||
      ![245, 104, 182, 197, 58, 231, 116, 237].every((value, index) => data[index] === value) ||
      data[8] !== 1 || data[9] !== 255 || data[10]! > 1 || data.slice(11, 16).some(value => value !== 0) ||
      addressDecoder.decode(data.slice(16, 48)) !== VAULT_IDENTITY.adaptorConfigStrategy) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const armed = data[10] === 1;
  const active = view.getBigUint64(56, true);
  const hashZero = data.slice(64, 96).every(value => value === 0);
  if ((!armed && (active !== 0n || !hashZero)) || (armed && (active === 0n || hashZero))) return null;
  return { armed, lastConsumedSequence: view.getBigUint64(48, true).toString() };
}

/** SPL mint account: COption authority (4+32), supply u64 at 36, decimals u8 at 44, initialized u8 at 45. */
function decodeMintAccount(
  account: AccountData,
  expectedAddress: string
): { ok: true; supplyRaw: bigint; decimals: number } | CoreFailure {
  if (account.owner !== VAULT_IDENTITY.tokenProgram) {
    return {
      ok: false,
      kind: "decode-error",
      reason: `${expectedAddress} is owned by ${account.owner}, not the SPL token program`,
    };
  }
  if (account.data.length < 82) {
    return {
      ok: false,
      kind: "decode-error",
      reason: `${expectedAddress} is ${account.data.length} bytes, shorter than a mint account`,
    };
  }
  const view = Buffer.from(
    account.data.buffer,
    account.data.byteOffset,
    account.data.byteLength
  );
  if (view.readUInt8(45) !== 1) {
    return {
      ok: false,
      kind: "decode-error",
      reason: `${expectedAddress} mint is not initialized`,
    };
  }
  return {
    ok: true,
    supplyRaw: view.readBigUInt64LE(36),
    decimals: view.readUInt8(44),
  };
}

/**
 * SPL token account: mint(0..32), authority(32..64), amount u64 at 64, state
 * u8 at 108. Owner program, mint, authority, initialized state and length are
 * all validated before the amount is trusted.
 */
export function decodeSplTokenAccount(
  account: AccountData,
  expected: { mint: string; authority?: string; label: string }
): { ok: true; amountRaw: bigint; authority: string } | CoreFailure {
  if (account.owner !== VAULT_IDENTITY.tokenProgram) {
    return {
      ok: false,
      kind: "decode-error",
      reason: `${expected.label} ${account.address} is owned by ${account.owner}, not the SPL token program`,
    };
  }
  if (account.data.length < 165) {
    return {
      ok: false,
      kind: "decode-error",
      reason: `${expected.label} ${account.address} is ${account.data.length} bytes, shorter than a token account`,
    };
  }
  const view = Buffer.from(
    account.data.buffer,
    account.data.byteOffset,
    account.data.byteLength
  );
  const mint = addressDecoder.decode(account.data.subarray(0, 32));
  if (mint !== expected.mint) {
    return {
      ok: false,
      kind: "decode-error",
      reason: `${expected.label} ${account.address} holds ${mint}, expected ${expected.mint}`,
    };
  }
  const authority = addressDecoder.decode(account.data.subarray(32, 64));
  if (expected.authority && authority !== expected.authority) {
    return {
      ok: false,
      kind: "decode-error",
      reason: `${expected.label} ${account.address} is owned by ${authority}, expected ${expected.authority}`,
    };
  }
  if (![1, 2].includes(view.readUInt8(108))) {
    return {
      ok: false,
      kind: "decode-error",
      reason: `${expected.label} ${account.address} is not initialized`,
    };
  }
  return { ok: true, amountRaw: view.readBigUInt64LE(64), authority };
}

/** Clock sysvar: owned by the sysvar owner program, 40 bytes, unix seconds at offset 32. */
const SYSVAR_OWNER = "Sysvar1111111111111111111111111111111111111";

function decodeClock(
  account: AccountData
): { ok: true; unixSec: bigint } | CoreFailure {
  if (account.owner !== SYSVAR_OWNER) {
    return {
      ok: false,
      kind: "decode-error",
      reason: `clock sysvar is owned by ${account.owner}, expected the sysvar owner`,
    };
  }
  if (account.data.length < 40) {
    return {
      ok: false,
      kind: "decode-error",
      reason: `clock sysvar is ${account.data.length} bytes, shorter than the sysvar layout`,
    };
  }
  return {
    ok: true,
    unixSec: Buffer.from(
      account.data.buffer,
      account.data.byteOffset,
      account.data.byteLength
    ).readBigInt64LE(32),
  };
}

/** Decodes the custom adaptor's config/strategy account and checks its bindings. */
export function decodeAdaptorConfig(
  account: AccountData,
  expectedStrategy: string
): AdaptorReport | CoreFailure {
  const expectedAdaptor =
    VAULT_IDENTITY.expectedAdaptorProgramByStrategy[expectedStrategy];
  if (account.owner !== expectedAdaptor) {
    return {
      ok: false,
      kind: "decode-error",
      reason: `adaptor config ${account.address} is owned by ${account.owner}, expected the pinned adaptor ${expectedAdaptor}`,
    };
  }
  if (account.data.length !== CONFIG_LENGTH) {
    return {
      ok: false,
      kind: "decode-error",
      reason: `adaptor config is ${account.data.length} bytes, expected ${CONFIG_LENGTH}`,
    };
  }
  if (
    !CONFIG_DISCRIMINATOR.every((byte, index) => account.data[index] === byte)
  ) {
    return {
      ok: false,
      kind: "decode-error",
      reason:
        "adaptor config discriminator does not match the pinned adaptor layout",
    };
  }
  const view = Buffer.from(
    account.data.buffer,
    account.data.byteOffset,
    account.data.byteLength
  );
  const version = view.readUInt8(8);
  if (version !== CONFIG_EXPECTED_VERSION) {
    return {
      ok: false,
      kind: "decode-error",
      reason: `adaptor config version ${version} is not the decoded layout version ${CONFIG_EXPECTED_VERSION}`,
    };
  }
  const pubkeys = CONFIG_PUBKEY_NAMES.reduce<Record<string, string>>(
    (all, name, index) => {
      all[name] = addressDecoder.decode(
        account.data.subarray(16 + index * 32, 48 + index * 32)
      );
      return all;
    },
    {}
  );
  const numbers = CONFIG_NUMBER_NAMES.reduce<Record<string, bigint>>(
    (all, name, index) => {
      all[name] = view.readBigUInt64LE(400 + index * 8);
      return all;
    },
    {}
  );
  const pinnedBindings: ReadonlyArray<[string, string]> = [
    ["squadsProgram", "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG"],
    ["settings", VAULT_IDENTITY.smartAccountSettings],
    ["settingsSigner", "BAqgbERmvUViqDSx961xpRBHGt68SpACiWL4t9696qZZ"],
    ["strategyAuth", "5r74AE7yewacfRzoGAjXx5X3gM9LUoLU29eHzdjiLrJo"],
    ["tokenProgram", VAULT_IDENTITY.tokenProgram],
    ["squadsAssetAta", "EBG2iYrcXttDy9FpWDeNVL8uaCLRCkevrpRyrAhvVYKe"],
    ["voltrProgram", VAULT_IDENTITY.voltrProgram],
    ["voltrVault", VAULT_IDENTITY.vault],
    ["strategy", expectedStrategy],
    ["squadsVault", VAULT_IDENTITY.manager],
    ["assetMint", VAULT_IDENTITY.assetMint],
  ];
  const mismatches = pinnedBindings
    .filter(([name, expected]) => pubkeys[name] !== expected)
    .map(([name, expected]) => `${name}=${pubkeys[name]} expected ${expected}`);
  if (view.readUInt8(9) !== VAULT_IDENTITY.smartAccountIndex)
    mismatches.push("smart-account index differs");
  if (numbers.maxReportNavRaw !== 1_000_000_000_000n || numbers.maxReportAgeSlots !== 32n)
    mismatches.push("report bounds differ from the deployed pilot configuration");
  if (account.address !== expectedStrategy)
    mismatches.push("config address differs");
  if (
    account.data.subarray(10, 16).some((byte) => byte !== 0) ||
    account.data.subarray(368, 400).some((byte) => byte !== 0) ||
    account.data.subarray(416, 472).some((byte) => byte !== 0)
  )
    mismatches.push("reserved config fields differ from deployed v2 layout");
  return {
    ok: true,
    configAddress: account.address,
    adaptorProgram: account.owner,
    version,
    vaultIndex: view.readUInt8(9),
    maxReportNavRaw: numbers.maxReportNavRaw!.toString(),
    maxReportAgeSlots: numbers.maxReportAgeSlots!.toString(),
    bindingsMatchPinned: mismatches.length === 0,
    bindingMismatches: mismatches,
  };
}

function strategyReceiptAttribution(
  account: AccountData | null,
  strategy: string
): StrategyAttribution {
  if (!account) return { strategy, status: "not-bound" };
  if (account.owner !== VAULT_IDENTITY.voltrProgram) {
    return {
      strategy,
      status: "attribution-failed",
      reason: `strategy receipt ${account.address} is owned by ${account.owner}, not the Voltr program`,
    };
  }
  if (
    account.lamports <= 0 || account.data.length !== 192 ||
    !STRATEGY_INIT_RECEIPT_DISCRIMINATOR.every(
      (byte, index) => account.data[index] === byte
    )
  )
    return {
      strategy,
      status: "attribution-failed",
      reason: "strategy receipt discriminator mismatch",
    };
  let receipt: ReturnType<
    ReturnType<typeof getStrategyInitReceiptDecoder>["decode"]
  >;
  try {
    receipt = strategyReceiptDecoder.decode(account.data);
  } catch (error) {
    return {
      strategy,
      status: "attribution-failed",
      reason: `strategy receipt ${account.address} decode failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  if (receipt.vault !== VAULT_IDENTITY.vault || receipt.strategy !== strategy) {
    return {
      strategy,
      status: "attribution-failed",
      reason: `strategy receipt ${account.address} binds vault ${receipt.vault}/strategy ${receipt.strategy}, not this vault/lane`,
    };
  }
  const version = (receipt as { version?: number | bigint }).version;
  const isPilotStrategy = strategy === VAULT_IDENTITY.adaptorConfigStrategy;
  const expectedVersion = isPilotStrategy ? 2n : 1n;
  if (version === undefined || BigInt(version) !== expectedVersion ||
      (isPilotStrategy && (account.data.subarray(123, 128).some(byte => byte !== 0) ||
        account.data.subarray(136).some(byte => byte !== 0)))) {
    return {
      strategy,
      status: "attribution-failed",
      reason: `strategy receipt ${
        account.address
      } has unsupported version or reserved fields (${String(version)})`,
    };
  }
  const expectedAdaptor =
    VAULT_IDENTITY.expectedAdaptorProgramByStrategy[strategy];
  if (expectedAdaptor && receipt.adaptorProgram !== expectedAdaptor) {
    return {
      strategy,
      status: "attribution-failed",
      reason: `strategy receipt ${account.address} names adaptor ${receipt.adaptorProgram} instead of the catalogued ${expectedAdaptor}`,
    };
  }
  return {
    strategy,
    status: "attributed",
    receiptAddress: account.address,
    adaptorProgram: receipt.adaptorProgram,
    positionValueRaw: receipt.positionValue,
    custodyTrackedRaw: isPilotStrategy ? Buffer.from(account.data).readBigUInt64LE(128) : 0n,
    lastUpdatedTs: receipt.lastUpdatedTs,
  };
}

/** Every account the coherent vault batch needs, derived before any read. */
export async function deriveVaultBatchAddresses(): Promise<
  ReadonlyArray<BatchAddress>
> {
  const [idleAuth] = await findVaultAssetIdleAuthPda({
    vault: VAULT_IDENTITY.vault,
  });
  const [idleAta] = await findAssociatedTokenPda({
    owner: idleAuth,
    mint: VAULT_IDENTITY.assetMint,
    tokenProgram: VAULT_IDENTITY.tokenProgram,
  });
  const [managerAssetAta] = await findAssociatedTokenPda({
    owner: VAULT_IDENTITY.manager,
    mint: VAULT_IDENTITY.assetMint,
    tokenProgram: VAULT_IDENTITY.tokenProgram,
  });
  const receipts = await Promise.all(
    VAULT_IDENTITY.knownStrategyCandidates.map((strategy) =>
      findStrategyInitReceiptPda({
        vault: VAULT_IDENTITY.vault,
        strategy,
      }).then((pda) => pda[0])
    )
  );
  const addresses: BatchAddress[] = [
    { key: "vault", address: VAULT_IDENTITY.vault },
    { key: "assetMint", address: VAULT_IDENTITY.assetMint },
    { key: "lpMint", address: VAULT_IDENTITY.lpMint },
    { key: "idleAta", address: idleAta },
    { key: "clock", address: VAULT_IDENTITY.clockSysvar },
    { key: "managerAssetAta", address: managerAssetAta },
    { key: "reportTicket", address: VAULT_IDENTITY.reportTicket },
  ];
  VAULT_IDENTITY.knownStrategyCandidates.forEach((strategy, index) => {
    addresses.push({
      key: `strategyReceipt:${strategy}`,
      address: receipts[index]!,
    });
  });
  addresses.push({
    key: `adaptorConfig:${VAULT_IDENTITY.adaptorConfigStrategy}`,
    address: VAULT_IDENTITY.adaptorConfigStrategy,
  });
  return addresses;
}

/** The idle-custody authority the app derives, so a batch can be validated. */
export async function deriveIdleAuthority(): Promise<string> {
  const [idleAuth] = await findVaultAssetIdleAuthPda({
    vault: VAULT_IDENTITY.vault,
  });
  return idleAuth;
}

/**
 * Builds one coherent core from one batch response. Pure: the caller supplies
 * the accounts exactly as the single batch returned them, in batch order.
 */
export function buildCoherentVaultCore(
  batch: ReadonlyArray<BatchAddress>,
  accounts: ReadonlyArray<AccountData | null>,
  slot: number,
  derived: { idleAuthority: string }
): { ok: true; core: VaultCore } | CoreFailure {
  if (
    !Number.isSafeInteger(slot) ||
    slot < 0 ||
    accounts.length !== batch.length ||
    new Set(batch.map((entry) => entry.key)).size !== batch.length
  )
    return {
      ok: false,
      kind: "decode-error",
      reason: "invalid coherent batch membership or slot",
    };
  if (
    accounts.some(
      (account, index) => account && account.address !== batch[index]!.address
    )
  )
    return {
      ok: false,
      kind: "decode-error",
      reason: "account address differs from coherent batch",
    };
  const byKey = new Map<string, AccountData | null>();
  batch.forEach((entry, index) =>
    byKey.set(entry.key, accounts[index] ?? null)
  );
  const disclosures: string[] = [];

  const vaultAccount = byKey.get("vault");
  if (!vaultAccount)
    return {
      ok: false,
      kind: "account-missing",
      reason: `vault account ${VAULT_IDENTITY.vault} does not exist`,
    };
  if (vaultAccount.owner !== VAULT_IDENTITY.voltrProgram) {
    return {
      ok: false,
      kind: "decode-error",
      reason: `vault account is owned by ${vaultAccount.owner}, not the pinned Voltr program`,
    };
  }
  if (
    !VAULT_DISCRIMINATOR.every(
      (byte, index) => vaultAccount.data[index] === byte
    )
  )
    return {
      ok: false,
      kind: "decode-error",
      reason: "vault discriminator mismatch",
    };
  let vault: DecodedVault;
  try {
    vault = vaultDecoder.decode(vaultAccount.data) as DecodedVault;
  } catch (error) {
    return {
      ok: false,
      kind: "decode-error",
      reason: `vault decode failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  if (vault.version !== 4)
    return {
      ok: false,
      kind: "decode-error",
      reason: "unsupported vault layout version",
    };
  // Vault-decoded addresses must equal the pinned/derived identities.
  if (vault.asset.mint !== VAULT_IDENTITY.assetMint) {
    return {
      ok: false,
      kind: "decode-error",
      reason: `vault asset mint ${String(
        vault.asset.mint
      )} is not the pinned asset mint`,
    };
  }
  if (vault.lp.mint !== VAULT_IDENTITY.lpMint) {
    return {
      ok: false,
      kind: "decode-error",
      reason: `vault LP mint ${String(
        vault.lp.mint
      )} is not the pinned LP mint`,
    };
  }
  if (vault.manager !== VAULT_IDENTITY.manager) {
    return {
      ok: false,
      kind: "decode-error",
      reason: `vault manager ${String(
        vault.manager
      )} is not the pinned smart-account vault`,
    };
  }

  const assetMintAccount = byKey.get("assetMint");
  if (!assetMintAccount)
    return {
      ok: false,
      kind: "account-missing",
      reason: `asset mint ${VAULT_IDENTITY.assetMint} does not exist`,
    };
  const assetMint = decodeMintAccount(
    assetMintAccount,
    VAULT_IDENTITY.assetMint
  );
  if (!assetMint.ok) return assetMint;
  if (assetMint.decimals !== VAULT_IDENTITY.assetDecimals)
    return {
      ok: false,
      kind: "decode-error",
      reason: "USDC decimals differ from pinned units",
    };

  const lpMintAccount = byKey.get("lpMint");
  if (!lpMintAccount)
    return {
      ok: false,
      kind: "account-missing",
      reason: `LP mint ${VAULT_IDENTITY.lpMint} does not exist`,
    };
  const lpMint = decodeMintAccount(lpMintAccount, VAULT_IDENTITY.lpMint);
  if (!lpMint.ok) return lpMint;
  if (lpMint.decimals !== VAULT_IDENTITY.lpDecimals) {
    return { ok: false, kind: "decode-error", reason: "LP mint decimals differ from the pinned mint" };
  }

  // Idle custody is required: a missing idle account is a failed observation.
  const idleAccount = byKey.get("idleAta");
  if (!idleAccount) {
    return {
      ok: false,
      kind: "account-missing",
      reason: `vault idle custody ${String(
        vault.asset.idleAta
      )} does not exist`,
    };
  }
  const idle = decodeSplTokenAccount(idleAccount, {
    mint: VAULT_IDENTITY.assetMint,
    authority: derived.idleAuthority,
    label: "vault idle custody",
  });
  if (!idle.ok) return idle;
  // The idle ATA recorded in the vault account must be the one that was read.
  if (idleAccount.address !== vault.asset.idleAta) {
    return {
      ok: false,
      kind: "decode-error",
      reason: `vault records idle custody ${String(
        vault.asset.idleAta
      )} but the derived idle account is ${idleAccount.address}`,
    };
  }

  const clockAccount = byKey.get("clock");
  if (!clockAccount)
    return {
      ok: false,
      kind: "account-missing",
      reason: "clock sysvar is unavailable in this read",
    };
  const clock = decodeClock(clockAccount);
  if (!clock.ok) return clock;
  const chainTimeSec = clock.unixSec;

  const attributions: StrategyAttribution[] =
    VAULT_IDENTITY.knownStrategyCandidates.map((strategy) =>
      strategyReceiptAttribution(
        byKey.get(`strategyReceipt:${strategy}`) ?? null,
        strategy
      )
    );

  const configKey = `adaptorConfig:${VAULT_IDENTITY.adaptorConfigStrategy}`;
  const configAccount = byKey.get(configKey);
  let adaptorReport: AdaptorReport | null = null;
  if (!configAccount) {
    disclosures.push(
      `custom adaptor config ${VAULT_IDENTITY.adaptorConfigStrategy} is absent; NAV freshness is not observable`
    );
  } else {
    const report = decodeAdaptorConfig(
      configAccount,
      VAULT_IDENTITY.adaptorConfigStrategy
    );
    if (report.ok) {
      adaptorReport = report;
      if (!report.bindingsMatchPinned)
        disclosures.push(
          `adaptor config bindings differ from the pinned identity: ${report.bindingMismatches.join(
            "; "
          )}`
        );
    } else {
      disclosures.push(report.reason);
    }
  }

  let managerCustody: VaultCore["managerCustody"] = null;
  const ticketAccount = byKey.get("reportTicket");
  const reportTicket = ticketAccount ? decodeReportTicket(ticketAccount) : null;
  if (!reportTicket) disclosures.push("The report ticket is absent or invalid; consumed-report evidence is unavailable.");
  const managerEntry = batch.find(entry => entry.key === "managerAssetAta");
  const customBound = attributions.some(entry => entry.strategy === VAULT_IDENTITY.adaptorConfigStrategy && entry.status === "attributed");
  if (!managerEntry) {
    disclosures.push("Smart account USDC custody was not included in this observation.");
  } else if (managerEntry.address !== "EBG2iYrcXttDy9FpWDeNVL8uaCLRCkevrpRyrAhvVYKe") {
    return { ok: false, kind: "decode-error", reason: "Smart account custody address differs from the pinned adaptor binding." };
  } else if (!adaptorReport?.bindingsMatchPinned || !customBound) {
    disclosures.push("Smart account USDC custody cannot be attributed without matching adaptor configuration and strategy receipt bindings.");
  } else {
    const account = byKey.get("managerAssetAta");
    if (account) {
      const decoded = decodeSplTokenAccount(account, { mint: VAULT_IDENTITY.assetMint, authority: VAULT_IDENTITY.manager, label: "smart account USDC custody" });
      if (!decoded.ok) return decoded;
      managerCustody = { address: account.address, amountRaw: decoded.amountRaw, exists: true };
    } else {
      managerCustody = { address: managerEntry.address, amountRaw: 0n, exists: false };
    }
  }

  return {
    ok: true,
    core: {
      slot,
      chainTimeSec,
      vault,
      assetTotalValue: vault.asset.totalValue,
      lpSupplyRaw: lpMint.supplyRaw,
      lpDecimals: lpMint.decimals,
      idleCustodyRaw: idle.amountRaw,
      idleAuthority: idle.authority,
      managerCustody,
      strategyAttributions: attributions,
      adaptorReport,
      reportTicket,
      disclosures,
    },
  };
}
