"use client";

import { TOKEN_LABELS } from "../domain/identity";
import type { KaminoExposureView } from "../domain/kamino-view";
import { formatUnits, shortAddress, useVaultRead } from "./reads";

function AccountLink({ address }: { address: string }) {
  return <a className="address" href={`https://explorer.solana.com/address/${address}`} target="_blank" rel="noreferrer">{shortAddress(address)} ↗</a>;
}

const signedUsd = (raw: string) => `${raw.startsWith("-") ? "−" : ""}$${formatUnits(raw.replace(/^-/, ""), 6, 2)}`;

function PositionTable({ positions }: { positions: KaminoExposureView["positions"] }) {
  return (
      <div className="table-scroll"><table><thead><tr><th>Obligation / market</th><th>Collateral</th><th>Debt</th><th>Recorded USD values</th><th>State</th></tr></thead><tbody>
        {positions.map(position => <tr key={position.address}>
          <td><AccountLink address={position.address} /><br /><AccountLink address={position.market} /></td>
          <td>{position.deposits.length ? position.deposits.map(row => <div key={row.reserve}><AccountLink address={row.reserve} /> · {row.tokenAmount ? <>{formatUnits(row.tokenAmount.raw, row.tokenAmount.decimals)} {TOKEN_LABELS[row.tokenAmount.mint] ?? ""} <AccountLink address={row.tokenAmount.mint} /> ({row.tokenAmount.freshness} stored rate)</> : <>{row.collateralRaw} raw collateral units · conversion unavailable</>}</div>) : "None"}</td>
          <td>{position.borrows.length ? position.borrows.map(row => <div key={row.reserve}><AccountLink address={row.reserve} /> · {row.tokenAmount ? <>{formatUnits(row.tokenAmount.raw, row.tokenAmount.decimals)} {TOKEN_LABELS[row.tokenAmount.mint] ?? ""} <AccountLink address={row.tokenAmount.mint} /> (stored debt)</> : <>{row.borrowedAmountSf} scaled debt units · conversion unavailable</>}</div>) : "None"}</td>
          <td>{position.recordedValuation ? <>
            Collateral {signedUsd(position.recordedValuation.collateralUsdRaw)}<br />
            Debt {signedUsd(position.recordedValuation.debtUsdRaw)}<br />
            Net equity {signedUsd(position.recordedValuation.netEquityUsdRaw)}<br />
            LTV {position.recordedValuation.ltvBps === null ? "Unavailable" : `${formatUnits(position.recordedValuation.ltvBps, 2, 2)}%`}
          </> : "Unavailable"}</td>
          <td>{position.funded ? "Funded" : "Empty"} · {position.freshness}<br />Updated at slot {position.lastUpdateSlot}</td>
        </tr>)}
      </tbody></table></div>
  );
}

export function KaminoPositions({ refreshKey }: { refreshKey: number }) {
  const read = useVaultRead<KaminoExposureView>("/api/kamino", refreshKey);
  const data = read.data;
  return <section className="allocation-section" aria-labelledby="kamino-heading">
    <div className="section-title"><h2 id="kamino-heading">Kamino positions</h2></div>
    {read.loading && <p role="status">Reading smart account positions…</p>}
    {read.error && <p role="status">Position discovery unavailable: {read.error}</p>}
    {data && <>
      <p>Smart account <AccountLink address={data.owner} /> · observed at slot {data.observedSlot.toLocaleString("en-US")}</p>
      <p>{data.positions.filter(position => position.funded).length} funded positions observed. The vault’s complete allocation has not yet been reconciled.</p>
      {data.unrecognized.length > 0 && <p role="status">{data.unrecognized.length} accounts could not be decoded. Exposure remains unknown for those accounts.</p>}
      {data.positions.some(position => position.funded) && <PositionTable positions={data.positions.filter(position => position.funded)} />}
      {data.positions.some(position => !position.funded) && <details>
        <summary>{data.positions.filter(position => !position.funded).length} empty position accounts</summary>
        <PositionTable positions={data.positions.filter(position => !position.funded)} />
      </details>}
      <p>Token amounts use stored reserve balances: collateral rounds down and debt rounds up. USD values and LTV come from the obligation’s recorded market values at its update slot. They are not current quotes, liquidation thresholds, or reconciled USDC vault NAV.</p>
    </>}
  </section>;
}
