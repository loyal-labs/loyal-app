"use client";
import type { WorkerObservation } from "../domain/worker-observation";
import { useVaultRead } from "./reads";
export function WorkerStatus({ refreshKey }: { refreshKey: number }) {
  const read = useVaultRead<WorkerObservation>("/api/worker", refreshKey);
  const data = read.data;
  return <section className="terms-section" aria-labelledby="worker-heading">
    <h2 id="worker-heading">Withdrawal servicing</h2>
    {read.loading && <p role="status">Checking servicing observations…</p>}
    {read.error && <p role="status">Servicing status is unavailable. Your withdrawal’s eligibility and available USDC are checked separately on chain.</p>}
    {read.error && read.lastSuccessAt && <p>Last successful servicing read: {new Date(read.lastSuccessAt).toLocaleString()}. Current servicing remains unverified.</p>}
    {data && <>
      <p>{data.freshness === "stale" ? "The latest servicing update is out of date." : data.leaseActive ? "A manager is assigned to service this vault." : "No active servicing manager was observed."}</p>
      <p>{data.routeStatus === "withdrawal_pending" ? "The manager observed withdrawal demand for this vault." : "The latest observation does not report pending withdrawal demand."}</p>
      <p>Observed at {new Date(data.observedAt).toLocaleString()} · slot {data.observedSlot}</p>
      {data.operation && <details><summary>Latest manager operation</summary><p> {data.operation.action.toLowerCase().replaceAll("_", " ")} ({data.operation.status.replaceAll("_", " ")}).</p></details>}
      <p>This observation does not confirm that your withdrawal has been serviced. Claim availability comes from your receipt and the vault’s on-chain liquidity.</p>
    </>}
  </section>;
}
