/**
 * Transaction domain: request validation, canonical account binding and
 * unsigned transaction construction for the three user money actions.
 *
 * Pure and offline-runnable: no RPC, no wall clock, no signing material. The
 * wallet enters as `createNoopSigner`, which only marks the required-signer
 * role on instruction accounts; `compileTransaction` then fills every required
 * signature with null, so the encoded wire transaction carries a zeroed
 * signature slot for that wallet and is never signed or broadcast here.
 *
 * Identities come from the single public pinned table in `./identity` (a
 * read-only import, and not a cycle: that module imports nothing from this
 * one), so the app holds exactly one copy of the vault/program/mint bindings.
 */

import bs58 from "bs58";
import { Buffer } from "buffer";
import {
  address,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder,
  getMinimumBalanceForRentExemption,
  getTransactionDecoder,
  getTransactionEncoder,
  isSignerRole,
  isWritableRole,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstructionAsync } from "@solana-program/token";
import {
  findProtocolPda,
  findRequestWithdrawVaultReceiptPda,
  findVaultAssetIdleAuthPda,
  findVaultLpMintAuthPda,
  findVaultLpMintPda,
  getDepositVaultInstructionAsync,
  getRequestWithdrawVaultInstructionAsync,
  getWithdrawVaultInstructionAsync,
  getRequestWithdrawVaultReceiptSize,
} from "@voltr/vault-sdk";

import {
  assetsForWithdrawAmount,
  lpForDepositAmount,
  type VaultSnapshot,
} from "./accounting";
import type { RawAmount } from "./types";
import { VAULT_IDENTITY, parseWalletParam } from "./identity";

/** The only money actions this app exposes. Nothing else is buildable. */
export type VaultAction = "deposit" | "request-withdraw" | "claim";

export const VAULT_ACTIONS: readonly VaultAction[] = ["deposit", "request-withdraw", "claim"];

export const U64_MAX = 18_446_744_073_709_551_615n;

/** Protocol base fee per signature; no priority fee is ever added here. */
export const LAMPORTS_PER_SIGNATURE = 5_000n;

const SPL_TOKEN_ACCOUNT_SPACE = 165n;

const SYSTEM_PROGRAM = address("11111111111111111111111111111111");

function encodeDiscriminator(data: Uint8Array): string {
  return bs58.encode(data.subarray(0, 8));
}

/* --------------------------------------------------------- request parsing */

export type ParsedPrepareRequest = Readonly<
  | { action: "deposit"; wallet: Address; amountRaw: bigint; withdrawAll: false }
  | { action: "request-withdraw"; wallet: Address; amountRaw: bigint | null; withdrawAll: boolean }
  | { action: "claim"; wallet: Address; amountRaw: null; withdrawAll: false }
>;

export type PrepareRequestParse =
  | { ok: true; request: ParsedPrepareRequest }
  | { ok: false; reason: string; field?: string };

const ALLOWED_KEYS: Readonly<Record<VaultAction, readonly string[]>> = {
  deposit: ["wallet", "action", "amountRaw"],
  "request-withdraw": ["wallet", "action", "amountRaw", "withdrawAll"],
  claim: ["wallet", "action"],
};

/**
 * Parses a raw JSON body into a discriminated request. Any key outside the
 * action's allow-list is rejected — a caller can never steer the vault,
 * program, mint, recipient, accounts or fee payer — and amounts must be
 * positive decimal integer strings inside the u64 range.
 */
export function parsePrepareRequest(input: unknown): PrepareRequestParse {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, reason: "body must be a JSON object" };
  }
  const body = input as Record<string, unknown>;

  if (typeof body.action !== "string") {
    return { ok: false, reason: 'body field "action" is required and must be a string', field: "action" };
  }
  if (!VAULT_ACTIONS.includes(body.action as VaultAction)) {
    return {
      ok: false,
      reason: `unsupported action ${JSON.stringify(body.action)}; this endpoint accepts only ${VAULT_ACTIONS.join(", ")}`,
      field: "action",
    };
  }
  const action = body.action as VaultAction;

  const allowed = ALLOWED_KEYS[action];
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      return {
        ok: false,
        reason: `unsupported body field ${JSON.stringify(key)}; ${action} accepts only ${allowed.join(", ")}`,
        field: key,
      };
    }
  }

  const walletParse = parseWalletParam(typeof body.wallet === "string" ? body.wallet : null);
  if (!walletParse.ok) {
    return { ok: false, reason: `body field "wallet": ${walletParse.reason}`, field: "wallet" };
  }

  if (action === "claim") {
    if (body.amountRaw !== undefined) {
      return { ok: false, reason: "claim takes no amount: it is defined by the on-chain receipt", field: "amountRaw" };
    }
    if (body.withdrawAll !== undefined) {
      return { ok: false, reason: "claim takes no withdrawAll flag", field: "withdrawAll" };
    }
    return { ok: true, request: { action, wallet: walletParse.wallet, amountRaw: null, withdrawAll: false } };
  }

  const withdrawAllPresent = body.withdrawAll !== undefined;
  if (withdrawAllPresent) {
    if (body.withdrawAll !== true) {
      return {
        ok: false,
        reason: "withdrawAll must be the boolean true when present; omit it and send amountRaw for a partial request",
        field: "withdrawAll",
      };
    }
    if (action !== "request-withdraw") {
      return { ok: false, reason: `withdrawAll only applies to request-withdraw, not ${action}`, field: "withdrawAll" };
    }
  }
  if (action === "deposit" && withdrawAllPresent) {
    return { ok: false, reason: "deposit takes no withdrawAll flag", field: "withdrawAll" };
  }

  if (body.amountRaw === undefined) {
    if (withdrawAllPresent) {
      return {
        ok: true,
        request: { action: "request-withdraw", wallet: walletParse.wallet, amountRaw: null, withdrawAll: true },
      };
    }
    return {
      ok: false,
      reason: `${action} requires "amountRaw" as a positive decimal integer string (or withdrawAll: true for request-withdraw)`,
      field: "amountRaw",
    };
  }
  if (withdrawAllPresent) {
    return {
      ok: false,
      reason: "send either amountRaw (partial request) or withdrawAll: true, never both",
      field: "amountRaw",
    };
  }

  const amount = parseAmountRaw(body.amountRaw);
  if (!amount.ok) return { ok: false, reason: amount.reason, field: "amountRaw" };

  return {
    ok: true,
    request:
      action === "deposit"
        ? { action, wallet: walletParse.wallet, amountRaw: amount.amountRaw, withdrawAll: false }
        : { action, wallet: walletParse.wallet, amountRaw: amount.amountRaw, withdrawAll: false },
  };
}

type AmountParse = { ok: true; amountRaw: bigint } | { ok: false; reason: string };

function parseAmountRaw(value: unknown): AmountParse {
  // A JSON number is refused on purpose: binary floats cannot carry u64 raw
  // amounts without silent rounding.
  if (typeof value !== "string") {
    return { ok: false, reason: "amountRaw must be a decimal integer string, not a number" };
  }
  if (!/^[1-9][0-9]*$/.test(value)) {
    return {
      ok: false,
      reason: "amountRaw must be a positive decimal integer string with no sign, decimals, exponent or zero value",
    };
  }
  const amountRaw = BigInt(value);
  if (amountRaw > U64_MAX) {
    return { ok: false, reason: `amountRaw exceeds the u64 maximum ${U64_MAX}` };
  }
  return { ok: true, amountRaw };
}

/* ------------------------------------------------------- canonical accounts */

export type CanonicalUserAccounts = Readonly<{
  protocol: Address;
  idleAuth: Address;
  idleAta: Address;
  lpMint: Address;
  lpMintAuth: Address;
  userAssetAta: Address;
  userLpAta: Address;
  receipt: Address;
  escrowLpAta: Address;
}>;

/**
 * Derives every account the three user actions can touch for this wallet from
 * the pinned identities. Nothing here comes from a request.
 */
export async function deriveCanonicalUserAccounts(wallet: Address): Promise<CanonicalUserAccounts> {
  const program = VAULT_IDENTITY.voltrProgram;
  const [protocol] = await findProtocolPda({ programAddress: program });
  const [idleAuth] = await findVaultAssetIdleAuthPda({ vault: VAULT_IDENTITY.vault }, { programAddress: program });
  const [lpMint] = await findVaultLpMintPda({ vault: VAULT_IDENTITY.vault }, { programAddress: program });
  const [lpMintAuth] = await findVaultLpMintAuthPda({ vault: VAULT_IDENTITY.vault }, { programAddress: program });
  const associated = async (owner: Address, mint: Address): Promise<Address> => {
    const [account] = await findAssociatedTokenPda(
      { owner, mint, tokenProgram: VAULT_IDENTITY.tokenProgram },
      { programAddress: VAULT_IDENTITY.associatedTokenProgram },
    );
    return account;
  };
  const idleAta = await associated(idleAuth, VAULT_IDENTITY.assetMint);
  const [userAssetAta, userLpAta] = await Promise.all([
    associated(wallet, VAULT_IDENTITY.assetMint),
    associated(wallet, lpMint),
  ]);
  const [receipt] = await findRequestWithdrawVaultReceiptPda(
    { vault: VAULT_IDENTITY.vault, userTransferAuthority: wallet },
    { programAddress: program },
  );
  const escrowLpAta = await associated(receipt, lpMint);
  return { protocol, idleAuth, idleAta, lpMint, lpMintAuth, userAssetAta, userLpAta, receipt, escrowLpAta };
}

/* --------------------------------------------------- canonical instruction */

export type CanonicalAccount = Readonly<{
  index: number;
  label: string;
  address: string;
  signer: boolean;
  writable: boolean;
}>;

export type CanonicalInstruction = Readonly<{
  index: number;
  programAddress: string;
  /** base58 of the first eight data bytes: the Anchor discriminator. */
  discriminatorBase58: string;
  dataLength: number;
  accounts: readonly CanonicalAccount[];
}>;

const DEPOSIT_VAULT_LABELS = [
  "userTransferAuthority",
  "protocol",
  "vault",
  "vaultAssetMint",
  "vaultLpMint",
  "userAssetAta",
  "vaultAssetIdleAta",
  "vaultAssetIdleAuth",
  "userLpAta",
  "vaultLpMintAuth",
  "assetTokenProgram",
  "lpTokenProgram",
  "systemProgram",
] as const;

const REQUEST_WITHDRAW_LABELS = [
  "payer",
  "userTransferAuthority",
  "protocol",
  "vault",
  "vaultLpMint",
  "userLpAta",
  "requestWithdrawLpAta",
  "requestWithdrawVaultReceipt",
  "lpTokenProgram",
  "systemProgram",
] as const;

/** The claim instruction takes no amount: the receipt defines the payout. */
const CLAIM_WITHDRAW_LABELS = [
  "userTransferAuthority",
  "protocol",
  "vault",
  "vaultAssetMint",
  "vaultLpMint",
  "requestWithdrawLpAta",
  "vaultAssetIdleAta",
  "vaultAssetIdleAuth",
  "userAssetAta",
  "requestWithdrawVaultReceipt",
  "assetTokenProgram",
  "lpTokenProgram",
  "systemProgram",
] as const;

const CREATE_ATA_LABELS = ["payer", "ata", "owner", "mint", "systemProgram", "tokenProgram"] as const;

const LABELS_BY_ACTION: Readonly<Record<VaultAction, readonly string[]>> = {
  deposit: DEPOSIT_VAULT_LABELS,
  "request-withdraw": REQUEST_WITHDRAW_LABELS,
  claim: CLAIM_WITHDRAW_LABELS,
};

export function canonicalForm(instruction: Instruction, index: number, labels: readonly string[]): CanonicalInstruction {
  const metas = instruction.accounts ?? [];
  if (metas.length !== labels.length) {
    throw new Error(`Voltr account label count ${labels.length} does not match ${metas.length}`);
  }
  const data = new Uint8Array(instruction.data ?? []);
  return {
    index,
    programAddress: instruction.programAddress,
    discriminatorBase58: encodeDiscriminator(data),
    dataLength: data.length,
    accounts: metas.map((meta, position) => ({
      index: position,
      label: labels[position]!,
      address: meta.address,
      signer: isSignerRole(meta.role),
      writable: isWritableRole(meta.role),
    })),
  };
}

export type CanonicalActionArgs = Readonly<{ amountRaw: bigint | null; withdrawAll: boolean }>;

export type BuiltInstruction = Readonly<{ instruction: Instruction; canonical: CanonicalInstruction }>;

/**
 * Builds the canonical instruction for one action with every account passed
 * explicitly — no SDK default derivation is trusted — and the wallet as the
 * only signer through a noop signer that contributes no signature.
 */
export async function buildCanonicalInstruction(
  action: VaultAction,
  wallet: Address,
  args: CanonicalActionArgs,
): Promise<BuiltInstruction> {
  const accounts = await deriveCanonicalUserAccounts(wallet);
  const user: TransactionSigner = createNoopSigner(wallet);
  const program = { programAddress: VAULT_IDENTITY.voltrProgram };
  const labels = LABELS_BY_ACTION[action];

  if (action === "deposit") {
    if (args.amountRaw === null) throw new Error("deposit requires amountRaw");
    const instruction = await getDepositVaultInstructionAsync(
      {
        userTransferAuthority: user,
        protocol: accounts.protocol,
        vault: VAULT_IDENTITY.vault,
        vaultAssetMint: VAULT_IDENTITY.assetMint,
        vaultLpMint: accounts.lpMint,
        userAssetAta: accounts.userAssetAta,
        vaultAssetIdleAta: accounts.idleAta,
        vaultAssetIdleAuth: accounts.idleAuth,
        userLpAta: accounts.userLpAta,
        vaultLpMintAuth: accounts.lpMintAuth,
        assetTokenProgram: VAULT_IDENTITY.tokenProgram,
        lpTokenProgram: VAULT_IDENTITY.tokenProgram,
        systemProgram: SYSTEM_PROGRAM,
        amount: args.amountRaw,
      },
      program,
    );
    return { instruction, canonical: canonicalForm(instruction, 0, labels) };
  }

  if (action === "request-withdraw") {
    const instruction = await getRequestWithdrawVaultInstructionAsync(
      {
        payer: user,
        userTransferAuthority: user,
        protocol: accounts.protocol,
        vault: VAULT_IDENTITY.vault,
        vaultLpMint: accounts.lpMint,
        userLpAta: accounts.userLpAta,
        requestWithdrawLpAta: accounts.escrowLpAta,
        requestWithdrawVaultReceipt: accounts.receipt,
        lpTokenProgram: VAULT_IDENTITY.tokenProgram,
        systemProgram: SYSTEM_PROGRAM,
        amount: args.amountRaw ?? 0n,
        isAmountInLp: true,
        isWithdrawAll: args.withdrawAll,
      },
      program,
    );
    return { instruction, canonical: canonicalForm(instruction, 0, labels) };
  }

  const instruction = await getWithdrawVaultInstructionAsync(
    {
      userTransferAuthority: user,
      protocol: accounts.protocol,
      vault: VAULT_IDENTITY.vault,
      vaultAssetMint: VAULT_IDENTITY.assetMint,
      vaultLpMint: accounts.lpMint,
      requestWithdrawLpAta: accounts.escrowLpAta,
      vaultAssetIdleAta: accounts.idleAta,
      vaultAssetIdleAuth: accounts.idleAuth,
      userAssetAta: accounts.userAssetAta,
      requestWithdrawVaultReceipt: accounts.receipt,
      assetTokenProgram: VAULT_IDENTITY.tokenProgram,
      lpTokenProgram: VAULT_IDENTITY.tokenProgram,
      systemProgram: SYSTEM_PROGRAM,
    },
    program,
  );
  return { instruction, canonical: canonicalForm(instruction, 0, labels) };
}

/* --------------------------------------------------- unsigned wire building */

export type UnsignedTransaction = Readonly<{
  /** The wallet's signature slot is zeroed; this is the payload a wallet signs. */
  wireBase64: string;
  wireByteLength: number;
  feePayer: Address;
  requiredSigners: readonly string[];
  signaturesZeroed: boolean;
  blockhash: string;
  lastValidBlockHeight: bigint;
  instructions: readonly CanonicalInstruction[];
}>;

export type UnsignedBuildInput = Readonly<{
  wallet: Address;
  action: VaultAction;
  amountRaw: bigint | null;
  withdrawAll: boolean;
  blockhash: string;
  lastValidBlockHeight: bigint;
  /** Existence measured from a fresh chain read; only a missing account is created. */
  walletUsdcAtaExists: boolean;
  walletLpAtaExists: boolean;
}>;

export type UnsignedBuildResult =
  | { ok: true; transaction: UnsignedTransaction }
  | { ok: false; reason: string };

export type WireAudit =
  | {
      ok: true;
      signatureCount: number;
      messageBase64: string;
      signaturesZeroed: boolean;
      /** base58 of signature slot zero: the transaction id itself. */
      primarySignatureBase58: string;
      requiredSigners: readonly string[];
      feePayer: string;
      blockhash: string;
      /** Static account keys in message order; index N of a token balance resolves here. */
      accountKeys: readonly string[];
      instructions: readonly {
        programAddress: string;
        discriminatorBase58: string;
        dataBase64: string;
        accountAddresses: readonly string[];
      }[];
    }
  | { ok: false; reason: string };

/**
 * Decodes a wire transaction and reports the facts a relying party must check:
 * how many signatures it carries and whether any is non-zero, which accounts
 * are required signers, who pays the fee, and which program/data each
 * instruction targets.
 */
export function auditWire(wireBase64: string): WireAudit {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Buffer.from(wireBase64, "base64"));
    if (bytes.length === 0 || bytes.length > 1232 || Buffer.from(bytes).toString("base64") !== wireBase64) {
      return { ok: false, reason: "transaction payload is not canonical base64 within the packet limit" };
    }
  } catch {
    return { ok: false, reason: "transaction payload is not valid base64" };
  }
  try {
    const transaction = getTransactionDecoder().decode(bytes);
    const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
    const decompiled = decompileTransactionMessage(compiled);
    const decompiledInstructions: readonly Instruction[] = decompiled.instructions;
    // Kit models signatures as an address-keyed map: each entry is the 64-byte
    // signature, or null where the slot is left unsigned (zeroed on the wire).
    const signatureEntries = Object.entries(transaction.signatures);
    const primarySignature = signatureEntries[0]?.[1] ?? null;
    return {
      ok: true,
      signatureCount: signatureEntries.length,
      messageBase64: Buffer.from(transaction.messageBytes).toString("base64"),
      signaturesZeroed: signatureEntries.every(
        ([, signature]) => signature === null || signature.every((byte) => byte === 0),
      ),
      primarySignatureBase58: bs58.encode(primarySignature ?? new Uint8Array()),
      requiredSigners: compiled.staticAccounts.slice(0, compiled.header.numSignerAccounts).map(String),
      feePayer: String(decompiled.feePayer?.address ?? ""),
      blockhash: "blockhash" in decompiled.lifetimeConstraint ? decompiled.lifetimeConstraint.blockhash : "",
      accountKeys: compiled.staticAccounts.map((value) => String(value)),
      instructions: decompiledInstructions.map((instruction) => ({
        programAddress: instruction.programAddress,
        discriminatorBase58: encodeDiscriminator(new Uint8Array(instruction.data ?? [])),
        dataBase64: Buffer.from(new Uint8Array(instruction.data ?? [])).toString("base64"),
        accountAddresses: (instruction.accounts ?? []).map((account) => account.address),
      })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `wire transaction decode failed: ${message}` };
  }
}

/**
 * Compiles and encodes the unsigned wire transaction for one action: a v0
 * message, fee payer bound to the wallet, the wallet as the only required
 * signer, and — only where the fresh chain read says an account is missing —
 * an idempotent create-ATA pre-instruction built with the canonical SDK
 * builder.
 *
 * The encoded bytes are re-decoded and asserted before returning: every
 * signature slot must be zero and the required signer set must be exactly the
 * wallet, so this can never hand back a transaction already signed by anyone.
 */
export async function buildUnsignedTransaction(input: UnsignedBuildInput): Promise<UnsignedBuildResult> {
  const accounts = await deriveCanonicalUserAccounts(input.wallet);
  const instructions: Instruction[] = [];
  const canonical: CanonicalInstruction[] = [];

  const ensureAta = async (exists: boolean, ata: Address, owner: Address, mint: Address): Promise<void> => {
    if (exists) return;
    const instruction = await getCreateAssociatedTokenIdempotentInstructionAsync(
      {
        payer: createNoopSigner(input.wallet),
        ata,
        owner,
        mint,
        systemProgram: SYSTEM_PROGRAM,
        tokenProgram: VAULT_IDENTITY.tokenProgram,
      },
      { programAddress: VAULT_IDENTITY.associatedTokenProgram },
    );
    instructions.push(instruction);
    canonical.push(canonicalForm(instruction, canonical.length, CREATE_ATA_LABELS));
  };

  if (input.action === "deposit") {
    // The source USDC account must already hold the funds: a missing account is
    // a preflight refusal upstream, not something to create here.
    if (!input.walletUsdcAtaExists) {
      return { ok: false, reason: "wallet has no USDC associated token account to deposit from" };
    }
    await ensureAta(input.walletLpAtaExists, accounts.userLpAta, input.wallet, accounts.lpMint);
  }
  if (input.action === "claim" && !input.walletUsdcAtaExists) {
    // The claim destination is created idempotently; funding it is the wallet's
    // own choice as fee payer, not a new policy.
    await ensureAta(input.walletUsdcAtaExists, accounts.userAssetAta, input.wallet, VAULT_IDENTITY.assetMint);
  }

  const built = await buildCanonicalInstruction(input.action, input.wallet, {
    amountRaw: input.amountRaw,
    withdrawAll: input.withdrawAll,
  });
  instructions.push(built.instruction);
  canonical.push({ ...built.canonical, index: canonical.length });

  let lifetimeBlockhash: Blockhash;
  try {
    // blockhash() validates the base58 32-byte form before it brands the value.
    lifetimeBlockhash = blockhash(input.blockhash);
  } catch {
    return { ok: false, reason: "blockhash is not a valid base58-encoded 32-byte value" };
  }
  const message = setTransactionMessageLifetimeUsingBlockhash(
    { blockhash: lifetimeBlockhash, lastValidBlockHeight: input.lastValidBlockHeight },
    appendTransactionMessageInstructions(
      instructions,
      setTransactionMessageFeePayer(input.wallet, createTransactionMessage({ version: 0 })),
    ),
  );
  const compiled = compileTransaction(message);
  const wire = getTransactionEncoder().encode(compiled);
  const wireBase64 = Buffer.from(wire).toString("base64");

  const audit = auditWire(wireBase64);
  if (!audit.ok) return { ok: false, reason: audit.reason };
  if (!audit.signaturesZeroed) {
    return { ok: false, reason: "refusing to return a transaction whose signature slots are not zeroed" };
  }
  if (audit.requiredSigners.length !== 1 || audit.requiredSigners[0] !== input.wallet) {
    return {
      ok: false,
      reason: `refusing to return a transaction whose only required signer is not the wallet: ${audit.requiredSigners.join(", ")}`,
    };
  }
  if (audit.feePayer !== input.wallet) {
    return { ok: false, reason: "fee payer is not bound to the wallet" };
  }

  return {
    ok: true,
    transaction: {
      wireBase64,
      wireByteLength: wire.byteLength,
      feePayer: input.wallet,
      requiredSigners: audit.requiredSigners,
      signaturesZeroed: true,
      blockhash: input.blockhash,
      lastValidBlockHeight: input.lastValidBlockHeight,
      instructions: canonical,
    },
  };
}

/* ------------------------------------------------------------------ preview */

export type EstimateLine = Readonly<{
  label: string;
  amount: RawAmount | null;
  /** false = the program does not enforce this figure, so it is an estimate. */
  exact: boolean;
  note?: string;
}>;

export type SolCost = Readonly<{
  feeLamports: string;
  rentLamports: string;
  totalLamports: string;
  source: string;
}>;

export type WaitingPeriod = Readonly<{ seconds: string; note: string }>;

export type PreparePreview = Readonly<{
  action: VaultAction;
  exactInputs: Readonly<Record<string, string>>;
  estimates: readonly EstimateLine[];
  feesBps: Readonly<Record<string, string>>;
  sol: SolCost;
  waiting: WaitingPeriod | null;
  executionSemantics: string;
}>;

function rawAmount(raw: bigint, mint: string, decimals: number): RawAmount {
  return { raw: raw.toString(), mint, decimals };
}

function solCost(signatureCount: number, rentSpaces: readonly bigint[]): SolCost {
  const feeLamports = LAMPORTS_PER_SIGNATURE * BigInt(signatureCount);
  const rentLamports = rentSpaces.reduce((total, space) => total + getMinimumBalanceForRentExemption(space), 0n);
  return {
    feeLamports: feeLamports.toString(),
    rentLamports: rentLamports.toString(),
    totalLamports: (feeLamports + rentLamports).toString(),
    source:
      "Estimated cost: base fee at 5,000 lamports per signature (no priority fee is added) plus the rent-exempt minimum for accounts this transaction creates; the fee payer is the wallet",
  };
}

const NO_MIN_OUTPUT_SEMANTICS =
  "The pinned Voltr SDK exposes no enforceable deposit price or minimum-output bound, so the LP figure below is an estimate computed with the program's own integer helpers against one server-side snapshot: the chain mints whatever the vault's accounting yields at execution, and this app cannot bound it.";

export function depositPreview(input: {
  snapshot: VaultSnapshot;
  amountRaw: bigint;
  createsLpAta: boolean;
}): PreparePreview {
  const { snapshot, amountRaw } = input;
  const estimatedLpRaw = lpForDepositAmount(snapshot, amountRaw);
  return {
    action: "deposit",
    exactInputs: { usdcDebitRaw: amountRaw.toString() },
    estimates: [
      {
        label: "USDC debited from wallet",
        amount: rawAmount(amountRaw, VAULT_IDENTITY.assetMint, VAULT_IDENTITY.assetDecimals),
        exact: true,
      },
      {
        label: "LP minted to wallet",
        amount: rawAmount(estimatedLpRaw, VAULT_IDENTITY.lpMint, snapshot.lpDecimals),
        exact: false,
        note: "estimate from one vault snapshot; the program's issuance fee and rounding are already applied by the SDK helper",
      },
    ],
    feesBps: { issuanceFeeBps: snapshot.issuanceFeeBps.toString() },
    sol: solCost(1, input.createsLpAta ? [SPL_TOKEN_ACCOUNT_SPACE] : []),
    waiting: null,
    executionSemantics: NO_MIN_OUTPUT_SEMANTICS,
  };
}

export function requestWithdrawPreview(input: {
  snapshot: VaultSnapshot;
  amountLpRaw: bigint;
  withdrawAll: boolean;
  withdrawalWaitingPeriodSeconds: bigint;
}): PreparePreview {
  const { snapshot } = input;
  const estimatedAssetsRaw = assetsForWithdrawAmount(snapshot, input.amountLpRaw);
  return {
    action: "request-withdraw",
    exactInputs: {
      lpEscrowedRaw: input.amountLpRaw.toString(),
      withdrawAll: input.withdrawAll ? "true" : "false",
      amountIsInLp: "true",
    },
    estimates: [
      {
        label: "LP moved from wallet into the request escrow",
        amount: rawAmount(input.amountLpRaw, VAULT_IDENTITY.lpMint, snapshot.lpDecimals),
        exact: !input.withdrawAll,
        note: input.withdrawAll
          ? "the instruction's isWithdrawAll flag makes the program take the wallet's whole LP balance"
          : "exact amount carried in the instruction",
      },
      {
        label: "USDC expected at claim",
        amount: rawAmount(estimatedAssetsRaw, VAULT_IDENTITY.assetMint, VAULT_IDENTITY.assetDecimals),
        exact: false,
        note: "estimate now: the program recomputes the payout from the snapshot at claim time and pays the lower of the two figures",
      },
    ],
    feesBps: { redemptionFeeBps: snapshot.redemptionFeeBps.toString() },
    sol: solCost(1, [SPL_TOKEN_ACCOUNT_SPACE, BigInt(getRequestWithdrawVaultReceiptSize())]),
    waiting: {
      seconds: input.withdrawalWaitingPeriodSeconds.toString(),
      note: "shown for context only: the receipt's withdrawableFromTs is written by the program at request time and is read back from the receipt, never counted locally",
    },
    executionSemantics:
      "A request escrows LP and creates a receipt; it burns nothing and pays nothing. The payout figure stays an estimate until the receipt exists on chain.",
  };
}

export function claimPreview(input: {
  escrowedLpRaw: bigint;
  assetAtRequestRaw: string;
  assetEffectiveRaw: string;
  lpDecimals: number;
  createsUsdcAta: boolean;
}): PreparePreview {
  return {
    action: "claim",
    exactInputs: {
      lpBurnedRaw: input.escrowedLpRaw.toString(),
      estimatedUsdcPayoutRaw: input.assetEffectiveRaw,
      amountSource: "on-chain request-withdraw receipt: the program pays the lower of request-time and present value",
    },
    estimates: [
      {
        label: "LP burned from the request escrow",
        amount: rawAmount(input.escrowedLpRaw, VAULT_IDENTITY.lpMint, input.lpDecimals),
        exact: true,
      },
      {
        label: "USDC paid to wallet",
        amount: rawAmount(BigInt(input.assetEffectiveRaw), VAULT_IDENTITY.assetMint, VAULT_IDENTITY.assetDecimals),
        exact: false,
        note: `Payout is recomputed at execution; the receipt recorded ${input.assetAtRequestRaw} raw at request time`,
      },
    ],
    feesBps: {},
    sol: solCost(1, input.createsUsdcAta ? [SPL_TOKEN_ACCOUNT_SPACE] : []),
    waiting: null,
    executionSemantics:
      "The claim instruction carries no amount and no destination: both come from the receipt bound to this wallet, and the program burns the escrowed LP.",
  };
}

/* --------------------------------------------------------------- preflight */

export type PrerequisiteState = "ok" | "insufficient" | "waiting" | "stale" | "unavailable";

export type Prerequisite = Readonly<{
  key: string;
  state: PrerequisiteState;
  detail: string;
  /** true = preparation is refused: a real program or chain constraint. */
  blocks: boolean;
}>;

export type PreflightResult =
  | { ok: true; prerequisites: readonly Prerequisite[] }
  | { ok: false; reason: string; prerequisites: readonly Prerequisite[] };

export function depositPreflight(input: {
  amountRaw: bigint;
  walletUsdcRaw: bigint | null;
  walletUsdcAtaExists: boolean;
  vaultIdleRaw: bigint | null;
  assetTotalValueRaw: bigint | null;
  maxCapRaw: bigint | null;
  navStatus: "fresh" | "stale" | "unknown" | "unavailable";
  navDetail: string;
}): PreflightResult {
  const prerequisites: Prerequisite[] = [];
  if (!input.walletUsdcAtaExists || input.walletUsdcRaw === null) {
    prerequisites.push({
      key: "wallet-usdc-balance",
      state: "unavailable",
      detail: "wallet has no USDC associated token account, so there is nothing to deposit",
      blocks: true,
    });
  } else if (input.walletUsdcRaw < input.amountRaw) {
    prerequisites.push({
      key: "wallet-usdc-balance",
      state: "insufficient",
      detail: `wallet holds ${input.walletUsdcRaw} raw USDC, less than the requested ${input.amountRaw}`,
      blocks: true,
    });
  } else {
    prerequisites.push({
      key: "wallet-usdc-balance",
      state: "ok",
      detail: `wallet holds ${input.walletUsdcRaw} raw USDC`,
      blocks: false,
    });
  }

  // This must be an on-chain ceiling: independent wallets may prepare deposits
  // concurrently, and bypassing the app must not bypass the pilot limit.
  const pilotCapInstalled = input.maxCapRaw !== null && input.maxCapRaw > 0n &&
    input.maxCapRaw <= VAULT_IDENTITY.pilotDepositCapRaw;
  prerequisites.push({
    key: "pilot-deposit-cap",
    state: pilotCapInstalled ? "ok" : "unavailable",
    detail: pilotCapInstalled
      ? "The on-chain vault cap is within the 100 USDC pilot limit."
      : "Deposits remain closed until the on-chain vault cap is at most 100 USDC.",
    blocks: !pilotCapInstalled,
  });

  if (input.maxCapRaw !== null && input.assetTotalValueRaw !== null) {
    const remaining = input.maxCapRaw - input.assetTotalValueRaw;
    if (input.amountRaw > remaining) {
      prerequisites.push({
        key: "vault-capacity",
        state: "insufficient",
        detail: `vault cap leaves ${remaining} raw USDC of head room, less than the requested ${input.amountRaw}`,
        blocks: true,
      });
    } else {
      prerequisites.push({
        key: "vault-capacity",
        state: "ok",
        detail: `${remaining} raw USDC of vault cap head room`,
        blocks: false,
      });
    }
  } else {
    prerequisites.push({
      key: "vault-capacity",
      state: "unavailable",
      detail: "vault cap or total value could not be read, so cap head room is unknown",
      blocks: true,
    });
  }

  // No minimum output exists on chain. Refuse a stale or unknown quote;
  // freshness is a preflight condition, never an execution-price guarantee.
  prerequisites.push({
    key: "vault-nav",
    state: input.navStatus === "fresh" ? "ok" : input.navStatus === "unavailable" ? "unavailable" : "stale",
    detail: input.navStatus === "fresh" ? "vault NAV is reported fresh at this snapshot" : input.navDetail,
    blocks: input.navStatus !== "fresh",
  });

  if (input.vaultIdleRaw !== null) {
    prerequisites.push({
      key: "vault-idle-usdc",
      state: "ok",
      detail: `${input.vaultIdleRaw} raw USDC idle in vault custody at this snapshot`,
      blocks: false,
    });
  }

  const blocking = prerequisites.find((entry) => entry.blocks);
  return blocking ? { ok: false, reason: blocking.detail, prerequisites } : { ok: true, prerequisites };
}

export function requestWithdrawPreflight(input: {
  amountLpRaw: bigint;
  withdrawAll: boolean;
  walletLpRaw: bigint | null;
  walletLpAtaExists: boolean;
}): PreflightResult {
  const prerequisites: Prerequisite[] = [];
  if (!input.walletLpAtaExists || input.walletLpRaw === null || input.walletLpRaw === 0n) {
    prerequisites.push({
      key: "wallet-lp-balance",
      state: input.walletLpAtaExists ? "insufficient" : "unavailable",
      detail: input.walletLpAtaExists
        ? "wallet LP balance is zero: there is no LP to escrow"
        : "wallet has no LP token account: it holds no vault shares",
      blocks: true,
    });
  } else if (!input.withdrawAll && input.amountLpRaw > input.walletLpRaw) {
    prerequisites.push({
      key: "wallet-lp-balance",
      state: "insufficient",
      detail: `wallet holds ${input.walletLpRaw} raw LP, less than the requested ${input.amountLpRaw}`,
      blocks: true,
    });
  } else {
    prerequisites.push({
      key: "wallet-lp-balance",
      state: "ok",
      detail: `wallet holds ${input.walletLpRaw} raw LP`,
      blocks: false,
    });
  }
  const blocking = prerequisites.find((entry) => entry.blocks);
  return blocking ? { ok: false, reason: blocking.detail, prerequisites } : { ok: true, prerequisites };
}

/**
 * Claim prerequisites are hard on-chain facts, deliberately independent of any
 * worker liveness signal: receipt ownership, the receipt's own deadline, the LP
 * actually sitting in escrow, and the vault's actual idle USDC.
 */
export function claimPreflight(input: {
  receiptExists: boolean;
  receiptOwnedByWallet: boolean;
  receiptAddress: string;
  escrowedLpRaw: bigint | null;
  escrowTokenBalanceRaw: bigint | null;
  assetEffectiveRaw: string | null;
  withdrawableFromTs: bigint | null;
  chainTimeSec: bigint;
  idleRaw: bigint | null;
}): PreflightResult {
  const prerequisites: Prerequisite[] = [];
  const push = (key: string, state: PrerequisiteState, detail: string, blocks: boolean): Prerequisite => {
    const entry = { key, state, detail, blocks };
    prerequisites.push(entry);
    return entry;
  };
  const refuse = (key: string, state: PrerequisiteState, detail: string): PreflightResult => {
    push(key, state, detail, true);
    return { ok: false, reason: detail, prerequisites };
  };

  if (!input.receiptExists) {
    return refuse("receipt", "unavailable", `no pending withdrawal receipt exists for this wallet and vault (${input.receiptAddress})`);
  }
  if (!input.receiptOwnedByWallet) {
    return refuse("receipt-ownership", "unavailable", "the existing receipt is not bound to this wallet and vault");
  }
  if (input.escrowedLpRaw === null || input.escrowedLpRaw === 0n) {
    return refuse("escrow", "unavailable", "the receipt escrows no LP");
  }
  if (input.escrowTokenBalanceRaw === null || input.escrowTokenBalanceRaw < input.escrowedLpRaw) {
    return refuse(
      "escrow",
      "unavailable",
      `escrow token account holds ${input.escrowTokenBalanceRaw ?? "no"} LP while the receipt escrows ${input.escrowedLpRaw}`,
    );
  }
  if (input.withdrawableFromTs === null) {
    return refuse("deadline", "unavailable", "receipt deadline could not be decoded");
  }
  if (input.chainTimeSec < input.withdrawableFromTs) {
    return refuse(
      "deadline",
      "waiting",
      `receipt is claimable from unix ${input.withdrawableFromTs} (chain time ${input.chainTimeSec}); ${input.withdrawableFromTs - input.chainTimeSec}s remain`,
    );
  }
  push("deadline", "ok", `receipt became claimable at unix ${input.withdrawableFromTs}; chain time is ${input.chainTimeSec}`, false);

  if (input.assetEffectiveRaw === null) {
    return refuse("payout", "unavailable", "receipt payout could not be derived");
  }
  if (input.idleRaw === null) {
    return refuse("vault-idle-usdc", "unavailable", "vault idle USDC could not be read, so claim liquidity cannot be confirmed");
  }
  const payout = BigInt(input.assetEffectiveRaw);
  if (input.idleRaw < payout) {
    return refuse(
      "vault-idle-usdc",
      "insufficient",
      `vault holds ${input.idleRaw} raw idle USDC, less than this receipt's payout of ${payout}: liquidity has not been restored yet`,
    );
  }
  push("vault-idle-usdc", "ok", `vault holds ${input.idleRaw} raw idle USDC against a payout of ${payout}`, false);
  return { ok: true, prerequisites };
}
