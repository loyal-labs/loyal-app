import { verifyAutoswapContract } from "./autoswap-verifier-runtime.ts";

try {
  console.log(JSON.stringify(await verifyAutoswapContract(), null, 2));
} catch (error) {
  console.error(
    JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      verdict: "FAIL_AUTOSWAP_API_LOCAL_STATE",
    })
  );
  process.exitCode = 1;
}
