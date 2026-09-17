/**
 * Shared, cached vault observation.
 *
 * One observation is built from ONE finalized `getMultipleAccounts` batch that
 * contains the vault, both mints, idle custody, the Clock sysvar, the known
 * strategy receipts and the custom adaptor's config, so the accounting never
 * mixes slots and chain time comes from the same read as the vault fields.
 */

import { assetsPerWholeLpRaw, lpSupplyBreakdown, lockedProfit, type VaultSnapshot } from "../domain/accounting";
import type {
  AllocationComponent,
  AllocationView,
  FreshnessView,
  NavFreshnessView,
  RawAmount,
  ServiceStateView,
  ValuationContext,
  VaultObservation,
} from "../domain/types";
import {
  buildCoherentVaultCore,
  deriveIdleAuthority,
  deriveVaultBatchAddresses,
  type BatchAddress,
} from "./coherent-batch";
import { RPC_BOUNDS, VAULT_IDENTITY } from "./config";
import { getVaultRpc } from "./rpc";
import { createObservationCache } from "./single-flight";
import { readConsumedReport } from "./consumed-report";
import { closedDepositService, readDepositService } from "./deposit-service";

export type VaultRead =
  | { ok: true; observation: VaultObservation; snapshot: VaultSnapshot }
  | { ok: false; reason: string; kind: "rpc-error" | "account-missing" | "decode-error" };

/** Transport-level failure kinds collapse into the two read-level kinds. */
function readKind(kind: "network" | "rate-limited" | "rpc-error" | "timeout" | "decode"): "rpc-error" | "decode-error" {
  return kind === "decode" ? "decode-error" : "rpc-error";
}

function rawAmount(raw: bigint | string, mint: string, decimals: number): RawAmount {
  return { raw: typeof raw === "bigint" ? raw.toString() : raw, mint, decimals };
}

async function readVault(): Promise<VaultRead> {
  const observationStartedAt = performance.now();
  const rpc = getVaultRpc();

  // The endpoint must be the pinned cluster before anything is believed.
  const genesis = await rpc.getGenesisHash();
  if (!genesis.ok) {
    return { ok: false, kind: readKind(genesis.kind), reason: `cluster check failed: ${genesis.error}` };
  }

  const batch: ReadonlyArray<BatchAddress> = await deriveVaultBatchAddresses();
  const idleAuthority = await deriveIdleAuthority();
  const response = await rpc.getMultipleAccounts(batch.map((entry) => entry.address));
  if (!response.ok) {
    return { ok: false, kind: readKind(response.kind), reason: `vault batch read failed: ${response.error}` };
  }
  const core = buildCoherentVaultCore(batch, response.value, response.contextSlot ?? -1, { idleAuthority });
  if (!core.ok) {
    return { ok: false, kind: core.kind, reason: core.reason };
  }
  return await projectServicedVaultObservation(core.core, observationStartedAt);
}

export async function projectServicedVaultObservation(core: Extract<ReturnType<typeof buildCoherentVaultCore>, { ok: true }>["core"], startedAt: number): Promise<Extract<VaultRead, { ok: true }>> {
  const report = await readConsumedReport(core, startedAt);
  return projectVaultObservation(core, report, await readDepositService(core, report, startedAt));
}

/** Projects the same batch used by a wallet quote, without another cached read. */
export function projectVaultObservation(
  core: Extract<ReturnType<typeof buildCoherentVaultCore>, { ok: true }>["core"],
  consumedReport?: NavFreshnessView,
  serviceState: ServiceStateView = closedDepositService(),
): Extract<VaultRead, { ok: true }> {
  const { vault } = core;

  const snapshot: VaultSnapshot = {
    assetTotalValue: core.assetTotalValue,
    lpSupply: core.lpSupplyRaw,
    lpDecimals: core.lpDecimals,
    accumulatedLpAdminFees: vault.feeState.accumulatedLpAdminFees,
    accumulatedLpManagerFees: vault.feeState.accumulatedLpManagerFees,
    accumulatedLpProtocolFees: vault.feeState.accumulatedLpProtocolFees,
    deadWeight: vault.deadWeight,
    lastManagementFeeUpdateTs: vault.feeUpdate.lastManagementFeeUpdateTs,
    managementFeeBps:
      vault.feeConfiguration.managerManagementFee +
      vault.feeConfiguration.adminManagementFee +
      vault.feeConfiguration.protocolManagementFee,
    issuanceFeeBps: vault.feeConfiguration.issuanceFee,
    redemptionFeeBps: vault.feeConfiguration.redemptionFee,
    lastUpdatedLockedProfit: vault.lockedProfitState.lastUpdatedLockedProfit,
    lastReport: vault.lockedProfitState.lastReport,
    lockedProfitDegradationDuration: vault.vaultConfiguration.lockedProfitDegradationDuration,
    slot: core.slot,
    observedAtSec: core.chainTimeSec,
  };
  const breakdown = lpSupplyBreakdown(snapshot);
  const perLp = assetsPerWholeLpRaw(snapshot);
  const valuation: ValuationContext = {
    quoteUnit: "USDC",
    source: "voltr-vault-account",
    slot: core.slot,
    observedAt: new Date(Number(core.chainTimeSec) * 1000).toISOString(),
  };

  // Measured custody and manager-reported strategy accounting are separate.
  const components: AllocationComponent[] = [
    {
      key: "vault-asset-idle-custody",
      kind: "idle-custody",
      owner: VAULT_IDENTITY.vault,
      amount: rawAmount(core.idleCustodyRaw, VAULT_IDENTITY.assetMint, VAULT_IDENTITY.assetDecimals),
      note: "the idle ATA recorded in the vault account, authority-checked against the derived idle authority",
    },
  ];
  if (core.managerCustody) components.push({
    key: "smart-account-usdc-custody",
    kind: "strategy-custody",
    owner: VAULT_IDENTITY.manager,
    amount: rawAmount(core.managerCustody.amountRaw, VAULT_IDENTITY.assetMint, VAULT_IDENTITY.assetDecimals),
    note: `smart account USDC ATA ${core.managerCustody.address}; ${core.managerCustody.exists ? "mint and authority validated" : "canonical account absent at this slot"}; adaptor and strategy receipt bindings validated`,
  });
  // A lane with no receipt is a measured absence, not an unavailability; a
  // refused attribution or an undecodable adaptor config is a defect.
  const reportedStrategyValues: AllocationComponent[] = [];
  const unavailable: string[] = [];
  const disclosures: string[] = [];
  for (const attribution of core.strategyAttributions) {
    if (attribution.status === "not-bound") {
      disclosures.push(`strategy ${attribution.strategy} has no strategy-init receipt; it contributes no attributed exposure`);
      continue;
    }
    if (attribution.status === "attribution-failed") {
      unavailable.push(attribution.reason);
      continue;
    }
    reportedStrategyValues.push({
      key: `strategy-${attribution.strategy}`,
      kind: "strategy-custody",
      owner: attribution.strategy,
      amount: rawAmount(attribution.positionValueRaw, VAULT_IDENTITY.assetMint, VAULT_IDENTITY.assetDecimals),
      note: `strategy-init receipt ${attribution.receiptAddress}; adaptor ${attribution.adaptorProgram}; manager-written value, not a NAV observation; receipt-tracked custody ${attribution.custodyTrackedRaw} raw USDC (not independently measured or added to allocation)`,
      lastUpdatedTs: attribution.lastUpdatedTs.toString(),
    });
  }
  disclosures.push(...core.disclosures);
  disclosures.push("Full strategy custody and Kamino valuation have not been reconciled with this vault snapshot; matching partial totals do not prove complete allocation.");
  const knownTotal = components.reduce((total, component) => total + BigInt(component.amount.raw), 0n);
  const residual = snapshot.assetTotalValue - knownTotal;
  const unknown: AllocationComponent[] = [];
  if (residual !== 0n) {
    unknown.push({
      key: "unattributed-exposure",
      kind: "unknown",
      amount: rawAmount(residual < 0n ? -residual : residual, VAULT_IDENTITY.assetMint, VAULT_IDENTITY.assetDecimals),
      unknownReason:
        residual > 0n
          ? "the vault reports more value than measured custody; strategy accounting records do not independently prove the remainder"
          : "attributed components exceed the vault's reported total value; accounting mismatch",
    });
  }
  const allocation: AllocationView = {
    components,
    reportedStrategyValues,
    knownTotalRaw: knownTotal.toString(),
    unknownExposure: unknown,
    reconciliation: unavailable.length > 0 ? "unavailable" : "unknown-exposure",
  };

  // The deployed v2 config reserves its historical report fields as zero.
  // A consumed ticket sequence alone is not proof of an observation slot or
  // NAV amount. Keep freshness unknown until matching report evidence is read.
  const report = core.adaptorReport;
  const navFreshness: NavFreshnessView = consumedReport ?? {
    status: "unknown",
    detail: report?.bindingsMatchPinned
      ? "The adaptor configuration is verified, but this read does not include the consumed report's observation slot and NAV evidence."
      : "The adaptor configuration could not be verified in this batch.",
    vaultLastUpdatedTs: vault.lastUpdatedTs.toString(),
    observedSlot: core.slot,
    ...(report ? {
      adaptorProgram: report.adaptorProgram,
      configAddress: report.configAddress,
      maxReportNavRaw: report.maxReportNavRaw,
      maxReportAgeSlots: report.maxReportAgeSlots,
      bindingsMatchPinned: report.bindingsMatchPinned,
    } : {}),
  };

  const freshness: FreshnessView = {
    vaultLastUpdatedTs: vault.lastUpdatedTs.toString(),
    vaultLastUpdatedTsIso: new Date(Number(vault.lastUpdatedTs) * 1000).toISOString(),
    observedSlot: core.slot,
    observedAt: valuation.observedAt,
    // Every account came back in one response, so one slot covers the batch.
    snapshotCoherent: true,
    componentSlots: { batch: core.slot, vaultAccount: core.slot },
    maxStalenessMs: RPC_BOUNDS.maxStalenessMs,
    chainTimeSource: "clock-sysvar",
  };

  return {
    ok: true,
    snapshot,
    observation: {
      schemaVersion: "loyal-vault-demo.vault-observation/1",
      identity: {
        vault: VAULT_IDENTITY.vault,
        voltrProgram: VAULT_IDENTITY.voltrProgram,
        assetMint: VAULT_IDENTITY.assetMint,
        assetDecimals: VAULT_IDENTITY.assetDecimals,
        lpMint: VAULT_IDENTITY.lpMint,
        lpDecimals: core.lpDecimals,
        manager: VAULT_IDENTITY.manager,
        admin: String(vault.admin),
      },
      terms: {
        withdrawalWaitingPeriodSeconds: vault.vaultConfiguration.withdrawalWaitingPeriod.toString(),
        lockedProfitDegradationSeconds: vault.vaultConfiguration.lockedProfitDegradationDuration.toString(),
        maxCapRaw: vault.vaultConfiguration.maxCap.toString(),
        issuanceFeeBps: vault.feeConfiguration.issuanceFee.toString(),
        redemptionFeeBps: vault.feeConfiguration.redemptionFee.toString(),
        managerPerformanceFeeBps: vault.feeConfiguration.managerPerformanceFee.toString(),
        adminPerformanceFeeBps: vault.feeConfiguration.adminPerformanceFee.toString(),
        managementFeeBpsTotal: String(
          vault.feeConfiguration.managerManagementFee +
            vault.feeConfiguration.adminManagementFee +
            vault.feeConfiguration.protocolManagementFee,
        ),
      },
      assetTotalValue: rawAmount(snapshot.assetTotalValue, VAULT_IDENTITY.assetMint, VAULT_IDENTITY.assetDecimals),
      idleCustody: rawAmount(core.idleCustodyRaw, VAULT_IDENTITY.assetMint, VAULT_IDENTITY.assetDecimals),
      lpSupplyBreakdown: {
        circulating: breakdown.circulating.toString(),
        unharvestedFees: breakdown.unharvestedFees.toString(),
        deadWeight: breakdown.deadWeight.toString(),
        unrealisedFees: breakdown.unrealisedFees.toString(),
        total: breakdown.total.toString(),
      },
      allocation,
      perLpQuote: {
        raw: perLp.raw,
        lpUnitRaw: perLp.lpUnitRaw,
        lockedProfitRaw: perLp.lockedProfitRaw,
        redemptionFeeBps: perLp.redemptionFeeBps,
      },
      lockedProfitRaw: lockedProfit(snapshot).toString(),
      valuation,
      freshness,
      navFreshness,
      serviceState,
      unavailable,
      disclosures,
    },
  };
}

const cache = createObservationCache<VaultRead>({
  load: readVault,
  ttlMs: RPC_BOUNDS.vaultCacheTtlMs,
  failureBackoffMs: RPC_BOUNDS.failureBackoffMs,
  isFailure: (read) => !read.ok,
});

/** Cached, single-flight vault observation. */
export async function getVaultObservation(): Promise<VaultRead> {
  return cache.read();
}
