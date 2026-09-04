import { recoverAutoswapCanary } from "./autoswap-verifier-runtime.ts";

try {
  console.log(JSON.stringify(await recoverAutoswapCanary(), null, 2));
} catch (error) {
  console.error(
    JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      verdict: "FAIL_AUTOSWAP_CANARY_RECOVERY",
    })
  );
  process.exitCode = 1;
}
