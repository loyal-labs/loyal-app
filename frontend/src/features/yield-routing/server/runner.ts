import "server-only";

import { listDueYieldRoutingPolicies } from "./repository";

const DEFAULT_CRON_LIMIT = 25;

export async function runYieldRoutingCron(args: {
  limit?: number;
}): Promise<{
  duePolicies: number;
  scannedPolicies: number;
}> {
  const policies = await listDueYieldRoutingPolicies({
    limit: args.limit ?? DEFAULT_CRON_LIMIT,
  });

  return {
    duePolicies: policies.length,
    scannedPolicies: policies.length,
  };
}
