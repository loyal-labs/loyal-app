"use client";
import { TOKEN_LABELS } from "../domain/identity";
import type { TokenHoldingsView } from "../domain/token-holdings";
import { formatUnits, shortAddress, useVaultRead } from "./reads";
export function TokenHoldings({ refreshKey }: { refreshKey: number }) {
  const read = useVaultRead<TokenHoldingsView>("/api/holdings", refreshKey);
  return <section className="allocation-section" aria-labelledby="holdings-heading">
    <h2 id="holdings-heading">Smart account token balances</h2>
    {read.loading && <p role="status">Reading token balances…</p>}
    {read.error && <p role="status">Token balances unavailable: {read.error}</p>}
    {read.data && <>
      <p>Observed at slot {read.data.observedSlot.toLocaleString("en-US")}. Balances may be staging assets or collateral tokens; they are not necessarily available to withdraw.</p>
      <div className="table-scroll"><table><thead><tr><th>Token mint</th><th>Balance</th><th>Token account</th></tr></thead><tbody>
        {read.data.holdings.filter(row => BigInt(row.raw) > 0n).map(row => <tr key={row.account}>
          <td><a href={`https://explorer.solana.com/address/${row.mint}`} target="_blank" rel="noreferrer">{TOKEN_LABELS[row.mint] ?? "Unknown token"} · {shortAddress(row.mint)}</a></td>
          <td>{formatUnits(row.raw, row.decimals)}{row.frozen ? " · frozen" : ""}</td>
          <td><a href={`https://explorer.solana.com/address/${row.account}`} target="_blank" rel="noreferrer">{shortAddress(row.account)}</a></td>
        </tr>)}
      </tbody></table></div>
      {!read.data.holdings.some(row => BigInt(row.raw) > 0n) && <p>No nonzero token balances were observed.</p>}
      <p>These balances are displayed separately from Kamino positions and reported vault NAV. They have not been priced or added to the allocation total.</p>
    </>}
  </section>;
}
