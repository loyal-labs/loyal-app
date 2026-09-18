"use client";

import Image from "next/image";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import type { PositionObservation, VaultObservation } from "../domain/types";
import { formatUnits, shortAddress, useVaultRead } from "./reads";
import { useVaultTransaction } from "./use-vault-transaction";
import { TransactionPanel } from "./transaction-panel";
import { KaminoPositions } from "./kamino-positions";
import { TokenHoldings } from "./token-holdings";
import { WorkerStatus } from "./worker-status";

function AddressLink({ address, label }: { address: string; label?: string }) {
  return (
    <a
      className="address"
      href={`https://explorer.solana.com/address/${address}`}
      target="_blank"
      rel="noreferrer"
      title={address}
    >
      {label ?? shortAddress(address)} <span aria-hidden="true">↗</span>
    </a>
  );
}

export function Dashboard() {
  const {
    publicKey,
    connected,
    connecting,
    wallet,
    wallets,
    select,
    connect,
    disconnect,
  } = useWallet();
  const transaction = useVaultTransaction();
  const [refreshKey, setRefreshKey] = useState(0);
  const [walletMenu, setWalletMenu] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [pendingWallet, setPendingWallet] = useState<string | null>(null);
  const [tab, setTab] = useState<"deposit" | "request" | "claim">("deposit");
  const [copied, setCopied] = useState<string | null>(null);
  const walletAddress = connected ? publicKey?.toBase58() ?? null : null;
  const vault = useVaultRead<VaultObservation>("/api/vault");
  const position = useVaultRead<PositionObservation>(
    walletAddress
      ? `/api/position?wallet=${encodeURIComponent(walletAddress)}`
      : null
  );
  const refreshVault = vault.refresh, refreshPosition = position.refresh;
  useEffect(() => {
    if (transaction.state.phase === "success" || transaction.state.phase === "failed") {
      refreshVault();
      refreshPosition();
      setRefreshKey(value => value + 1);
    }
  }, [transaction.state.phase, transaction.state.signature, refreshVault, refreshPosition]);
  useEffect(() => {
    if (!pendingWallet || wallet?.adapter.name !== pendingWallet) return;
    setPendingWallet(null);
    void connect()
      .then(() => setWalletMenu(false))
      .catch((error) =>
        setWalletError(
          error instanceof Error ? error.message : "Wallet connection failed."
        )
      );
  }, [pendingWallet, wallet, connect]);
  const chooseWallet = (entry: (typeof wallets)[number]) => {
    setWalletError(null);
    if (wallet?.adapter.name === entry.adapter.name)
      void connect()
        .then(() => setWalletMenu(false))
        .catch((error) => setWalletError(String(error)));
    else {
      setPendingWallet(entry.adapter.name);
      select(entry.adapter.name);
    }
  };
  const data = vault.data;
  const refresh = () => {
    vault.refresh();
    position.refresh();
    setRefreshKey(value => value + 1);
  };
  return (
    <div className="shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Loyal Vault home">
          <Image src="/loyal.svg" width="32" height="32" alt="" />
          loyal<span>vault</span>
        </Link>
        <div className="wallet-control">
          <span className="network">Solana mainnet</span>
          {walletAddress ? (
            <button
              className="button secondary"
              onClick={() =>
                void disconnect().catch((error) =>
                  setWalletError(String(error))
                )
              }
              title="Disconnect wallet"
            >
              {shortAddress(walletAddress)} · Disconnect
            </button>
          ) : (
            <button
              className="button"
              disabled={connecting}
              aria-expanded={walletMenu}
              onClick={() => setWalletMenu((value) => !value)}
            >
              {connecting ? "Connecting…" : "Connect wallet"}
            </button>
          )}
          {walletMenu && !walletAddress && (
            <section className="wallet-list" aria-label="Choose a wallet">
              <h2>Connect your wallet</h2>
              {wallets.length ? (
                wallets.map((entry) => (
                  <button
                    className="wallet-option"
                    key={entry.adapter.name}
                    disabled={connecting}
                    onClick={() => chooseWallet(entry)}
                  >
                    {entry.adapter.name}
                  </button>
                ))
              ) : (
                <p>
                  Open this page in your wallet’s browser or enable your wallet
                  extension.
                </p>
              )}
              <button
                className="text-button"
                onClick={() => setWalletMenu(false)}
              >
                Close
              </button>
            </section>
          )}
        </div>
      </header>
      {walletError && (
        <p className="notice error" role="alert">
          {walletError}
        </p>
      )}
      <section className="intro">
        <div>
          <h1>Loyal RWA Vault</h1>
          <p>Deposit USDC, hold vault shares, and manage your withdrawals.</p>
          <p className="detail-note">
            Maple syrupUSDC pilot: deposits are USDC only and the vault is
            capped at 100,000 USDC in total, with the strategy working
            allocation capped at the same ceiling. Deposited funds may remain
            idle when the expected returns do not cover the costs of entering
            the strategy.
          </p>
        </div>
        <div className="intro-details">
          <span className="status">
            {data?.navFreshness.status === "fresh"
              ? "Valuation updated"
              : "Valuation unavailable"}
          </span>
          {data && (
            <AddressLink address={data.identity.vault} label="View vault" />
          )}
        </div>
      </section>
      {vault.error && (
        <div className="notice error" role="alert">
          <strong>We couldn’t read the vault.</strong>
          <p>{vault.error}</p>
          {vault.lastSuccessAt && <p>Last successful vault read: {new Date(vault.lastSuccessAt).toLocaleString()}. This does not establish NAV freshness.</p>}
          <button className="text-button" onClick={refresh}>
            Try again
          </button>
        </div>
      )}
      <div className="overview" aria-busy={vault.loading}>
        <div>
          <span>Reported vault assets</span>
          <strong>
            {data ? `${formatUnits(data.assetTotalValue.raw, 6)} USDC` : "—"}
          </strong>
        </div>
        <div>
          <span>Available liquidity</span>
          <strong>
            {data ? `${formatUnits(data.idleCustody.raw, 6)} USDC` : "—"}
          </strong>
        </div>
        <div>
          <span>Vault share supply</span>
          <strong>
            {data
              ? `${formatUnits(
                  data.lpSupplyBreakdown.circulating,
                  data.identity.lpDecimals
                )} LP`
              : "—"}
          </strong>
        </div>
        <div>
          <span>Withdrawal waiting period</span>
          <strong>
            {data
              ? `${formatUnits(
                  data.terms.withdrawalWaitingPeriodSeconds,
                  0
                )} seconds`
              : "—"}
          </strong>
        </div>
      </div>
      <div className="workspace">
        <div className="portfolio">
          <section className="allocation-section">
            <div className="section-title">
              <h2>Where the assets are</h2>
              <button
                className="text-button"
                onClick={refresh}
                disabled={vault.loading}
              >
                Refresh
              </button>
            </div>
            {vault.loading && !data ? (
              <p className="empty" role="status">
                Reading finalized vault data…
              </p>
            ) : data ? (
              <>
                {data.allocation.reconciliation !== "reconciled" && (
                  <div className="notice">
                    <strong>Allocation is not reconciled.</strong>
                    <p>
                      The reported strategy values and available liquidity do
                      not yet establish a current portfolio valuation.
                    </p>
                  </div>
                )}
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Allocation</th>
                        <th>Observed balance</th>
                        <th>Account</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.allocation.components.map((component) => (
                        <tr key={component.key}>
                          <td>
                            {component.kind === "idle-custody"
                              ? "Available USDC"
                              : component.owner === data.identity.manager ? "Smart account USDC" : "Strategy USDC"}
                            <small>
                              {component.kind === "idle-custody"
                                ? "Vault liquidity"
                                : "Observed custody balance"}
                            </small>
                          </td>
                          <td>
                            {formatUnits(
                              component.amount.raw,
                              component.amount.decimals
                            )}{" "}
                            USDC
                          </td>
                          <td>
                            {component.owner && (
                              <AddressLink address={component.owner} />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <details>
                  <summary>Manager-reported strategy values</summary>
                  <p>Accounting records only; these are excluded from measured custody totals.</p>
                  {data.allocation.reportedStrategyValues.map(component => <p key={component.key}>
                    {component.owner && <AddressLink address={component.owner} />} · {formatUnits(component.amount.raw, component.amount.decimals)} USDC reported
                  </p>)}
                </details>
                <p className="detail-note">
                  Strategy accounting values are separate from the observed Kamino
                  positions below and are not a current portfolio valuation.
                </p>
                <details>
                  <summary>Observation details</summary>
                  <dl>
                    <div>
                      <dt>Finalized slot</dt>
                      <dd>
                        {data.freshness.observedSlot.toLocaleString("en-US")}
                      </dd>
                    </div>
                    <div>
                      <dt>Valuation</dt>
                      <dd>{data.navFreshness.status}</dd>
                    </div>
                    <div>
                      <dt>Accounting reconciliation</dt>
                      <dd>{data.allocation.reconciliation}</dd>
                    </div>
                  </dl>
                  <p>{data.navFreshness.detail}</p>
                </details>
              </>
            ) : (
              <p className="empty">
                Vault data will appear when the connection is available.
              </p>
            )}
          </section>
          <KaminoPositions refreshKey={refreshKey} />
          <TokenHoldings refreshKey={refreshKey} />
          <WorkerStatus refreshKey={refreshKey} />
          <section className="terms-section">
            <h2>How withdrawals work</h2>
            <ol>
              <li>
                <strong>Request a withdrawal</strong>
                <p>Your vault shares move into escrow.</p>
              </li>
              <li>
                <strong>Wait for availability</strong>
                <p>
                  The waiting period must pass and enough USDC must be
                  available.
                </p>
              </li>
              <li>
                <strong>Claim your USDC</strong>
                <p>
                  Confirm the claim in your wallet to receive the available
                  payout.
                </p>
              </li>
            </ol>
          </section>
        </div>
        <aside className="action-panel">
          <h2>Your position</h2>
          {walletAddress ? (
            <>
              <div className="position-heading">
                <AddressLink address={walletAddress} />
                <button
                  className="text-button"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(walletAddress)
                      .then(() => {
                        setCopied(walletAddress);
                        setTimeout(() => setCopied(null), 2000);
                      })
                      .catch(() =>
                        setWalletError(
                          "Copy failed. Open the account link to copy the address."
                        )
                      );
                  }}
                >
                  {copied === walletAddress ? "Copied" : "Copy address"}
                </button>
              </div>
              {position.error ? (
                <p className="notice error" role="alert">
                  {position.error}
                </p>
              ) : (
                <dl className="position-balances">
                  <div>
                    <dt>USDC in wallet</dt>
                    <dd>
                      {position.data
                        ? formatUnits(position.data.usdc.balance.raw, 6)
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Vault shares</dt>
                    <dd>
                      {position.data
                        ? formatUnits(
                            position.data.lp.balance.raw,
                            position.data.lp.balance.decimals
                          )
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Shares in withdrawal</dt>
                    <dd>
                      {position.data
                        ? position.data.escrowedLp
                          ? formatUnits(
                              position.data.escrowedLp.raw,
                              position.data.escrowedLp.decimals
                            )
                          : "0"
                        : "—"}
                    </dd>
                  </div>
                </dl>
              )}
            </>
          ) : (
            <p className="muted">
              Connect your wallet to view shares and withdrawal requests.
            </p>
          )}
          <div className="tabs" role="tablist" aria-label="Vault action">
            {(
              [
                ["deposit", "Deposit"],
                ["request", "Withdraw"],
                ["claim", "Claim"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                id={`vault-tab-${key}`}
                role="tab"
                aria-controls="vault-action-panel"
                tabIndex={tab === key ? 0 : -1}
                aria-selected={tab === key}
                onKeyDown={(event) => {
                  const order = ["deposit", "request", "claim"] as const;
                  const index = order.indexOf(key);
                  const next =
                    event.key === "ArrowRight"
                      ? (index + 1) % 3
                      : event.key === "ArrowLeft"
                      ? (index + 2) % 3
                      : event.key === "Home"
                      ? 0
                      : event.key === "End"
                      ? 2
                      : null;
                  if (next !== null) {
                    event.preventDefault();
                    setTab(order[next]);
                    document
                      .getElementById(`vault-tab-${order[next]}`)
                      ?.focus();
                  }
                }}
                disabled={["preparing", "review", "signing", "submitting", "pending"].includes(transaction.state.phase)}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <TransactionPanel action={tab === "request" ? "request-withdraw" : tab} wallet={walletAddress}
            vault={data} position={position.data} api={transaction} connect={() => setWalletMenu(true)} />
        </aside>
      </div>
      <footer>
        <span>Loyal · Backyard Finance partner demo</span>
        <span>Wallet signatures are required for every transaction.</span>
      </footer>
    </div>
  );
}
