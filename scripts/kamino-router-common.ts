import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import {
  PROGRAM_ADDRESS,
  generated,
  pda,
} from "../sdk/loyal-smart-accounts/src/index.ts";
import {
  getKaminoModifyBalanceAccountsForTokenMint,
  KLEND_PROGRAM_ID,
  USDC_MINT_DEVNET,
  USDC_MINT_MAINNET,
} from "../sdk/private-transactions/src/constants.ts";
import {
  getSolanaEndpoints,
  resolveSolanaEnv,
  type SolanaEnv,
} from "../packages/solana-rpc/src/index.ts";

export const KAMINO_ROUTER_PROGRAM_ID = new PublicKey(
  "4MDtYRz8fbRfk3AbxdDJ2nCejQrSxcemAyZW9EEZDrtX"
);
export const CRANK_AUTHORITY_SEED = Buffer.from("kamino_router_crank");
export const ROUTE_DEPOSIT_DISCRIMINATOR = Uint8Array.from([
  24, 140, 221, 247, 2, 183, 14, 53,
]);
export const CRANK_ROUTE_DISCRIMINATOR = Uint8Array.from([
  223, 67, 222, 93, 107, 203, 62, 192,
]);
export const USDC_DECIMALS = 6;

export type RouterSolanaEnv = Extract<SolanaEnv, "mainnet" | "devnet">;

export type KaminoRouterConfig = {
  routerProgramId: PublicKey;
  smartAccountProgramId: PublicKey;
  usdcMint: PublicKey;
  klendProgramId: PublicKey;
  lendingMarket: PublicKey;
  lendingMarketAuthority: PublicKey;
  reserve: PublicKey;
  reserveLiquiditySupply: PublicKey;
  reserveCollateralMint: PublicKey;
  instructionSysvarAccount: PublicKey;
  tokenProgramId: PublicKey;
  associatedTokenProgramId: PublicKey;
  systemProgramId: PublicKey;
};

export type KaminoRouterConfigOverrides = Partial<{
  routerProgramId: PublicKey;
  smartAccountProgramId: PublicKey;
  usdcMint: PublicKey;
  klendProgramId: PublicKey;
  lendingMarket: PublicKey;
  lendingMarketAuthority: PublicKey;
  reserve: PublicKey;
  reserveLiquiditySupply: PublicKey;
  reserveCollateralMint: PublicKey;
  instructionSysvarAccount: PublicKey;
  tokenProgramId: PublicKey;
  associatedTokenProgramId: PublicKey;
  systemProgramId: PublicKey;
}>;

export function resolvePath(filePath: string): string {
  if (filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2));
  }

  if (filePath === "~") {
    return os.homedir();
  }

  return filePath;
}

export function loadKeypair(filePath: string): Keypair {
  const raw = JSON.parse(
    fs.readFileSync(resolvePath(filePath), "utf8")
  ) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export function requireArg(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
}

export function parseUiAmountToAtomic(value: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error(`Invalid decimal amount: ${value}`);
  }

  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) {
    throw new Error(
      `Amount ${value} has more than ${decimals} decimal places.`
    );
  }

  return BigInt(`${whole}${fraction.padEnd(decimals, "0")}`);
}

export function parseThresholdOperator(value: string): generated.DataOperator {
  const normalized = value.trim().toLowerCase();
  if (["gt", "greater-than", "greaterthan", ">"].includes(normalized)) {
    return generated.DataOperator.GreaterThan;
  }

  if (
    [
      "gte",
      "ge",
      "greater-than-or-equal",
      "greater-than-or-equal-to",
      "greaterthanorequalto",
      ">=",
    ].includes(normalized)
  ) {
    return generated.DataOperator.GreaterThanOrEqualTo;
  }

  throw new Error(
    "--threshold-operator must be gt, gte, greater-than, or greater-than-or-equal."
  );
}

export function dataOperatorName(operator: generated.DataOperator): string {
  return generated.DataOperator[operator] ?? String(operator);
}

export function resolveRouterSolanaEnv(value?: string): RouterSolanaEnv {
  const env = resolveSolanaEnv(value, "mainnet");
  if (env !== "mainnet" && env !== "devnet") {
    throw new Error(
      `Kamino router scripts support mainnet and devnet only; got ${env}.`
    );
  }
  return env;
}

export function inferRouterSolanaEnvFromRpcUrl(
  rpcUrl: string
): RouterSolanaEnv | null {
  const normalized = rpcUrl.toLowerCase();
  if (normalized.includes("mainnet")) {
    return "mainnet";
  }
  if (normalized.includes("devnet")) {
    return "devnet";
  }
  return null;
}

export function resolveDefaultRouterSolanaEnv(): RouterSolanaEnv {
  return resolveRouterSolanaEnv(
    process.env.NEXT_PUBLIC_SOLANA_ENV ?? process.env.SOLANA_ENV
  );
}

export function resolveDefaultRpcUrl(
  env = resolveDefaultRouterSolanaEnv()
): string {
  if (process.env.RPC_URL) {
    return process.env.RPC_URL;
  }

  if (process.env.PROVIDER_ENDPOINT) {
    return process.env.PROVIDER_ENDPOINT;
  }

  return getSolanaEndpoints(env).rpcEndpoint;
}

export function resolveDefaultSmartAccountProgramId(
  env = resolveDefaultRouterSolanaEnv()
): PublicKey {
  const envProgramId =
    process.env[`LOYAL_SMART_ACCOUNTS_PROGRAM_ID_${env.toUpperCase()}`] ??
    process.env.LOYAL_SMART_ACCOUNTS_PROGRAM_ID ??
    PROGRAM_ADDRESS;
  return new PublicKey(envProgramId);
}

export function getDefaultUsdcMint(env: RouterSolanaEnv): PublicKey {
  return env === "mainnet" ? USDC_MINT_MAINNET : USDC_MINT_DEVNET;
}

export function resolveKaminoRouterConfig(args: {
  env: RouterSolanaEnv;
  overrides?: KaminoRouterConfigOverrides;
}): KaminoRouterConfig {
  const overrides = args.overrides ?? {};
  const usdcMint = overrides.usdcMint ?? getDefaultUsdcMint(args.env);
  const klendProgramId = overrides.klendProgramId ?? KLEND_PROGRAM_ID;
  const defaults = getKaminoModifyBalanceAccountsForTokenMint(usdcMint);

  const lendingMarket = overrides.lendingMarket ?? defaults?.lendingMarket;
  const reserve = overrides.reserve ?? defaults?.reserve;
  const reserveLiquiditySupply =
    overrides.reserveLiquiditySupply ?? defaults?.reserveLiquiditySupply;
  const reserveCollateralMint =
    overrides.reserveCollateralMint ?? defaults?.reserveCollateralMint;

  if (
    !lendingMarket ||
    !reserve ||
    !reserveLiquiditySupply ||
    !reserveCollateralMint
  ) {
    throw new Error(
      "Missing Kamino constants. Pass --lending-market, --reserve, --reserve-liquidity-supply, and --reserve-collateral-mint."
    );
  }

  const lendingMarketAuthority =
    overrides.lendingMarketAuthority ??
    PublicKey.findProgramAddressSync(
      [Buffer.from("lma"), lendingMarket.toBuffer()],
      klendProgramId
    )[0];

  return {
    routerProgramId: overrides.routerProgramId ?? KAMINO_ROUTER_PROGRAM_ID,
    smartAccountProgramId:
      overrides.smartAccountProgramId ??
      resolveDefaultSmartAccountProgramId(args.env),
    usdcMint,
    klendProgramId,
    lendingMarket,
    lendingMarketAuthority,
    reserve,
    reserveLiquiditySupply,
    reserveCollateralMint,
    instructionSysvarAccount:
      overrides.instructionSysvarAccount ?? SYSVAR_INSTRUCTIONS_PUBKEY,
    tokenProgramId: overrides.tokenProgramId ?? TOKEN_PROGRAM_ID,
    associatedTokenProgramId:
      overrides.associatedTokenProgramId ?? ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgramId: overrides.systemProgramId ?? SystemProgram.programId,
  };
}

export function getVaultPda(args: {
  settingsPda: PublicKey;
  accountIndex: number;
  smartAccountProgramId: PublicKey;
}): PublicKey {
  return pda.getSmartAccountPda({
    settingsPda: args.settingsPda,
    accountIndex: args.accountIndex,
    programId: args.smartAccountProgramId,
  })[0];
}

export function getPolicyPda(args: {
  settingsPda: PublicKey;
  policySeed: number;
  smartAccountProgramId: PublicKey;
}): PublicKey {
  return pda.getPolicyPda({
    settingsPda: args.settingsPda,
    policySeed: args.policySeed,
    programId: args.smartAccountProgramId,
  })[0];
}

export function getCrankAuthorityPda(args: {
  policyPda: PublicKey;
  routerProgramId: PublicKey;
}): PublicKey {
  return PublicKey.findProgramAddressSync(
    [CRANK_AUTHORITY_SEED, args.policyPda.toBuffer()],
    args.routerProgramId
  )[0];
}

export function getVaultUsdcAta(args: {
  vaultPda: PublicKey;
  usdcMint: PublicKey;
  tokenProgramId?: PublicKey;
  associatedTokenProgramId?: PublicKey;
}): PublicKey {
  return getAssociatedTokenAddressSync(
    args.usdcMint,
    args.vaultPda,
    true,
    args.tokenProgramId ?? TOKEN_PROGRAM_ID,
    args.associatedTokenProgramId ?? ASSOCIATED_TOKEN_PROGRAM_ID
  );
}

export function getVaultCollateralAta(args: {
  vaultPda: PublicKey;
  reserveCollateralMint: PublicKey;
  tokenProgramId?: PublicKey;
  associatedTokenProgramId?: PublicKey;
}): PublicKey {
  return getAssociatedTokenAddressSync(
    args.reserveCollateralMint,
    args.vaultPda,
    true,
    args.tokenProgramId ?? TOKEN_PROGRAM_ID,
    args.associatedTokenProgramId ?? ASSOCIATED_TOKEN_PROGRAM_ID
  );
}

export function getOwnerUsdcAta(args: {
  owner: PublicKey;
  usdcMint: PublicKey;
  tokenProgramId?: PublicKey;
  associatedTokenProgramId?: PublicKey;
}): PublicKey {
  return getAssociatedTokenAddressSync(
    args.usdcMint,
    args.owner,
    false,
    args.tokenProgramId ?? TOKEN_PROGRAM_ID,
    args.associatedTokenProgramId ?? ASSOCIATED_TOKEN_PROGRAM_ID
  );
}

export function encodeRouteDepositData(args: {
  keepLiquidityAmount: bigint;
  minimumDepositAmount: bigint;
}): Buffer {
  const data = Buffer.alloc(24);
  Buffer.from(ROUTE_DEPOSIT_DISCRIMINATOR).copy(data, 0);
  data.writeBigUInt64LE(args.keepLiquidityAmount, 8);
  data.writeBigUInt64LE(args.minimumDepositAmount, 16);
  return data;
}

export function encodeCrankRouteData(args: {
  accountIndex: number;
  policyPayload: Uint8Array;
}): Buffer {
  if (
    !Number.isInteger(args.accountIndex) ||
    args.accountIndex < 0 ||
    args.accountIndex > 255
  ) {
    throw new Error("--vault-index must fit in u8.");
  }

  const data = Buffer.alloc(8 + 1 + 4 + args.policyPayload.length);
  Buffer.from(CRANK_ROUTE_DISCRIMINATOR).copy(data, 0);
  data.writeUInt8(args.accountIndex, 8);
  data.writeUInt32LE(args.policyPayload.length, 9);
  Buffer.from(args.policyPayload).copy(data, 13);
  return data;
}

export function buildRouteDepositInstruction(args: {
  config: KaminoRouterConfig;
  crank: PublicKey;
  vaultPda: PublicKey;
  sourceLiquidity: PublicKey;
  feeLiquidity: PublicKey;
  vaultCollateralTokenAccount: PublicKey;
  keepLiquidityAmount: bigint;
  minimumDepositAmount: bigint;
}): TransactionInstruction {
  const keys: AccountMeta[] = [
    { pubkey: args.crank, isWritable: true, isSigner: true },
    { pubkey: args.vaultPda, isWritable: false, isSigner: true },
    { pubkey: args.sourceLiquidity, isWritable: true, isSigner: false },
    { pubkey: args.config.usdcMint, isWritable: false, isSigner: false },
    { pubkey: args.feeLiquidity, isWritable: true, isSigner: false },
    { pubkey: args.config.lendingMarket, isWritable: false, isSigner: false },
    {
      pubkey: args.config.lendingMarketAuthority,
      isWritable: false,
      isSigner: false,
    },
    { pubkey: args.config.reserve, isWritable: true, isSigner: false },
    {
      pubkey: args.config.reserveLiquiditySupply,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: args.config.reserveCollateralMint,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: args.vaultCollateralTokenAccount,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: args.config.instructionSysvarAccount,
      isWritable: false,
      isSigner: false,
    },
    { pubkey: args.config.klendProgramId, isWritable: false, isSigner: false },
    { pubkey: args.config.tokenProgramId, isWritable: false, isSigner: false },
    {
      pubkey: args.config.associatedTokenProgramId,
      isWritable: false,
      isSigner: false,
    },
    { pubkey: args.config.systemProgramId, isWritable: false, isSigner: false },
  ];

  return new TransactionInstruction({
    programId: args.config.routerProgramId,
    keys,
    data: encodeRouteDepositData({
      keepLiquidityAmount: args.keepLiquidityAmount,
      minimumDepositAmount: args.minimumDepositAmount,
    }),
  });
}

export function serializePolicyPayload(
  policyPayload: generated.PolicyPayload
): Uint8Array {
  const fixedPayloadBeet =
    generated.policyPayloadBeet.toFixedFromValue(policyPayload);
  const policyPayloadBytes = Buffer.alloc(fixedPayloadBeet.byteSize);
  fixedPayloadBeet.write(policyPayloadBytes, 0, policyPayload);
  return policyPayloadBytes;
}
