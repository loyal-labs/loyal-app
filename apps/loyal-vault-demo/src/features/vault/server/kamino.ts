import { VAULT_IDENTITY, rpcUrlFromEnv } from "./config";
import { BoundedRpc, type AccountData } from "./rpc";
import { convertReserveAmount } from "./kamino-reserve";
import { createObservationCache } from "./single-flight";
import { recordedKaminoValuation } from "../domain/kamino-valuation";
import { decodeObligation } from "../domain/kamino-obligation";
import type { KaminoExposureView } from "../domain/kamino-view";

type Read = { ok: true; observation: KaminoExposureView } | { ok: false; reason: string };
const rpc = new BoundedRpc(rpcUrlFromEnv(), 12_000, 1);
const cache = createObservationCache<Read>({
  ttlMs: 15_000,
  failureBackoffMs: 30_000,
  isFailure: value => !value.ok,
  load: async () => {
    const genesis = await rpc.getGenesisHash();
    if (!genesis.ok) return { ok: false, reason: genesis.error };
    const result = await rpc.getKaminoObligations();
    if (!result.ok) return { ok: false, reason: result.error };
    let slot = result.contextSlot;
    let accounts: readonly AccountData[] = result.value;
    const reserveKeys = new Set<string>();
    for (const account of accounts) {
      const read = decodeObligation(account.address, account);
      if (read.kind === "decoded") for (const row of [...read.obligation.deposits, ...read.obligation.borrows]) {
        if (row.active) reserveKeys.add(row.reserve);
      }
    }
    const reserves = new Map<string, AccountData | null>();
    if (reserveKeys.size > 0) {
      const keys = [...accounts.map(account => account.address), ...reserveKeys];
      if (keys.length > 100) return { ok: false, reason: "Exposure exceeds the coherent read bound." };
      const batch = await rpc.getMultipleAccounts(keys, slot ?? undefined);
      if (!batch.ok) return { ok: false, reason: batch.error };
      if (batch.contextSlot === null || (slot !== null && batch.contextSlot < slot)) return { ok: false, reason: "Exposure observation slot regressed." };
      if (batch.value.slice(0, accounts.length).some(account => account === null)) return { ok: false, reason: "An obligation changed during discovery. Refresh to rediscover." };
      for (let index = accounts.length; index < keys.length; index++) reserves.set(keys[index]!, batch.value[index]!);
      accounts = batch.value.slice(0, accounts.length) as AccountData[];
      slot = batch.contextSlot;
    }
    if (slot === null) return { ok: false, reason: "Missing discovery slot" };
    const positions: KaminoExposureView["positions"][number][] = [];
    const unrecognized: { address: string; reason: string }[] = [];
    for (const account of accounts) {
      const read = decodeObligation(account.address, account);
      if (read.kind !== "decoded") {
        unrecognized.push({ address: account.address, reason: read.kind === "invalid" ? read.reason : "Discovered account absent" });
        continue;
      }
      const value = read.obligation;
      const age = BigInt(slot) - BigInt(value.lastUpdate.slot);
      if (age < 0n) {
        unrecognized.push({ address: account.address, reason: "Obligation update is newer than observation" });
        continue;
      }
      const convert = (reserve: string, raw: string, kind: "collateral" | "debt") => {
        try { return { tokenAmount: convertReserveAmount(reserves.get(reserve) ?? null, value.market, slot!, BigInt(raw), kind) }; }
        catch { return { conversionUnavailable: "Reserve conversion is unavailable; raw units are shown." }; }
      };
      positions.push({
        address: account.address, market: value.market, tag: value.tag,
        lastUpdateSlot: value.lastUpdate.slot, ageSlots: age.toString(),
        freshness: !value.lastUpdate.stale && age <= 32n ? "fresh" : "stale",
        funded: read.funded,
        recordedValuation: recordedKaminoValuation(value),
        deposits: value.deposits.filter(row => row.active).map(row => ({ reserve: row.reserve, collateralRaw: row.depositedAmount, ...convert(row.reserve, row.depositedAmount, "collateral") })),
        borrows: value.borrows.filter(row => row.active).map(row => ({ reserve: row.reserve, borrowedAmountSf: row.borrowedAmountSf, ...convert(row.reserve, row.borrowedAmountSf, "debt") })),
      });
    }
    positions.sort((a, b) => Number(b.funded) - Number(a.funded) || a.address.localeCompare(b.address));
    return { ok: true, observation: { observedSlot: slot, observedAt: new Date().toISOString(), owner: VAULT_IDENTITY.manager, coverage: "owner-scan", positions, unrecognized } };
  },
});
export const getKaminoExposure = cache.read;
