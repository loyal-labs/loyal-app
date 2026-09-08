"use client";

import type { ActiveEarnPosition } from "@/hooks/use-active-earn-position";
import { getClientCacheStorage } from "@/lib/client-cache/client-cache";
import {
  type EarnPositionMutation,
  type EarnProjectedPosition,
  parseEarnConfirmationSlot,
} from "./earn-position-accounting.client";

export type EarnPositionRecovery = {
  position: ActiveEarnPosition | null;
  mutations: EarnPositionMutation[];
  projectedRows: EarnProjectedPosition[];
  adoptedRows: EarnProjectedPosition[];
  adoptedPrincipal: string;
  rpcObservedSlot: string | null;
  slotFloor: string | null;
};

const memory = new Map<string, EarnPositionRecovery>();
const warned = new Set<string>();
const keyFor = (scope: string) => `loyal:earn-position-recovery:1:${scope}`;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const strings = (value: unknown, keys: string[]) =>
  record(value) && keys.every((key) => typeof value[key] === "string");
const nullableSlot = (value: unknown) => value === null || parseEarnConfirmationSlot(value) !== null;

function validRecovery(value: unknown): value is EarnPositionRecovery {
  if (!record(value) || !Array.isArray(value.mutations) ||
    !Array.isArray(value.projectedRows) || !Array.isArray(value.adoptedRows) ||
    !nullableSlot(value.rpcObservedSlot) || !nullableSlot(value.slotFloor) ||
    typeof value.adoptedPrincipal !== "string" || !/^\d+$/.test(value.adoptedPrincipal)) return false;
  if (value.position !== null && !(record(value.position) &&
    strings(value.position, ["principalAmountRaw", "currentTotalAmountRaw", "status"]) &&
    record(value.position.currentHolding) && record(value.position.initialHolding) &&
    record(value.position.display))) return false;
  if (![...value.projectedRows, ...value.adoptedRows].every((row) =>
    strings(row, ["id", "vaultPubkey", "initialLiquidityMint", "initialReserve", "currentLiquidityMint", "currentReserve", "status"]) &&
    record(row) && parseEarnConfirmationSlot(row.lastConfirmedSlot) !== null)) return false;
  return value.mutations.every((mutation) => record(mutation) &&
    (mutation.signature === undefined || typeof mutation.signature === "string") &&
    (mutation.confirmedSlot === undefined || parseEarnConfirmationSlot(mutation.confirmedSlot) !== null) &&
    Array.isArray(mutation.targets) && mutation.targets.length > 0 &&
    mutation.targets.every((target: unknown) => record(target) &&
      (target.kind === "deposit" || target.kind === "withdrawal") &&
      strings(target, ["liquidityMint", "vaultPubkey"]) &&
      (target.reserve === null || typeof target.reserve === "string") &&
      (target.positionIds === undefined || (Array.isArray(target.positionIds) &&
        target.positionIds.every((id: unknown) => typeof id === "string")))));
}

// Public balances and confirmation proofs only. Unlike a display cache these
// cannot expire: neither elapsed time nor reload acknowledges a landed action.
export function readEarnPositionRecovery(scope: string): EarnPositionRecovery | null {
  const retained = memory.get(scope);
  if (retained) return retained;
  try {
    const raw = getClientCacheStorage()?.getItem(keyFor(scope));
    if (!raw) return null;
    const envelope: unknown = JSON.parse(raw);
    if (!record(envelope) || envelope.scope !== scope || !validRecovery(envelope.data)) return null;
    memory.set(scope, envelope.data);
    return envelope.data;
  } catch {
    return null;
  }
}

export function writeEarnPositionRecovery(scope: string, data: EarnPositionRecovery) {
  // Snapshot arrays so later callbacks cannot mutate an earlier persisted scope.
  const snapshot = JSON.parse(JSON.stringify(data)) as EarnPositionRecovery;
  memory.set(scope, snapshot);
  try {
    const storage = getClientCacheStorage();
    if (!storage) throw new Error("Persistent storage unavailable");
    storage.setItem(keyFor(scope), JSON.stringify({ scope, data: snapshot }));
  } catch {
    if (!warned.has(scope)) {
      warned.add(scope);
      console.warn("[earn-position] Confirmed Earn state retained in memory only; reload recovery is unavailable because browser storage could not be written.");
    }
  }
}
