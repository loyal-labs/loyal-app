import type { SmartAccountProposalPayloadType } from "@loyal-labs/smart-account-vaults";

export const SMART_ACCOUNT_REFRESH_GROUPS = [
  "base",
  "policies",
  "proposals",
  "vaults",
  "activity",
  "earn",
  "wallet",
] as const;

export type SmartAccountRefreshGroup =
  (typeof SMART_ACCOUNT_REFRESH_GROUPS)[number];

export type SmartAccountRefreshOrderGroup =
  | SmartAccountRefreshGroup
  | "bestApyReserves";

export type SmartAccountRefreshOrderToken = Readonly<{
  group: SmartAccountRefreshOrderGroup;
  order: number;
}>;

export type SmartAccountScopedErrors = {
  base: string | null;
  bestApyReserves: string | null;
  policies: string | null;
  proposals: string | null;
  vaults: string | null;
};

export function resolveSmartAccountRefreshError(
  errors: SmartAccountScopedErrors
): string | null {
  return (
    errors.base ??
    errors.vaults ??
    errors.policies ??
    errors.proposals ??
    errors.bestApyReserves
  );
}

/**
 * Latest-started-wins ordering within an already identity-scoped hook. The
 * caller still checks its identity generation; this class prevents a slow
 * full read from committing after a newer targeted read for the same group.
 */
export class SmartAccountRefreshOrder {
  readonly #latestByGroup = new Map<SmartAccountRefreshOrderGroup, number>();
  #nextOrder = 0;

  begin(group: SmartAccountRefreshOrderGroup): SmartAccountRefreshOrderToken {
    this.#nextOrder += 1;
    const token = Object.freeze({ group, order: this.#nextOrder });
    this.#latestByGroup.set(group, token.order);
    return token;
  }

  clear(): void {
    this.#latestByGroup.clear();
  }

  isCurrent(token: SmartAccountRefreshOrderToken): boolean {
    return this.#latestByGroup.get(token.group) === token.order;
  }
}

export type SmartAccountReadModelLoadToken = Readonly<{
  cacheKey: string;
  order: number;
}>;

/** Prevents an older server read from publishing over a newer forced read. */
export class SmartAccountReadModelLoadOrder {
  readonly #latestByKey = new Map<string, number>();
  #nextOrder = 0;

  begin(cacheKey: string): SmartAccountReadModelLoadToken {
    this.#nextOrder += 1;
    const token = Object.freeze({ cacheKey, order: this.#nextOrder });
    this.#latestByKey.set(cacheKey, token.order);
    return token;
  }

  clear(): void {
    this.#latestByKey.clear();
  }

  finish(token: SmartAccountReadModelLoadToken): void {
    if (this.isCurrent(token)) {
      this.#latestByKey.delete(token.cacheKey);
    }
  }

  isCurrent(token: SmartAccountReadModelLoadToken): boolean {
    return this.#latestByKey.get(token.cacheKey) === token.order;
  }
}

export type SmartAccountReadModelReuse<T> =
  | { kind: "completed"; result: T; ttlMs: number }
  | { kind: "in-flight"; promise: Promise<T> }
  | { expiredCompletedResult: boolean; kind: "load" };

export function resolveSmartAccountReadModelReuse<T>(args: {
  bypassCache?: boolean;
  cachedResult?: { expiresAt: number; result: T };
  existingLoad?: Promise<T>;
  now: number;
}): SmartAccountReadModelReuse<T> {
  if (args.bypassCache) {
    return { expiredCompletedResult: false, kind: "load" };
  }

  if (args.existingLoad) {
    return { kind: "in-flight", promise: args.existingLoad };
  }

  if (args.cachedResult && args.cachedResult.expiresAt > args.now) {
    return {
      kind: "completed",
      result: args.cachedResult.result,
      ttlMs: args.cachedResult.expiresAt - args.now,
    };
  }

  return {
    expiredCompletedResult: Boolean(args.cachedResult),
    kind: "load",
  };
}

export const SMART_ACCOUNT_POLICY_FOLLOW_UP_DELAY_MS = 2_000;

type SchedulePolicyFollowUp = (
  callback: () => void,
  delayMs: number
) => () => void;

const defaultSchedulePolicyFollowUp: SchedulePolicyFollowUp = (
  callback,
  delayMs
) => {
  const timer = globalThis.setTimeout(callback, delayMs);
  return () => globalThis.clearTimeout(timer);
};

/** Coalesces the one policy-only confirmed-RPC follow-up per identity. */
export class SmartAccountPolicyFollowUp {
  #cancel: (() => void) | null = null;
  #generation = 0;

  constructor(
    private readonly scheduleCallback: SchedulePolicyFollowUp = defaultSchedulePolicyFollowUp
  ) {}

  reset(): void {
    this.#generation += 1;
    this.#cancel?.();
    this.#cancel = null;
  }

  schedule(
    refresh: () => Promise<void> | void,
    onError?: (error: unknown) => void
  ): void {
    this.reset();
    const generation = this.#generation;
    this.#cancel = this.scheduleCallback(() => {
      this.#cancel = null;
      if (generation !== this.#generation) return;
      void Promise.resolve()
        .then(() => {
          if (generation !== this.#generation) return;
          return refresh();
        })
        .catch((error) => onError?.(error));
    }, SMART_ACCOUNT_POLICY_FOLLOW_UP_DELAY_MS);
  }
}

export type SmartAccountRefreshPlan = {
  groups: SmartAccountRefreshGroup[];
  accountIndexes: number[];
  signerAddresses: string[];
  refreshAuthenticatedWallet: boolean;
};

export type SmartAccountScopeSnapshot = Readonly<{
  generation: number;
  scope: string;
}>;

/**
 * Tracks identity changes independently from the identity text. The generation
 * prevents work captured by an earlier A identity from becoming current again
 * after an A -> B -> A transition.
 */
export class SmartAccountScopeGeneration {
  #current: SmartAccountScopeSnapshot;

  constructor(scope: string) {
    this.#current = Object.freeze({ generation: 0, scope });
  }

  update(scope: string): SmartAccountScopeSnapshot {
    if (this.#current.scope !== scope) {
      this.#current = Object.freeze({
        generation: this.#current.generation + 1,
        scope,
      });
    }

    return this.#current;
  }

  isCurrent(snapshot: SmartAccountScopeSnapshot): boolean {
    return (
      this.#current.scope === snapshot.scope &&
      this.#current.generation === snapshot.generation
    );
  }
}

type SmartAccountRefreshFlight = {
  dirty: boolean;
  loader: () => Promise<void>;
  promise: Promise<void>;
  started: boolean;
};

/**
 * Coalesces identical group reads without hiding failures. An invalidation
 * during an active read produces one trailing authoritative read.
 * Settled reads are never reused because a later invalidation is causal proof
 * that a post-event read is required.
 */
export class SmartAccountRefreshSingleflight {
  readonly #flights = new Map<string, SmartAccountRefreshFlight>();

  run(key: string, loader: () => Promise<void>): Promise<void> {
    const existing = this.#flights.get(key);
    if (existing) {
      existing.loader = loader;
      if (existing.started) {
        existing.dirty = true;
      }
      return existing.promise;
    }

    const entry: SmartAccountRefreshFlight = {
      dirty: false,
      loader,
      promise: Promise.resolve(),
      started: false,
    };
    entry.promise = Promise.resolve()
      .then(async () => {
        entry.started = true;
        let lastError: unknown;
        do {
          entry.dirty = false;
          lastError = undefined;
          try {
            await entry.loader();
          } catch (error) {
            lastError = error;
          }
        } while (entry.dirty);

        entry.started = false;
        if (lastError !== undefined) {
          throw lastError;
        }
      })
      .catch((error) => {
        throw error;
      })
      .finally(() => {
        if (this.#flights.get(key) === entry) {
          this.#flights.delete(key);
        }
      });
    this.#flights.set(key, entry);
    return entry.promise;
  }

  clear(): void {
    this.#flights.clear();
  }
}

export type SmartAccountMutationRefreshInput =
  | {
      kind: "proposal_action";
      action: "approve" | "reject" | "execute";
      payloadType: SmartAccountProposalPayloadType;
      accountIndex?: number;
      signerAddresses?: string[];
    }
  | {
      kind: "settings_change";
      scope: "policy" | "root";
      threshold: number;
      signerAddresses?: string[];
    }
  | {
      kind: "spending_limit_use";
      accountIndex: number;
      signerAddresses?: string[];
    }
  | {
      kind: "vault_transfer";
      accountIndex: number;
      execution: "proposed" | "settings" | "spending_limit";
      signerAddresses?: string[];
    }
  | {
      kind: "vault_swap";
      accountIndex: number;
      execution: "proposed" | "executed";
    }
  | {
      kind: "earn";
      operation:
        | "policy_setup"
        | "deposit"
        | "withdraw_partial"
        | "withdraw_full"
        | "cleanup"
        | "autodeposit_setup"
        | "autodeposit_close";
      accountIndex?: number;
      signerAddresses?: string[];
    };

function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

function plan(args: {
  groups?: SmartAccountRefreshGroup[];
  accountIndexes?: Array<number | undefined>;
  signerAddresses?: Array<string | undefined>;
  refreshAuthenticatedWallet?: boolean;
}): SmartAccountRefreshPlan {
  const groups = unique(args.groups ?? []);
  return {
    groups,
    accountIndexes: unique(
      (args.accountIndexes ?? []).filter(
        (value): value is number => value !== undefined
      )
    ),
    signerAddresses: unique(
      (args.signerAddresses ?? []).filter((value): value is string =>
        Boolean(value)
      )
    ),
    refreshAuthenticatedWallet:
      args.refreshAuthenticatedWallet ?? groups.includes("wallet"),
  };
}

/**
 * Resolve the smallest authoritative read set after a confirmed mutation.
 * Balance and activity reads stay outside the overview groups so a proposal-only
 * mutation cannot accidentally fan out into wallet, Earn, or market requests.
 */
export function resolveSmartAccountMutationRefreshPlan(
  input: SmartAccountMutationRefreshInput
): SmartAccountRefreshPlan {
  if (input.kind === "proposal_action") {
    if (input.action !== "execute") {
      return plan({
        groups: ["proposals"],
        signerAddresses: input.signerAddresses,
        refreshAuthenticatedWallet: false,
      });
    }

    if (input.payloadType === "settings_transaction") {
      return plan({
        groups: ["base", "policies", "proposals"],
        signerAddresses: input.signerAddresses,
      });
    }

    if (input.payloadType === "policy_transaction") {
      return plan({
        groups: ["policies", "proposals", "vaults", "activity", "wallet"],
        accountIndexes: [input.accountIndex],
        signerAddresses: input.signerAddresses,
      });
    }

    return plan({
      groups: ["proposals", "vaults", "activity", "wallet"],
      accountIndexes: [input.accountIndex],
      signerAddresses: input.signerAddresses,
    });
  }

  if (input.kind === "settings_change") {
    if (input.threshold > 1) {
      return plan({
        groups: ["proposals"],
        signerAddresses: input.signerAddresses,
      });
    }

    return plan({
      groups: input.scope === "root" ? ["base", "policies"] : ["policies"],
      signerAddresses: input.signerAddresses,
    });
  }

  if (input.kind === "spending_limit_use") {
    return plan({
      groups: ["policies", "vaults", "activity", "wallet"],
      accountIndexes: [input.accountIndex],
      signerAddresses: input.signerAddresses,
    });
  }

  if (input.kind === "vault_transfer") {
    if (input.execution === "proposed") {
      return plan({
        groups: ["base", "proposals"],
        signerAddresses: input.signerAddresses,
      });
    }

    return plan({
      groups:
        input.execution === "spending_limit"
          ? ["policies", "vaults", "activity", "wallet"]
          : ["proposals", "vaults", "activity", "wallet"],
      accountIndexes: [input.accountIndex],
      signerAddresses: input.signerAddresses,
    });
  }

  if (input.kind === "vault_swap") {
    return plan({
      groups:
        input.execution === "proposed"
          ? ["base", "proposals"]
          : ["proposals", "vaults", "activity", "wallet"],
      accountIndexes:
        input.execution === "executed" ? [input.accountIndex] : [],
    });
  }

  const common = {
    accountIndexes: [input.accountIndex],
    signerAddresses: input.signerAddresses,
  };

  if (input.operation === "policy_setup") {
    return plan({ ...common, groups: ["policies", "earn"] });
  }
  if (input.operation === "cleanup") {
    return plan({
      ...common,
      groups: ["policies", "earn", "vaults", "activity", "wallet"],
    });
  }
  if (
    input.operation === "autodeposit_setup" ||
    input.operation === "autodeposit_close"
  ) {
    return plan({ ...common, groups: ["policies", "earn"] });
  }

  return plan({
    ...common,
    groups: ["earn", "vaults", "activity", "wallet"],
  });
}
