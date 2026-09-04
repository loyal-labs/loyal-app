import { runAutoswapCanary } from "./autoswap-verifier-runtime.ts";

try {
  console.log(JSON.stringify(await runAutoswapCanary(), null, 2));
} catch (error) {
  console.error(
    JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      verdict: "FAIL_AUTOSWAP_API_LIFECYCLE",
    })
  );
  process.exitCode = 1;
}
