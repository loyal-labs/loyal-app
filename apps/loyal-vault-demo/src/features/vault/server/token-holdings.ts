import { VAULT_IDENTITY, rpcUrlFromEnv } from "./config";
import { BoundedRpc } from "./rpc";
import { createObservationCache } from "./single-flight";
import { tokenHoldingMint, decodeTokenHolding, type TokenHoldingsView } from "../domain/token-holdings";
type Read = { ok: true; observation: TokenHoldingsView } | { ok: false; reason: string };
const rpc = new BoundedRpc(rpcUrlFromEnv(), 6_000, 2);
const cache = createObservationCache<Read>({ ttlMs: 15_000, failureBackoffMs: 30_000, isFailure: value => !value.ok, load: async () => {
  try {
    const genesis = await rpc.getGenesisHash();
    if (!genesis.ok) return { ok: false, reason: genesis.error };
    const results = await Promise.all([rpc.getSmartAccountTokens(), rpc.getSmartAccountTokens(true)]);
    const discovery = [];
    let minimumSlot = 0;
    for (const result of results) {
      if (!result.ok) return { ok: false, reason: result.error };
      if (result.contextSlot === null) throw new Error("Missing token discovery slot");
      minimumSlot = Math.max(minimumSlot, result.contextSlot);
      discovery.push(...result.value);
    }
    const mintKeys = [...new Set(discovery.map(tokenHoldingMint))];
    const keys = [...discovery.map(account => account.address), ...mintKeys];
    if (keys.length > 100 || new Set(keys).size !== keys.length) throw new Error("Token observation exceeds coherent read bound or has aliased accounts");
    if (keys.length === 0) return { ok: true, observation: { observedSlot: minimumSlot, observedAt: new Date().toISOString(), owner: VAULT_IDENTITY.manager, holdings: [] } };
    const batch = await rpc.getMultipleAccounts(keys, minimumSlot);
    if (!batch.ok) return { ok: false, reason: batch.error };
    if (batch.contextSlot === null || batch.contextSlot < minimumSlot) throw new Error("Token observation slot regressed");
    const mints = new Map(mintKeys.map((key, index) => [key, batch.value[discovery.length + index]!]));
    const holdings = batch.value.slice(0, discovery.length).map(account => {
      if (!account) throw new Error("Token account changed during discovery");
      return decodeTokenHolding(account, mints.get(tokenHoldingMint(account)) ?? null);
    }).sort((a, b) => Number(BigInt(b.raw) > 0n) - Number(BigInt(a.raw) > 0n) || a.mint.localeCompare(b.mint));
    return { ok: true, observation: { observedSlot: batch.contextSlot, observedAt: new Date().toISOString(), owner: VAULT_IDENTITY.manager, holdings } };
  } catch { return { ok: false, reason: "Smart account token balances could not be validated. Refresh to rediscover." }; }
} });
export const getTokenHoldings = cache.read;
