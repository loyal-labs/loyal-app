"use client";

import { ArrowLeft, Check, Clock3, RefreshCw, X } from "lucide-react";
import { useMemo, useState } from "react";

import {
  ScrambledPopDigits,
  useBalanceVisibility,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import type {
  EarnMaxActions,
  EarnMaxActivityItem,
  EarnMaxViewModel,
} from "@/features/earn-max";

function apyLabel(bps: number | null) {
  return bps === null ? "—" : `${(bps / 100).toFixed(2)}% APY`;
}

function usd(value: number | null) {
  return value === null
    ? "—"
    : value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function splitBalance(value: number) {
  const formatted = value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const [whole, fraction = "00"] = formatted.split(".");
  return { whole: `$${whole}`, fraction: `.${fraction}` };
}

function rawUsdc(value: string): bigint | null {
  if (!/^\d+(?:\.\d{0,6})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(".");
  return BigInt(whole!) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, "0"));
}

function activityLabel(item: EarnMaxActivityItem) {
  if (item.kind === "deposit") return "Deposit";
  return item.status === "cancelled" ? "Withdrawal cancelled" : "Withdrawal";
}

function activityAmount(item: EarnMaxActivityItem) {
  const raw = /^\d+$/.test(item.amountRaw) ? BigInt(item.amountRaw) : BigInt(0);
  const cents =
    raw === BigInt(0) ? raw : (raw + BigInt(9_999)) / BigInt(10_000);
  const whole = cents / BigInt(100);
  const fraction = (cents % BigInt(100)).toString().padStart(2, "0");
  let sign = "-";
  if (item.status === "cancelled") sign = "";
  else if (item.kind === "deposit") sign = "+";
  return `${sign}$${whole.toLocaleString("en-US")}.${fraction}`;
}

function EarnMaxChart({ points }: { points: EarnMaxViewModel["performance"] }) {
  const path = useMemo(() => {
    if (points.length < 2) return "";
    const values = points.map((point) => point.equityUsd);
    const low = Math.min(...values);
    const range = Math.max(Math.max(...values) - low, 0.01);
    return points
      .map((point, index) => {
        const x = (index / (points.length - 1)) * 100;
        const y = 100 - ((point.equityUsd - low) / range) * 88 - 6;
        return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [points]);
  return (
    <section className="flex min-h-56 flex-col rounded-3xl bg-card p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-[20px]">Performance</h2>
        <span className="text-[13px] text-muted-foreground">
          {points.length > 1
            ? `${points.length} confirmed observations`
            : "Collecting history"}
        </span>
      </div>
      <div className="mt-5 min-h-36 flex-1 rounded-2xl bg-accent p-3">
        {path ? (
          <svg
            aria-label="Earn MAX equity history"
            className="h-full w-full"
            preserveAspectRatio="none"
            viewBox="0 0 100 100"
          >
            <path
              d={path}
              fill="none"
              stroke="var(--positive)"
              strokeLinecap="round"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : (
          <div className="flex h-full items-center justify-center text-[14px] text-muted-foreground">
            History appears after confirmed position snapshots.
          </div>
        )}
      </div>
    </section>
  );
}

function AmountPane({
  actions,
  kind,
  onBack,
}: {
  actions: EarnMaxActions;
  kind: "deposit" | "withdraw";
  onBack: () => void;
}) {
  const [amount, setAmount] = useState("");
  const parsed = rawUsdc(amount);
  const submit = async () => {
    if (!parsed || parsed <= BigInt(0)) return;
    const ok =
      kind === "deposit"
        ? await actions.deposit(parsed)
        : await actions.requestWithdrawal(parsed);
    if (ok) onBack();
  };
  return (
    <section className="flex h-full min-w-0 flex-1 flex-col rounded-3xl bg-card p-6 max-[795px]:rounded-none">
      <header className="flex items-center gap-3">
        <button
          aria-label="Back"
          className="rounded-full p-2 hover:bg-accent"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft className="size-5" />
        </button>
        <h1 className="font-semibold text-[22px]">
          {kind === "deposit" ? "Deposit" : "Withdraw"}
        </h1>
      </header>
      <div className="mx-auto mt-12 flex w-full max-w-lg flex-col gap-4">
        <label
          className="text-[14px] text-muted-foreground"
          htmlFor="earn-max-amount"
        >
          USDC amount
        </label>
        <div className="flex items-center rounded-2xl bg-accent px-5 py-4">
          <span className="text-[28px] text-muted-foreground">$</span>
          <input
            autoFocus
            className="min-w-0 flex-1 bg-transparent px-2 text-[36px] outline-none"
            id="earn-max-amount"
            inputMode="decimal"
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            value={amount}
          />
          <span className="font-medium">USDC</span>
        </div>
        {kind === "withdraw" ? (
          <button
            className="self-end text-[14px] text-positive"
            onClick={() =>
              void actions.requestWithdrawal("max").then((ok) => ok && onBack())
            }
            type="button"
          >
            Withdraw full balance
          </button>
        ) : null}
        <button
          className="mt-4 rounded-full bg-foreground px-5 py-3 font-medium text-background disabled:opacity-40"
          disabled={!parsed || parsed <= BigInt(0)}
          onClick={() => void submit()}
          type="button"
        >
          Confirm {kind}
        </button>
      </div>
    </section>
  );
}

function WithdrawalCard({
  actions,
  value,
}: {
  actions: EarnMaxActions;
  value: NonNullable<EarnMaxViewModel["withdrawal"]>;
}) {
  return (
    <section className="rounded-3xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">Withdrawal {value.status}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Ready by{" "}
            {value.readyBy
              ? new Date(value.readyBy).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"}
          </p>
        </div>
        <div className="flex gap-2">
          {value.canCancel ? (
            <button
              className="rounded-full bg-accent px-4 py-2 text-[14px]"
              onClick={() => void actions.cancelWithdrawal()}
              type="button"
            >
              Cancel
            </button>
          ) : null}
          {value.canClaim ? (
            <button
              className="rounded-full bg-foreground px-4 py-2 text-[14px] text-background"
              onClick={() => void actions.claim()}
              type="button"
            >
              Claim now
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function EarnMaxPage({
  actions,
  view,
}: {
  actions: EarnMaxActions;
  view: EarnMaxViewModel;
}) {
  const [screen, setScreen] = useState<"main" | "deposit" | "withdraw">("main");
  const { isBalanceHidden } = useBalanceVisibility();
  if (screen !== "main") {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-1 p-2 max-[795px]:p-0">
        <AmountPane
          actions={actions}
          kind={screen}
          onBack={() => setScreen("main")}
        />
      </div>
    );
  }
  const balance = splitBalance(view.balanceUsd);
  return (
    <div className="grid h-full min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)_400px] gap-2 overflow-y-auto p-2 max-[1203px]:grid-cols-1 max-[795px]:p-0">
      <main className="flex min-w-0 flex-col gap-2">
        <section className="rounded-3xl bg-card p-6 max-[795px]:rounded-t-none">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-semibold text-[24px]">Earn MAX</h1>
                <span className="rounded-lg bg-positive/[0.14] px-2 py-1 text-[13px] text-positive">
                  {apyLabel(view.forecastApyBps)}
                </span>
              </div>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {view.strategyLabel} · {view.status.replaceAll("_", " ")}
              </p>
            </div>
            <button
              aria-label="Refresh Earn MAX"
              className="rounded-full p-2 hover:bg-accent"
              onClick={() => void actions.refresh()}
              type="button"
            >
              <RefreshCw
                className={`size-5 ${view.isLoading ? "animate-spin" : ""}`}
              />
            </button>
          </header>
          <div className="mt-8">
            <p className="text-[14px] text-muted-foreground">Position equity</p>
            <p className="mt-1 whitespace-nowrap font-semibold text-[42px] [font-variant-numeric:tabular-nums]">
              <ScrambledPopDigits
                isHidden={isBalanceHidden}
                segments={[
                  { text: balance.whole },
                  { color: "var(--tertiary)", text: balance.fraction },
                ]}
              />
            </p>
          </div>
          <div className="mt-7 grid grid-cols-3 gap-2 max-[620px]:grid-cols-1">
            <div className="rounded-2xl bg-accent p-4">
              <p className="text-[13px] text-muted-foreground">Earned</p>
              <p className="mt-1 font-medium">{usd(view.earnedUsd)}</p>
            </div>
            <div className="rounded-2xl bg-accent p-4">
              <p className="text-[13px] text-muted-foreground">Realized APY</p>
              <p className="mt-1 font-medium">
                {apyLabel(view.realizedApyBps)}
              </p>
            </div>
            <div className="rounded-2xl bg-accent p-4">
              <p className="text-[13px] text-muted-foreground">History</p>
              <p className="mt-1 font-medium">
                {view.coverage === "complete" ? "Complete" : "Building"}
              </p>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            {view.policyStatus !== "ready" ? (
              <button
                className="rounded-full bg-foreground px-5 py-3 font-medium text-background"
                disabled={view.isBusy}
                onClick={() => void actions.install()}
                type="button"
              >
                Install policies
              </button>
            ) : (
              <>
                <button
                  className="rounded-full bg-foreground px-5 py-3 font-medium text-background"
                  disabled={view.isBusy}
                  onClick={() => setScreen("deposit")}
                  type="button"
                >
                  Deposit / top up
                </button>
                <button
                  className="rounded-full bg-accent px-5 py-3 font-medium"
                  disabled={view.isBusy || view.balanceUsd <= 0}
                  onClick={() => setScreen("withdraw")}
                  type="button"
                >
                  Withdraw
                </button>
                {view.balanceUsd === 0 && view.status === "claimed" ? (
                  <button
                    className="rounded-full bg-accent px-5 py-3 font-medium"
                    disabled={view.isBusy}
                    onClick={() => void actions.close()}
                    type="button"
                  >
                    Close policies
                  </button>
                ) : null}
              </>
            )}
          </div>
          {view.error ? (
            <p className="mt-4 rounded-xl bg-destructive/10 p-3 text-[14px] text-destructive">
              {view.error}
            </p>
          ) : null}
        </section>
        {view.withdrawal ? (
          <WithdrawalCard actions={actions} value={view.withdrawal} />
        ) : null}
        <section className="rounded-3xl bg-card p-6">
          <h2 className="font-semibold text-[20px]">Activity</h2>
          <div className="mt-4 divide-y divide-border">
            {view.activity.length === 0 ? (
              <p className="py-6 text-[14px] text-muted-foreground">
                No confirmed Earn MAX activity yet.
              </p>
            ) : (
              view.activity.slice(0, 12).map((item) => (
                <div className="flex items-center gap-3 py-3" key={item.id}>
                  <span className="rounded-full bg-accent p-2">
                    {item.status === "completed" ? (
                      <Check className="size-4 text-positive" />
                    ) : (
                      <Clock3 className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {activityLabel(item)}
                    </p>
                    <p className="text-[12px] text-muted-foreground">
                      {item.timestamp
                        ? new Date(item.timestamp).toLocaleString()
                        : "Confirming"}
                    </p>
                  </div>
                  <span
                    className={
                      item.kind === "deposit"
                        ? "font-medium text-positive"
                        : "font-medium"
                    }
                  >
                    {activityAmount(item)}
                  </span>
                  {item.signature ? (
                    <a
                      aria-label="View transaction"
                      className="rounded-full p-2 hover:bg-accent"
                      href={`https://solscan.io/tx/${item.signature}`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <X className="size-4 rotate-45" />
                    </a>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </section>
      </main>
      <EarnMaxChart points={view.performance} />
    </div>
  );
}
