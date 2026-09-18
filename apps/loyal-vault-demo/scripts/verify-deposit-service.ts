import assert from "node:assert/strict";
import { closedDepositService, matchDepositService, type DepositServiceCore } from "../src/features/vault/server/deposit-service";
import type { NavFreshnessView } from "../src/features/vault/domain/types";

export function verifyDepositService() {
  // NAV/custody amounts are synthetic fixtures; the on-chain cap mirrors the
  // approved 100,000 USDC pilot ceiling (100_000_000_000 raw).
  const core: DepositServiceCore = { slot: 1000, assetTotalValue: 5_000_023n, idleCustodyRaw: 23n,
    managerCustody: { address: "controlled-manager-custody", exists: true, amountRaw: 0n },
    vault: { vaultConfiguration: { maxCap: 100_000_000_000n } } };
  const report: NavFreshnessView = { status: "fresh", detail: "controlled report", vaultLastUpdatedTs: "1", observedSlot: 1000,
    reportSignature: "controlled-signature", reportConfirmedSlot: 998, lastNavRaw: "5000000", lastSequence: "995" };
  const row = { database_now: "2026-09-17T00:00:10Z", release_active: true, pilot_active: true, no_manual_hold: true, no_pending: true,
    last_action: "REPORT_NAV", last_signature: report.reportSignature, last_confirmed_slot: "998",
    observation: { observedAt: "2026-09-17T00:00:05Z", observedSlot: 1010, reportSequence: 1010, navFresh: true,
      routeStatus: "positioned", aumRaw: "5000023", voltrIdleRaw: "23", squadsIdleRaw: "0", computedStrategyNavRaw: "5000000", reportedNavRaw: "5000000", voltrStrategyIdleRaw: "0" } };
  let passed = 0;
  assert.equal(closedDepositService().deposits, "unavailable"); passed++;
  assert.equal(matchDepositService(core, report, row).deposits, "available"); passed++;
  for (const patch of [
    { release_active: false }, { release_active: "true" }, { pilot_active: false }, { no_manual_hold: false }, { no_pending: false },
    { last_action: "OPEN_ROUTE_STEP" }, { last_signature: "different-report" }, { last_confirmed_slot: "999" },
    { database_now: "invalid" }, { database_now: "2026-09-17T00:01:00Z" }, { observation: null },
  ]) { assert.equal(matchDepositService(core, report, { ...row, ...patch }).deposits, "unavailable"); passed++; }
  for (const patch of [
    { observedAt: "2026-09-17T00:01:00Z" }, { observedSlot: 997 }, { observedSlot: 1033 }, { observedSlot: "1010" },
    { navFresh: false }, { routeStatus: "withdrawal_pending" }, { routeStatus: "unknown" },
    { aumRaw: "5000024" }, { voltrIdleRaw: "24" }, { computedStrategyNavRaw: "4999999" }, { reportedNavRaw: "4999999" },
    { voltrStrategyIdleRaw: "1" }, { squadsIdleRaw: "1" },
  ]) { assert.equal(matchDepositService(core, report, { ...row, observation: { ...row.observation, ...patch } }).deposits, "unavailable"); passed++; }
  for (const patch of [{ status: "unknown" as const }, { status: "stale" as const }, { reportSignature: undefined }, { reportConfirmedSlot: undefined }]) {
    assert.equal(matchDepositService(core, { ...report, ...patch }, row).deposits, "unavailable"); passed++;
  }
  // 100_000_000_001n is one raw unit above the approved pilot ceiling.
  for (const maxCap of [0n, 100_000_000_001n, core.assetTotalValue]) {
    assert.equal(matchDepositService({ ...core, vault: { vaultConfiguration: { maxCap } } }, report, row).deposits, "unavailable"); passed++;
  }
  return { passed, proofLevel: "CONTROLLED_ADMISSION_NOT_LIVE_READINESS" };
}
if (import.meta.main) console.log(JSON.stringify(verifyDepositService()));
