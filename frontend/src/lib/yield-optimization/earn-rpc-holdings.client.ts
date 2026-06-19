"use client";

import {
  KAMINO_VANILLA_OBLIGATION_ID,
  KAMINO_VANILLA_OBLIGATION_TAG,
  LoyalCluster,
  RiskBasket,
  Stablecoin,
  getKaminoUsdcEarnTargetForCluster,
  getRiskBasketMarketsForCluster,
  getStablecoinMintForCluster,
} from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import {
  calculateKaminoRedeemableLiquidityAmountRaw,
  parseKaminoObligationDepositedCollateralAmountRaw,
  parseKaminoReserveSnapshot,
  parseKaminoReserveTokenAccounts,
} from "@loyal-labs/smart-account-vaults";
import {
  AccountLayout,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import type {
  AccountInfo,
  Commitment,
  Connection,
  GetMultipleAccountsConfig,
} from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";

import { resolveEarnPositionDisplay } from "./earn-position-display";

const EARN_VAULT_INDEX = 1;
const GET_MULTIPLE_ACCOUNTS_LIMIT = 100;
const SOURCE_COMMITMENT: Commitment = "confirmed";
const DEFAULT_PUBKEY = PublicKey.default;

export type EarnRpcPolicyMetadata = {
  account: string;
  delegatedSigners?: string[];
  id?: string;
  kaminoLiquidityMints?: string[];
  kaminoMarkets?: string[];
  riskProfile?: string | null;
  routeModes?: string[];
  seed: string;
  setupPolicy?: {
    account: string;
    delegatedSigners?: string[];
    id?: string;
    seed: string;
  } | null;
  stableMints?: string[];
  universePreset?: string | null;
  vaultIndex: number;
  vaultPubkey: string;
};

export type EarnRpcReserveCandidate = {
  amountRaw?: string | null;
  liquidityMint: string | null;
  market: string | null;
  reserve: string | null;
  supplyApyBps?: string | null;
};

export type EarnRpcHolding = {
  amountRaw: string;
  kind: "idle" | "kamino";
  label: string;
  liquidityMint: string;
  market: string | null;
  marketName: string;
  observedAt: string;
  observedSlot: string;
  provenance: Record<string, string | null>;
  reserve: string | null;
  supplyApyBps: string | null;
};

export type EarnRpcWatchedAccount = {
  kind: "idle" | "obligation" | "reserve";
  pubkey: string;
};

export type EarnRpcHoldingsSnapshot = {
  currentTotalAmountRaw: string;
  holdings: EarnRpcHolding[];
  observedAt: string;
  observedSlot: string;
  provenance: {
    accountCount: number;
    chunkCount: number;
    commitment: Commitment;
    source: "rpc_getMultipleAccounts";
    watchedAccounts: EarnRpcWatchedAccount[];
  };
};

type AccountReader = Pick<Connection, "getMultipleAccountsInfoAndContext">;

type BatchedAccountRead = {
  accountCount: number;
  chunkCount: number;
  maxObservedSlot: number;
  values: (AccountInfo<Buffer> | null)[];
};

type AccountRole =
  | {
      candidateIndex: number;
      kind: "reserve";
      pubkey: PublicKey;
    }
  | {
      candidateIndex: number;
      kind: "obligation";
      pubkey: PublicKey;
    }
  | {
      kind: "idle";
      pubkey: PublicKey;
    };

type NormalizedReserveCandidate = {
  liquidityMint: PublicKey;
  market: PublicKey;
  reserve: PublicKey;
  supplyApyBps: string | null;
};

type ReconciledReserveCandidate = NormalizedReserveCandidate & {
  obligation: PublicKey;
  obligationAccount: AccountInfo<Buffer>;
  reserveAccount: AccountInfo<Buffer>;
  reserveCollateralMint: PublicKey;
};

export function deriveEarnVaultPda(args: {
  programId: PublicKey;
  settingsPda: PublicKey;
}): PublicKey {
  return pda.getSmartAccountPda({
    accountIndex: EARN_VAULT_INDEX,
    programId: args.programId,
    settingsPda: args.settingsPda,
  })[0];
}

export function deriveKaminoVanillaObligation(args: {
  lendProgramId: PublicKey;
  market: PublicKey;
  vaultPda: PublicKey;
}): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Uint8Array.of(KAMINO_VANILLA_OBLIGATION_TAG),
      Uint8Array.of(KAMINO_VANILLA_OBLIGATION_ID),
      args.vaultPda.toBytes(),
      args.market.toBytes(),
      DEFAULT_PUBKEY.toBytes(),
      DEFAULT_PUBKEY.toBytes(),
    ],
    args.lendProgramId
  )[0];
}

export function sumEarnRpcHoldingsAmountRaw(
  holdings: readonly Pick<EarnRpcHolding, "amountRaw">[]
): bigint {
  return holdings.reduce((sum, holding) => {
    try {
      return sum + BigInt(holding.amountRaw);
    } catch {
      return sum;
    }
  }, BigInt(0));
}

function publicKeyOrNull(value: string | null | undefined): PublicKey | null {
  if (!value) {
    return null;
  }

  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

function assertPolicyUniverse(args: {
  cluster: LoyalCluster;
  policy: EarnRpcPolicyMetadata | null | undefined;
}): {
  allowedMarkets: Set<string>;
  usdcMint: PublicKey;
} {
  const policy = args.policy;
  if (!policy) {
    throw new Error("Active Earn policy metadata is required for RPC holdings.");
  }
  if (policy.vaultIndex !== EARN_VAULT_INDEX) {
    throw new Error("Active Earn policy is not for the Earn vault.");
  }

  const usdcMint = getStablecoinMintForCluster(
    args.cluster,
    Stablecoin.USDC
  );
  const usdcMintText = usdcMint.toBase58();
  const policyStableMints = new Set(policy.stableMints ?? []);
  const policyKaminoLiquidityMints = new Set(policy.kaminoLiquidityMints ?? []);
  if (
    !policyStableMints.has(usdcMintText) ||
    !policyKaminoLiquidityMints.has(usdcMintText)
  ) {
    throw new Error("Active Earn policy does not include cluster USDC.");
  }

  const safeMarkets = new Set(
    getRiskBasketMarketsForCluster(args.cluster, RiskBasket.Safe).map(
      (market) => market.toBase58()
    )
  );
  const allowedMarkets = new Set(
    (policy.kaminoMarkets ?? []).filter((market) => safeMarkets.has(market))
  );
  if (allowedMarkets.size === 0) {
    throw new Error("Active Earn policy has no Safe Kamino markets.");
  }

  return { allowedMarkets, usdcMint };
}

function normalizeReserveCandidates(args: {
  allowedMarkets: Set<string>;
  candidates: EarnRpcReserveCandidate[];
  cluster: LoyalCluster;
  usdcMint: PublicKey;
}): NormalizedReserveCandidate[] {
  const canonical = getKaminoUsdcEarnTargetForCluster(args.cluster);
  const byReserve = new Map<string, NormalizedReserveCandidate>();
  const addCandidate = (candidate: EarnRpcReserveCandidate) => {
    if (!candidate.reserve || !candidate.market || !candidate.liquidityMint) {
      return;
    }
    if (candidate.liquidityMint !== args.usdcMint.toBase58()) {
      return;
    }
    if (!args.allowedMarkets.has(candidate.market)) {
      return;
    }

    const reserve = publicKeyOrNull(candidate.reserve);
    const market = publicKeyOrNull(candidate.market);
    const liquidityMint = publicKeyOrNull(candidate.liquidityMint);
    if (!reserve || !market || !liquidityMint) {
      return;
    }

    byReserve.set(reserve.toBase58(), {
      liquidityMint,
      market,
      reserve,
      supplyApyBps: candidate.supplyApyBps ?? null,
    });
  };

  addCandidate({
    liquidityMint: canonical.liquidityMint.toBase58(),
    market: canonical.market.toBase58(),
    reserve: canonical.reserve.toBase58(),
    supplyApyBps: null,
  });
  args.candidates.forEach(addCandidate);

  return [...byReserve.values()];
}

async function readAccountsInChunks(args: {
  connection: AccountReader;
  pubkeys: PublicKey[];
}): Promise<BatchedAccountRead> {
  const values: (AccountInfo<Buffer> | null)[] = [];
  let maxObservedSlot = 0;
  let chunkCount = 0;

  for (
    let index = 0;
    index < args.pubkeys.length;
    index += GET_MULTIPLE_ACCOUNTS_LIMIT
  ) {
    const chunk = args.pubkeys.slice(index, index + GET_MULTIPLE_ACCOUNTS_LIMIT);
    const result = await args.connection.getMultipleAccountsInfoAndContext(
      chunk,
      {
        commitment: SOURCE_COMMITMENT,
      } satisfies GetMultipleAccountsConfig
    );
    chunkCount += 1;
    maxObservedSlot = Math.max(maxObservedSlot, result.context.slot);
    values.push(...result.value);
  }

  return {
    accountCount: args.pubkeys.length,
    chunkCount,
    maxObservedSlot,
    values,
  };
}

function validateTokenAccountAmount(args: {
  account: AccountInfo<Buffer> | null;
  accountLabel: string;
  expectedMint: PublicKey;
  expectedOwner: PublicKey;
}): bigint {
  if (!args.account) {
    return BigInt(0);
  }
  if (!args.account.owner.equals(TOKEN_PROGRAM_ID)) {
    throw new Error(`${args.accountLabel} is not owned by the token program.`);
  }

  const decoded = AccountLayout.decode(args.account.data);
  if (!decoded.mint.equals(args.expectedMint)) {
    throw new Error(`${args.accountLabel} has an unexpected mint.`);
  }
  if (!decoded.owner.equals(args.expectedOwner)) {
    throw new Error(`${args.accountLabel} is not owned by the Earn vault.`);
  }

  return BigInt(decoded.amount.toString());
}

function validateReserveAccount(args: {
  account: AccountInfo<Buffer> | null;
  lendProgramId: PublicKey;
}): AccountInfo<Buffer> | null {
  if (!args.account) {
    return null;
  }
  if (!args.account.owner.equals(args.lendProgramId)) {
    throw new Error("Kamino reserve account has an unexpected owner.");
  }

  parseKaminoReserveTokenAccounts(args.account.data);
  parseKaminoReserveSnapshot(args.account.data);
  return args.account;
}

function validateObligationAccount(args: {
  account: AccountInfo<Buffer> | null;
  lendProgramId: PublicKey;
}): AccountInfo<Buffer> | null {
  if (!args.account) {
    return null;
  }
  if (!args.account.owner.equals(args.lendProgramId)) {
    throw new Error("Kamino obligation account has an unexpected owner.");
  }
  return args.account;
}

function toWatchedAccounts(roles: AccountRole[]): EarnRpcWatchedAccount[] {
  const seen = new Set<string>();
  const accounts: EarnRpcWatchedAccount[] = [];
  for (const role of roles) {
    const pubkey = role.pubkey.toBase58();
    const key = `${role.kind}:${pubkey}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    accounts.push({
      kind: role.kind,
      pubkey,
    });
  }
  return accounts;
}

function toKaminoHolding(args: {
  amountRaw: bigint;
  candidate: ReconciledReserveCandidate;
  obligationCollateralAmountRaw: bigint;
  sourceSlot: number;
  observedAt: string;
  observedSlot: string;
}): EarnRpcHolding | null {
  if (args.amountRaw <= BigInt(0)) {
    return null;
  }

  const liquidityMint = args.candidate.liquidityMint.toBase58();
  const market = args.candidate.market.toBase58();
  const reserve = args.candidate.reserve.toBase58();
  const display = resolveEarnPositionDisplay({ liquidityMint, market });

  return {
    amountRaw: args.amountRaw.toString(),
    kind: "kamino",
    label: display.label,
    liquidityMint,
    market,
    marketName: display.marketName,
    observedAt: args.observedAt,
    observedSlot: args.observedSlot,
    provenance: {
      amountSemantics: "kamino_redeemable_liquidity",
      obligation: args.candidate.obligation.toBase58(),
      obligationCollateralAmountRaw:
        args.obligationCollateralAmountRaw.toString(),
      reserveCollateralMint: args.candidate.reserveCollateralMint.toBase58(),
      source: "rpc_getMultipleAccounts",
      sourceCommitment: SOURCE_COMMITMENT,
      sourceSlot: String(args.sourceSlot),
    },
    reserve,
    supplyApyBps: args.candidate.supplyApyBps,
  };
}

function toIdleHolding(args: {
  amountRaw: bigint;
  observedAt: string;
  observedSlot: string;
  sourceSlot: number;
  usdcMint: PublicKey;
  vaultPda: PublicKey;
  vaultUsdcAta: PublicKey;
}): EarnRpcHolding | null {
  if (args.amountRaw <= BigInt(0)) {
    return null;
  }

  return {
    amountRaw: args.amountRaw.toString(),
    kind: "idle",
    label: "Idle Balance",
    liquidityMint: args.usdcMint.toBase58(),
    market: null,
    marketName: "USDC",
    observedAt: args.observedAt,
    observedSlot: args.observedSlot,
    provenance: {
      owner: args.vaultPda.toBase58(),
      source: "rpc_getMultipleAccounts",
      sourceCommitment: SOURCE_COMMITMENT,
      sourceSlot: String(args.sourceSlot),
      tokenAccount: args.vaultUsdcAta.toBase58(),
    },
    reserve: null,
    supplyApyBps: null,
  };
}

export async function fetchEarnRpcHoldingsSnapshot(args: {
  candidates?: EarnRpcReserveCandidate[];
  cluster: LoyalCluster;
  connection: AccountReader;
  policy: EarnRpcPolicyMetadata | null | undefined;
  programId: PublicKey;
  settingsPda: PublicKey;
  now?: () => Date;
}): Promise<EarnRpcHoldingsSnapshot> {
  const { allowedMarkets, usdcMint } = assertPolicyUniverse({
    cluster: args.cluster,
    policy: args.policy,
  });
  const lendProgramId = getKaminoUsdcEarnTargetForCluster(
    args.cluster
  ).lendProgramId;
  const vaultPda = deriveEarnVaultPda({
    programId: args.programId,
    settingsPda: args.settingsPda,
  });
  const vaultUsdcAta = getAssociatedTokenAddressSync(
    usdcMint,
    vaultPda,
    true,
    TOKEN_PROGRAM_ID
  );
  const reserveCandidates = normalizeReserveCandidates({
    allowedMarkets,
    candidates: args.candidates ?? [],
    cluster: args.cluster,
    usdcMint,
  });
  const firstStageRoles: AccountRole[] = [
    { kind: "idle", pubkey: vaultUsdcAta },
    ...reserveCandidates.flatMap((candidate, candidateIndex) => {
      const obligation = deriveKaminoVanillaObligation({
        lendProgramId,
        market: candidate.market,
        vaultPda,
      });
      return [
        { candidateIndex, kind: "reserve" as const, pubkey: candidate.reserve },
        { candidateIndex, kind: "obligation" as const, pubkey: obligation },
      ];
    }),
  ];
  const firstStage = await readAccountsInChunks({
    connection: args.connection,
    pubkeys: firstStageRoles.map((role) => role.pubkey),
  });
  const accountForRole = (role: AccountRole) =>
    firstStage.values[firstStageRoles.indexOf(role)] ?? null;
  const idleRole = firstStageRoles[0]!;
  const idleAccount = accountForRole(idleRole);
  const reconciledCandidates: ReconciledReserveCandidate[] = [];

  for (let index = 0; index < reserveCandidates.length; index += 1) {
    const candidate = reserveCandidates[index]!;
    const reserveRole = firstStageRoles.find(
      (role) => role.kind === "reserve" && role.candidateIndex === index
    );
    const obligationRole = firstStageRoles.find(
      (role) => role.kind === "obligation" && role.candidateIndex === index
    );
    if (!reserveRole || !obligationRole) {
      continue;
    }

    const reserveAccount = validateReserveAccount({
      account: accountForRole(reserveRole),
      lendProgramId,
    });
    const obligationAccount = validateObligationAccount({
      account: accountForRole(obligationRole),
      lendProgramId,
    });
    if (!reserveAccount || !obligationAccount) {
      continue;
    }

    const reserveAccounts = parseKaminoReserveTokenAccounts(
      reserveAccount.data
    );
    if (!reserveAccounts.reserveLiquidityMint.equals(usdcMint)) {
      throw new Error("Kamino reserve liquidity mint is not cluster USDC.");
    }
    reconciledCandidates.push({
      ...candidate,
      obligation: deriveKaminoVanillaObligation({
        lendProgramId,
        market: candidate.market,
        vaultPda,
      }),
      obligationAccount,
      reserveAccount,
      reserveCollateralMint: reserveAccounts.reserveCollateralMint,
    });
  }

  const observedSlotNumber = firstStage.maxObservedSlot;
  const observedSlot = String(observedSlotNumber);
  const observedAt = (args.now ?? (() => new Date()))().toISOString();
  const idleAmountRaw = validateTokenAccountAmount({
    account: idleAccount,
    accountLabel: "Earn vault USDC ATA",
    expectedMint: usdcMint,
    expectedOwner: vaultPda,
  });
  const holdings = [
    ...reconciledCandidates.flatMap((candidate) => {
      const obligationCollateralAmountRaw =
        parseKaminoObligationDepositedCollateralAmountRaw({
          data: candidate.obligationAccount.data,
          reserve: candidate.reserve,
        });
      const amountRaw = calculateKaminoRedeemableLiquidityAmountRaw({
        collateralAmountRaw: obligationCollateralAmountRaw,
        snapshot: parseKaminoReserveSnapshot(candidate.reserveAccount.data),
      });
      const holding = toKaminoHolding({
        amountRaw,
        candidate,
        obligationCollateralAmountRaw,
        sourceSlot: firstStage.maxObservedSlot,
        observedAt,
        observedSlot,
      });
      return holding ? [holding] : [];
    }),
    ...(() => {
      const holding = toIdleHolding({
        amountRaw: idleAmountRaw,
        observedAt,
        observedSlot,
        sourceSlot: firstStage.maxObservedSlot,
        usdcMint,
        vaultPda,
        vaultUsdcAta,
      });
      return holding ? [holding] : [];
    })(),
  ];
  const currentTotalAmountRaw = sumEarnRpcHoldingsAmountRaw(holdings);

  return {
    currentTotalAmountRaw: currentTotalAmountRaw.toString(),
    holdings,
    observedAt,
    observedSlot,
    provenance: {
      accountCount: firstStage.accountCount,
      chunkCount: firstStage.chunkCount,
      commitment: SOURCE_COMMITMENT,
      source: "rpc_getMultipleAccounts",
      watchedAccounts: toWatchedAccounts(firstStageRoles),
    },
  };
}
