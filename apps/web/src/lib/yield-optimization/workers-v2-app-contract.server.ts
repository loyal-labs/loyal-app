import "server-only";

// Workers-v2 app contract (docs/workers-v2/app-contract.md): the approved
// target state has app GETs serving reads only while the observer/engine owns
// repair and progress. That behavior is opt-in per deployment so the legacy
// repair writers stay authoritative until each replacement owner is live.
//
// Legacy default: unset, empty, "0" or "false" — every repair writer runs as
// today. Opt-in: "1" or "true". Anything else is a deployment mistake and must
// fail loudly instead of silently choosing an authority boundary.
const WORKERS_V2_APP_READ_ONLY_GETS_ENV = "WORKERS_V2_APP_READ_ONLY_GETS";

export function isWorkersV2AppReadOnlyEarnGetsEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const raw = env[WORKERS_V2_APP_READ_ONLY_GETS_ENV];
  if (raw === undefined || raw === "" || raw === "0" || raw === "false") {
    return false;
  }
  if (raw === "1" || raw === "true") {
    return true;
  }
  throw new Error(
    `invalid_${WORKERS_V2_APP_READ_ONLY_GETS_ENV.toLowerCase()}: ${raw}`
  );
}
