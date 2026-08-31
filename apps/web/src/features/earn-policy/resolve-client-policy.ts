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
}): Promise<ClientEarnPolicyIdentity> {
  if (args.currentState?.policy) {
    return args.currentState.policy;
  }

  const refreshed = await args.refreshState();
  if (!refreshed || refreshed.settingsPda !== args.expectedSettingsPda) {
    throw new Error("Earn state changed. Refresh and retry.");
  }

  args.onRefreshed(refreshed);
  if (!refreshed.policy) {
    throw new Error("Earn policy is unavailable. Refresh and retry.");
  }

  return refreshed.policy;
}
