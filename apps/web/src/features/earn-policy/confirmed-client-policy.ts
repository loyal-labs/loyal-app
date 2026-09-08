import type { ClientEarnPolicyIdentity } from "./resolve-client-policy";

type ObservedPolicy = ClientEarnPolicyIdentity & {
  lastSeenSlot: string | null;
  setupPolicy:
    | (NonNullable<ClientEarnPolicyIdentity["setupPolicy"]> & {
        lastSeenSlot: string | null;
      })
    | null;
};

type PreparedPolicyMetadata = {
  settings: string;
  policyAccount: string;
  policySeed: string;
  setupPolicyAccount?: string;
  setupPolicySeed?: string;
};

function latestSlot(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return BigInt(left) > BigInt(right) ? left : right;
}

/** Session-local public identities only. The SDK still reads their on-chain state. */
export class ConfirmedClientEarnPolicy {
  private confirmed: {
    policy: ObservedPolicy | null;
    slot: string | null;
  } | null = null;

  constructor(
    private readonly settingsPda: string,
    private readonly isCurrent: () => boolean
  ) {}

  record(
    metadata: PreparedPolicyMetadata,
    stage: "policy" | "policy-finalize" | "deposit" | "cleanup",
    slot?: string
  ): void {
    if (!this.isCurrent() || metadata.settings !== this.settingsPda) return;
    const previous = this.confirmed;
    if (previous?.slot && slot && BigInt(previous.slot) > BigInt(slot)) return;
    const previousPolicy = previous?.policy;
    const sameRoute =
      previousPolicy?.account === metadata.policyAccount &&
      previousPolicy.seed === metadata.policySeed;
    if (stage === "cleanup") {
      // Closing an older pair does not remove a newer confirmed installation.
      if (previousPolicy && !sameRoute) return;
      this.confirmed = { policy: null, slot: slot ?? null };
      return;
    }
    const previousSetup = sameRoute ? previousPolicy.setupPolicy : null;
    const setupPolicy =
      stage === "policy"
        ? previousSetup
        : metadata.setupPolicyAccount && metadata.setupPolicySeed
        ? {
            account: metadata.setupPolicyAccount,
            seed: metadata.setupPolicySeed,
            lastSeenSlot:
              (previousSetup?.account === metadata.setupPolicyAccount &&
              previousSetup.seed === metadata.setupPolicySeed
                ? previousSetup.lastSeenSlot
                : null) ?? slot ?? null,
          }
        : previousSetup;
    this.confirmed = {
      policy: {
        account: metadata.policyAccount,
        seed: metadata.policySeed,
        lastSeenSlot:
          (sameRoute ? previousPolicy.lastSeenSlot : null) ?? slot ?? null,
        setupPolicy,
      },
      slot: slot ?? null,
    };
  }

  resolve(
    state: { settingsPda: string; policy: ObservedPolicy | null } | null
  ): ClientEarnPolicyIdentity | null {
    if (!this.isCurrent())
      throw new Error("Earn account changed. Review the action again.");
    const projected =
      state?.settingsPda === this.settingsPda ? state.policy : null;
    const confirmed = this.confirmed;
    if (!confirmed) return projected;
    // Absence has no projection slot, so it cannot acknowledge a removal or
    // replace a confirmed installation. A new policy must be strictly newer.
    if (projected?.lastSeenSlot && confirmed.slot) {
      const sameRoute =
        projected.account === confirmed.policy?.account &&
        projected.seed === confirmed.policy.seed;
      const setup = confirmed.policy?.setupPolicy;
      const coversRoute =
        sameRoute &&
        confirmed.policy?.lastSeenSlot &&
        BigInt(projected.lastSeenSlot) >= BigInt(confirmed.policy.lastSeenSlot);
      const coversSetup =
        !setup ||
        (projected.setupPolicy?.account === setup.account &&
          projected.setupPolicy.seed === setup.seed &&
          setup.lastSeenSlot &&
          projected.setupPolicy.lastSeenSlot &&
          BigInt(projected.setupPolicy.lastSeenSlot) >=
            BigInt(setup.lastSeenSlot));
      if (
        (coversRoute && coversSetup) ||
        (!sameRoute && BigInt(projected.lastSeenSlot) > BigInt(confirmed.slot))
      ) {
        // Keep the accepted watermark even after projection catches up: an
        // older in-flight API response must not resurrect a legacy policy.
        this.confirmed = {
          policy: projected,
          slot: latestSlot(
            confirmed.slot,
            latestSlot(
              projected.lastSeenSlot,
              projected.setupPolicy?.lastSeenSlot ?? null
            )
          ),
        };
      }
    }
    return this.confirmed?.policy ?? null;
  }
}
