// NOTE: intentionally NOT a "use client" module despite the .client.ts name.
// `fetchEarnRpcHoldingsSnapshot` is a pure RPC computation (no React/browser
// APIs) that must also be callable from server routes — e.g. the mobile
// `/api/.../mobile/earn/holdings` twin. A "use client" directive makes Next.js
// treat these exports as client references and throws "Attempted to call
// fetchEarnRpcHoldingsSnapshot() from the server" at runtime (tsc can't catch
// it). The client hook imports it just the same.

import {
  getKaminoUsdcEarnTargetForCluster,
  getRiskBasketMarketsForCluster,
  KAMINO_VANILLA_OBLIGATION_ID,
  KAMINO_VANILLA_OBLIGATION_TAG,
  type LoyalCluster,
  RiskBasket,
} from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import {
  calculateKaminoRedeemableLiquidityAmountRaw,
  parseKaminoObligationAccount,
  parseKaminoReserveSnapshot,
  parseKaminoReserveTokenAccounts,
} from "@loyal-labs/smart-account-vaults";
import {
  AccountLayout,
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
import {
  type EarnProductAsset,
  getEarnProductAssetsForCluster,
} from "./earn-product-mints.shared";

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
  sourceId: string;
  supplyApyBps: string | null;
  tokenProgramId: string;
};

export type EarnRpcWatchedAccount = {
  kind: "idle" | "obligation" | "reserve";
  pubkey: string;
};

export type EarnRpcHoldingsSnapshot = {
  completeness: "complete";
  /** @deprecated Wire compatibility; value is nominal stablecoin-par micros. */
  currentTotalAmountRaw: string;
  currentTotalNominalUsdMicros: string;
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
      kind: "reserve";
      pubkey: PublicKey;
      sourceIndex: number;
    }
  | {
      kind: "obligation";
      market: PublicKey;
      pubkey: PublicKey;
    }
  | {
      kind: "idle";
      asset: EarnProductAsset;
      pubkey: PublicKey;
    };

type DiscoveredReserveDeposit = {
  collateralAmountRaw: bigint;
  market: PublicKey;
  obligation: PublicKey;
  reserve: PublicKey;
  slotIndex: number;
};

type ReconciledReserveCandidate = DiscoveredReserveDeposit & {
  asset: EarnProductAsset;
  liquidityMint: PublicKey;
  reserveAccount: AccountInfo<Buffer>;
  reserveCollateralMint: PublicKey;
  supplyApyBps: string | null;
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

function assertPolicyUniverse(args: {
  cluster: LoyalCluster;
  policy: EarnRpcPolicyMetadata | null | undefined;
}): {
  allowedMarkets: Set<string>;
  assets: readonly EarnProductAsset[];
} {
  const policy = args.policy;
  if (!policy) {
    throw new Error(
      "Active Earn policy metadata is required for RPC holdings."
    );
  }
  if (policy.vaultIndex !== EARN_VAULT_INDEX) {
    throw new Error("Active Earn policy is not for the Earn vault.");
  }

  const policyStableMints = new Set(policy.stableMints ?? []);
  const policyKaminoLiquidityMints = new Set(policy.kaminoLiquidityMints ?? []);
  const assets = getEarnProductAssetsForCluster(args.cluster).filter(
    (asset) => {
      const mint = asset.mint.toBase58();
      return (
        policyStableMints.has(mint) && policyKaminoLiquidityMints.has(mint)
      );
    }
  );
  if (assets.length === 0) {
    throw new Error("Active Earn policy includes no supported product mint.");
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

  return { allowedMarkets, assets };
}

async function readAccountsInChunks(args: {
  connection: AccountReader;
  minContextSlot?: number;
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
    const chunk = args.pubkeys.slice(
      index,
      index + GET_MULTIPLE_ACCOUNTS_LIMIT
    );
    const result = await args.connection.getMultipleAccountsInfoAndContext(
      chunk,
      {
        commitment: SOURCE_COMMITMENT,
        ...(args.minContextSlot === undefined
          ? {}
          : { minContextSlot: args.minContextSlot }),
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
  tokenProgramId: PublicKey;
}): bigint {
  if (!args.account) {
    return BigInt(0);
  }
  if (!args.account.owner.equals(args.tokenProgramId)) {
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
        args.candidate.collateralAmountRaw.toString(),
      reserveCollateralMint: args.candidate.reserveCollateralMint.toBase58(),
      slotIndex: String(args.candidate.slotIndex),
      source: "rpc_getMultipleAccounts",
      sourceCommitment: SOURCE_COMMITMENT,
      sourceSlot: String(args.sourceSlot),
    },
    reserve,
    sourceId: `reserve:${reserve}`,
    supplyApyBps: args.candidate.supplyApyBps,
    tokenProgramId: args.candidate.asset.tokenProgramId.toBase58(),
  };
}

function toIdleHolding(args: {
  amountRaw: bigint;
  observedAt: string;
  observedSlot: string;
  sourceSlot: number;
  asset: EarnProductAsset;
  vaultPda: PublicKey;
  vaultUsdcAta: PublicKey;
}): EarnRpcHolding {
  return {
    amountRaw: args.amountRaw.toString(),
    kind: "idle",
    label: "Idle Balance",
    liquidityMint: args.asset.mint.toBase58(),
    market: null,
    marketName: args.asset.symbol,
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
    sourceId: `idle:${args.vaultUsdcAta.toBase58()}`,
    supplyApyBps: null,
    tokenProgramId: args.asset.tokenProgramId.toBase58(),
  };
}

export async function fetchEarnRpcHoldingsSnapshot(args: {
  cluster: LoyalCluster;
  connection: AccountReader;
  // When set, every underlying RPC read demands a node at or past this slot
  // (lagging nodes error instead of answering with pre-deposit account state).
  // The snapshot spans two requests that can hit different nodes, so a
  // max-observed-slot check alone cannot prove the balance-defining accounts
  // were fresh — this enforces it per request.
  minContextSlot?: number;
  policy: EarnRpcPolicyMetadata | null | undefined;
  programId: PublicKey;
  // Closure verification cannot treat an unreadable reserve backing a
  // discovered obligation deposit as zero. Ordinary display reads retain the
  // historical best-effort behavior; full-exit proof opts into fail-closed.
  requireCompleteReserveReads?: boolean;
  settingsPda: PublicKey;
  now?: () => Date;
}): Promise<EarnRpcHoldingsSnapshot> {
  const { allowedMarkets, assets } = assertPolicyUniverse({
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
  const safeMarkets = [...allowedMarkets].map(
    (market) => new PublicKey(market)
  );
  const firstStageRoles: AccountRole[] = [
    ...assets.map((asset) => ({
      asset,
      kind: "idle" as const,
      pubkey: getAssociatedTokenAddressSync(
        asset.mint,
        vaultPda,
        true,
        asset.tokenProgramId
      ),
    })),
    ...safeMarkets.map((market) => {
      const obligation = deriveKaminoVanillaObligation({
        lendProgramId,
        market,
        vaultPda,
      });
      return { kind: "obligation" as const, market, pubkey: obligation };
    }),
  ];
  const firstStage = await readAccountsInChunks({
    connection: args.connection,
    minContextSlot: args.minContextSlot,
    pubkeys: firstStageRoles.map((role) => role.pubkey),
  });
  const accountForRole = (role: AccountRole) =>
    firstStage.values[firstStageRoles.indexOf(role)] ?? null;
  const discoveredDeposits: DiscoveredReserveDeposit[] = [];

  for (const obligationRole of firstStageRoles) {
    if (obligationRole.kind !== "obligation") {
      continue;
    }
    const obligationAccount = validateObligationAccount({
      account: accountForRole(obligationRole),
      lendProgramId,
    });
    if (!obligationAccount) {
      continue;
    }

    const parsedObligation = parseKaminoObligationAccount(
      obligationAccount.data
    );
    if (!parsedObligation.owner.equals(vaultPda)) {
      throw new Error("Kamino obligation owner is not the Earn vault.");
    }
    if (!parsedObligation.lendingMarket.equals(obligationRole.market)) {
      throw new Error("Kamino obligation lending market mismatch.");
    }

    for (const deposit of parsedObligation.deposits) {
      discoveredDeposits.push({
        collateralAmountRaw: deposit.depositedAmountRaw,
        market: parsedObligation.lendingMarket,
        obligation: obligationRole.pubkey,
        reserve: deposit.reserve,
        slotIndex: deposit.slotIndex,
      });
    }
  }

  const reserveRoles: AccountRole[] = discoveredDeposits.map(
    (deposit, sourceIndex) => ({
      kind: "reserve" as const,
      pubkey: deposit.reserve,
      sourceIndex,
    })
  );
  const reserveStage =
    reserveRoles.length > 0
      ? await readAccountsInChunks({
          connection: args.connection,
          minContextSlot: args.minContextSlot,
          pubkeys: reserveRoles.map((role) => role.pubkey),
        })
      : {
          accountCount: 0,
          chunkCount: 0,
          maxObservedSlot: firstStage.maxObservedSlot,
          values: [],
        };
  const reserveAccountForRole = (role: AccountRole) =>
    role.kind === "reserve"
      ? reserveStage.values[reserveRoles.indexOf(role)] ?? null
      : null;
  const reconciledCandidates: ReconciledReserveCandidate[] = [];
  for (const reserveRole of reserveRoles) {
    if (reserveRole.kind !== "reserve") {
      continue;
    }
    const discovered = discoveredDeposits[reserveRole.sourceIndex];
    if (!discovered) {
      continue;
    }

    if (!allowedMarkets.has(discovered.market.toBase58())) {
      throw new Error("Kamino obligation deposit is outside the Safe policy.");
    }

    const reserveAccount = validateReserveAccount({
      account: reserveAccountForRole(reserveRole),
      lendProgramId,
    });
    if (!reserveAccount) {
      if (
        args.requireCompleteReserveReads &&
        discovered.collateralAmountRaw > BigInt(0)
      ) {
        throw new Error(
          "Kamino reserve account is unavailable for a positive Earn obligation."
        );
      }
      continue;
    }

    const reserveAccounts = parseKaminoReserveTokenAccounts(
      reserveAccount.data
    );
    if (!reserveAccounts.lendingMarket.equals(discovered.market)) {
      throw new Error("Kamino reserve lending market mismatch.");
    }
    const reserveAsset = assets.find((asset) =>
      asset.mint.equals(reserveAccounts.reserveLiquidityMint)
    );
    if (!reserveAsset) {
      throw new Error("Kamino reserve liquidity mint is outside the policy.");
    }
    if (
      !reserveAccounts.reserveLiquidityTokenProgram.equals(
        reserveAsset.tokenProgramId
      )
    ) {
      throw new Error("Kamino reserve liquidity token program mismatch.");
    }

    reconciledCandidates.push({
      ...discovered,
      asset: reserveAsset,
      liquidityMint: reserveAccounts.reserveLiquidityMint,
      reserveAccount,
      reserveCollateralMint: reserveAccounts.reserveCollateralMint,
      supplyApyBps: null,
    });
  }

  const observedSlotNumber = Math.max(
    firstStage.maxObservedSlot,
    reserveStage.maxObservedSlot
  );
  const observedSlot = String(observedSlotNumber);
  const observedAt = (args.now ?? (() => new Date()))().toISOString();
  const holdings = [
    ...reconciledCandidates.flatMap((candidate) => {
      const amountRaw = calculateKaminoRedeemableLiquidityAmountRaw({
        collateralAmountRaw: candidate.collateralAmountRaw,
        snapshot: parseKaminoReserveSnapshot(candidate.reserveAccount.data),
      });
      const holding = toKaminoHolding({
        amountRaw,
        candidate,
        sourceSlot: observedSlotNumber,
        observedAt,
        observedSlot,
      });
      return holding ? [holding] : [];
    }),
    ...firstStageRoles.flatMap((role) => {
      if (role.kind !== "idle") {
        return [];
      }
      const amountRaw = validateTokenAccountAmount({
        account: accountForRole(role),
        accountLabel: `Earn vault ${role.asset.symbol} ATA`,
        expectedMint: role.asset.mint,
        expectedOwner: vaultPda,
        tokenProgramId: role.asset.tokenProgramId,
      });
      return [
        toIdleHolding({
          amountRaw,
          asset: role.asset,
          observedAt,
          observedSlot,
          sourceSlot: firstStage.maxObservedSlot,
          vaultPda,
          vaultUsdcAta: role.pubkey,
        }),
      ];
    }),
  ];
  const currentTotalNominalUsdMicros = sumEarnRpcHoldingsAmountRaw(holdings);

  return {
    completeness: "complete",
    currentTotalAmountRaw: currentTotalNominalUsdMicros.toString(),
    currentTotalNominalUsdMicros: currentTotalNominalUsdMicros.toString(),
    holdings,
    observedAt,
    observedSlot,
    provenance: {
      accountCount: firstStage.accountCount + reserveStage.accountCount,
      chunkCount: firstStage.chunkCount + reserveStage.chunkCount,
      commitment: SOURCE_COMMITMENT,
      source: "rpc_getMultipleAccounts",
      watchedAccounts: toWatchedAccounts([...firstStageRoles, ...reserveRoles]),
    },
  };
}
