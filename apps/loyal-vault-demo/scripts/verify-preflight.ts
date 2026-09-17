/** Outcome gates used by the real unsigned-transaction preparation path. */
import assert from "node:assert/strict";
import { claimPreflight, depositPreflight } from "../src/features/vault/domain/transactions";

export function verifyPreflightFailures() {
  let passed = 0;
  const deposit = { amountRaw: 10n, walletUsdcRaw: 10n, walletUsdcAtaExists: true,
    vaultIdleRaw: 0n, assetTotalValueRaw: 90n, maxCapRaw: 100n,
    navStatus: "fresh" as const, navDetail: "Controlled NAV status" };
  assert(depositPreflight(deposit).ok); passed++;
  for (const navStatus of ["stale", "unknown", "unavailable"] as const) {
    const result = depositPreflight({ ...deposit, navStatus });
    assert(!result.ok && result.prerequisites.some(entry => entry.key === "vault-nav" && entry.blocks)); passed++;
  }
  for (const change of [{ maxCapRaw: null }, { assetTotalValueRaw: null }, { maxCapRaw: 99n }]) {
    const result = depositPreflight({ ...deposit, ...change });
    assert(!result.ok && result.prerequisites.some(entry => entry.key === "vault-capacity" && entry.blocks)); passed++;
  }
  for (const maxCapRaw of [100_000_001n, 1_000_000_000_000n, 0n, -1n]) {
    const result = depositPreflight({ ...deposit, maxCapRaw });
    assert(!result.ok && result.prerequisites.some(entry => entry.key === "pilot-deposit-cap" && entry.blocks)); passed++;
  }
  const pilot = { ...deposit, amountRaw: 1_000_000n, walletUsdcRaw: 2_000_000n,
    assetTotalValueRaw: 99_000_000n, maxCapRaw: 100_000_000n };
  assert(depositPreflight(pilot).ok); passed++;
  const overCap = depositPreflight({ ...pilot, amountRaw: 1_000_001n });
  assert(!overCap.ok && overCap.prerequisites.some(entry => entry.key === "vault-capacity" && entry.blocks)); passed++;
  const claim = { receiptExists: true, receiptOwnedByWallet: true, receiptAddress: "controlled-receipt",
    escrowedLpRaw: 10n, escrowTokenBalanceRaw: 10n, assetEffectiveRaw: "20",
    withdrawableFromTs: 100n, chainTimeSec: 100n, idleRaw: 20n };
  assert(claimPreflight(claim).ok); passed++;
  for (const [change, gate] of [
    [{ receiptExists: false }, "receipt"],
    [{ receiptOwnedByWallet: false }, "receipt-ownership"],
    [{ escrowTokenBalanceRaw: 9n }, "escrow"],
    [{ chainTimeSec: 99n }, "deadline"],
    [{ idleRaw: 19n }, "vault-idle-usdc"],
    [{ idleRaw: null }, "vault-idle-usdc"],
  ] as const) {
    const result = claimPreflight({ ...claim, ...change });
    assert(!result.ok && result.prerequisites.some(entry => entry.key === gate && entry.blocks)); passed++;
  }
  return { passed };
}
