"use client";

import { useEffect, useState } from "react";
import { parseUiAmount } from "../domain/client-transaction";
import type { VaultAction } from "../domain/transactions";
import type { PositionObservation, VaultObservation } from "../domain/types";
import type { VaultTransactionApi } from "./use-vault-transaction";
import { formatUnits, shortAddress } from "./reads";

export function TransactionPanel({ action, wallet, vault, position, api, connect }: {
  action: VaultAction;
  wallet: string | null;
  vault: VaultObservation | null;
  position: PositionObservation | null;
  api: VaultTransactionApi;
  connect: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [withdrawAll, setWithdrawAll] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const { state } = api;
  const busy = ["preparing", "signing", "submitting", "pending"].includes(state.phase);
  const receipt = position?.receipt;
  const quote = state.quote;
  useEffect(() => { setAmount(""); setWithdrawAll(false); setInputError(null); }, [wallet, action]);
  useEffect(() => {
    if (state.phase !== "review") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.phase]);
  const expired = !!quote && [quote.quote.preparedAt, quote.observation.vaultObservedAt, quote.observation.positionObservedAt]
    .some((time) => now - Date.parse(time) > 15000);
  const label = action === "deposit" ? "deposit" : action === "request-withdraw" ? "withdrawal request" : "claim";
  let unavailable: string | null = null;
  if (wallet && (!position || !vault)) unavailable = "Waiting for current wallet and vault data.";
  else if (action === "deposit" && vault?.serviceState.deposits !== "available") unavailable = vault?.serviceState.depositsReason ?? "Waiting for current vault data.";
  else if (action === "request-withdraw" && receipt) unavailable = "Claim your existing withdrawal before requesting another.";
  else if (action === "claim" && position && !receipt) unavailable = "You have no pending withdrawal.";
  else if (action === "claim" && receipt?.eligibility === "waiting") unavailable = `Your withdrawal becomes eligible ${new Date(receipt.withdrawableFromTsIso).toLocaleString()}.`;
  else if (action === "claim" && receipt && vault && BigInt(vault.idleCustody.raw) < BigInt(receipt.assetEffectiveRaw)) unavailable = "Your withdrawal is eligible. Waiting for vault liquidity to be restored.";

  async function prepare() {
    if (!wallet || !position || !vault) return;
    setInputError(null);
    try {
      const amountRaw = action === "claim" ? null : action === "request-withdraw" && withdrawAll
        ? BigInt(position.lp.balance.raw)
        : parseUiAmount(amount, action === "deposit" ? vault.identity.assetDecimals : position.lp.balance.decimals);
      await api.prepare({ wallet, action, amountRaw, withdrawAll: action === "request-withdraw" && withdrawAll });
    } catch (error) { setInputError(error instanceof Error ? error.message : "Enter a valid amount."); }
  }

  return <div className="action-content" id="vault-action-panel" role="tabpanel" aria-labelledby={`vault-tab-${action === "request-withdraw" ? "request" : action}`}>
    {state.phase === "review" && quote ? <>
      <h3>Review {label}</h3>
      <dl className="transaction-summary">
        {quote.preview.estimates.map((line, index) => <div key={index}>
          <dt>{line.label}{line.exact ? "" : " (estimate)"}</dt>
          <dd>{line.amount ? formatUnits(line.amount.raw, line.amount.decimals) : "Unavailable"}</dd>
        </div>)}
        {Object.entries(quote.preview.feesBps).map(([key, value]) => <div key={key}><dt>{key === "issuanceFeeBps" ? "Issuance fee" : key === "redemptionFeeBps" ? "Redemption fee" : "Vault fee"}</dt><dd>{formatUnits(value, 2, 2)}%</dd></div>)}
        <div><dt>Estimated network fee and rent</dt><dd>{formatUnits(quote.preview.sol.totalLamports, 9, 9)} SOL</dd></div>
        {quote.preview.waiting && <div><dt>Withdrawal waiting period</dt><dd>{quote.preview.waiting.seconds} seconds</dd></div>}
      </dl>
      <p className="detail-note">{quote.preview.executionSemantics}</p>
      {quote.warnings.length > 0 && <p className="detail-note">{quote.warnings.join(" ")}</p>}
      {expired ? <>
        <p role="status">This quote expired. Review current amounts again.</p>
        <button className="button wide" onClick={() => state.intent && void api.prepare(state.intent)}>Refresh quote</button>
      </> : <button className="button wide" onClick={() => void api.signAndSubmit()}>Sign {label} in wallet</button>}
      <button className="text-button" onClick={api.clearQuote}>Back to amount</button>
    </> : <>
      {action === "claim" ? <>
        <h3>{wallet ? "Your withdrawal" : "Connect to view withdrawals"}</h3>
        {receipt && <p className="claim-amount">{formatUnits(receipt.assetEffectiveRaw, 6)} <span>USDC estimated</span></p>}
      </> : <>
        <label htmlFor="vault-amount">{action === "deposit" ? "USDC to deposit" : "LP shares to withdraw"}</label>
        <div className="amount-input"><input id="vault-amount" inputMode="decimal" autoComplete="off" placeholder="0.00" maxLength={40}
          value={amount} onChange={(event) => setAmount(event.target.value)} disabled={!wallet || busy || withdrawAll}/><span>{action === "deposit" ? "USDC" : "LP"}</span></div>
        {action === "request-withdraw" && <label className="withdraw-all"><input type="checkbox" checked={withdrawAll} disabled={!wallet || busy} onChange={(event) => setWithdrawAll(event.target.checked)}/>Withdraw all available shares</label>}
        <p className="detail-note">{action === "deposit" ? "You receive LP shares representing your vault position." : "Requested shares stay in escrow until your withdrawal is claimed."}</p>
      </>}
      {!wallet ? <button className="button wide" onClick={connect}>Connect wallet</button> :
        <button className="button wide" disabled={busy || !!unavailable} onClick={() => void prepare()}>
          {state.phase === "preparing" ? "Reading current amounts…" : state.phase === "signing" ? "Check your wallet…" : state.phase === "submitting" ? "Submitting…" : state.phase === "pending" ? "Awaiting finalization…" : `Review ${label}`}
        </button>}
      {wallet && unavailable && <p className="detail-note">{unavailable}</p>}
    </>}
    <div aria-live="polite" className="transaction-status">
      {state.phase === "success" && <p>Transaction finalized and its effects verified.</p>}
      {state.phase === "failed" && <p>The transaction failed on chain. No successful vault action was recorded.</p>}
      {(inputError || state.reason) && <p>{inputError ?? state.reason}</p>}
      {state.signature && <a href={`https://explorer.solana.com/tx/${state.signature}`} target="_blank" rel="noreferrer">View transaction {shortAddress(state.signature)} ↗</a>}
      {state.phase === "pending" && <button className="text-button" onClick={() => void api.checkStatus()}>Check transaction status</button>}
    </div>
  </div>;
}
