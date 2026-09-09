export type ClientEarnPolicyIdentity = {
  account: string;
  seed: string;
  setupPolicy: {
    account: string;
    seed: string;
  } | null;
};

type ClientEarnStateWithPolicy = {
  policy: ClientEarnPolicyIdentity | null;
  settingsPda: string;
};

export async function resolveRequiredClientEarnPolicy<
  TState extends ClientEarnStateWithPolicy
>(args: {
  currentState: TState | null;
  expectedSettingsPda: string;
  onRefreshed: (state: TState) => void;
  refreshState: () => Promise<TState | null>;
  resolvePolicy?: (state: TState | null) => ClientEarnPolicyIdentity | null;
}): Promise<ClientEarnPolicyIdentity> {
  const resolvePolicy =
    args.resolvePolicy ?? ((state: TState | null) => state?.policy ?? null);
  const currentPolicy = resolvePolicy(
    args.currentState?.settingsPda === args.expectedSettingsPda
      ? args.currentState
      : null
  );
  if (currentPolicy) {
    return currentPolicy;
  }

  const refreshed = await args.refreshState();
  if (!refreshed || refreshed.settingsPda !== args.expectedSettingsPda) {
    throw new Error("Earn state changed. Refresh and retry.");
  }

  // Re-read confirmed identities after the await, and reject obsolete scopes
  // before committing the response to React state.
  const policy = resolvePolicy(refreshed);
  args.onRefreshed(refreshed);
  if (!policy) {
    throw new Error("Earn policy is unavailable. Refresh and retry.");
  }

  return policy;
}
