import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";

import {
  ago,
  compactUsd,
  dateTime,
  pct,
  usd,
  words,
} from "@/components/backyard/format";
import { HeroChart } from "@/components/backyard/hero-chart";
import { AutoRefresh, TimeChart } from "@/components/backyard/time-chart";
import {
  Address,
  Card,
  CardHead,
  Fact,
  Label,
  Pill,
  TableWrap,
  Td,
  Th,
  Unavailable,
} from "@/components/backyard/ui";
import { type BackyardData, getBackyardData } from "@/lib/backyard/data.server";
import { loanToValue } from "@/lib/backyard/math";
import { BACKYARD_VAULT, type BackyardVault } from "@/lib/backyard/vaults";

export const dynamic = "force-dynamic";

const ALERT_LTV = 0.45;
const WITHDRAWAL_STEP_LTV = 0.55;
const HARD_RULE_LTV = 0.6;
const LIQUIDATION_LTV = 0.8;
// Routine NAV reports are hourly; allow 15 minutes for reporting/reconciliation.
const STALE_REPORT_S = 75 * 60;
const DOCS_URL = "https://docs.askloyal.com/vaults/rwa-loop-strategy";

// Worker journal actions in plain words.
const ACTION_WORDS: Record<string, string> = {
  DELEVER_PRIME_USDC_STEP: "Repaid or withdrew on Kamino",
  DELEVER_ROUTE_STEP: "Repaid or withdrew on Kamino",
  INITIALIZE_KAMINO_OBLIGATION: "Opened a Kamino account",
  OPEN_PRIME_USDC_STEP: "Deposited or borrowed on Kamino",
  OPEN_ROUTE_STEP: "Deposited or borrowed on Kamino",
  POLICY_SETUP_CREATE: "Created a spending policy",
  POLICY_SETUP_PREFUND: "Funded a spending policy setup",
  RECOVER_TRANSACTION: "Recovered an unfinished transaction",
  STAGE_SQUADS_TO_VOLTR: "Moved worker cash back to the vault",
  SWAP_COLLATERAL_TO_DEBT_STEP: "Swapped collateral to the borrowed token",
  SWAP_COLLATERAL_TO_STABLE_STEP: "Swapped collateral to USDC",
  SWAP_DEBT_TO_COLLATERAL_STEP: "Swapped the borrowed token to collateral",
  SWAP_DEBT_TO_USDC_STEP: "Swapped leftover borrowed token to USDC",
  SWAP_PRIME_TO_USDC_STEP: "Swapped collateral to USDC",
  SWAP_STABLE_TO_COLLATERAL_STEP: "Swapped USDC to collateral",
  SWAP_USDC_TO_DEBT_STEP: "Swapped USDC to the borrowed token",
  SWAP_USDC_TO_PRIME_STEP: "Swapped USDC to collateral",
  VOLTR_ALLOCATE_TO_SQUADS: "Moved vault cash to the worker",
  VOLTR_RESTORE_IDLE: "Returned cash to the vault",
};

// Selector reasons in plain words; anything else shows with spaces.
const SELECTOR_REASONS: Record<string, string> = {
  advantage_not_yet_persistent:
    "a better market has not lasted long enough yet",
  complete_current_tranche_first: "finishing the current step first",
  no_worthwhile_executable_move: "no better market right now",
  persistent_net_benefit: "a better market has lasted long enough",
};

const levelLabel = (level: number) => `${level}x`;

export const metadata: Metadata = {
  description:
    "Live, read-only view of the Loyal Looping vault on Voltr: share price, APY, positions and every money move.",
  title: "Loyal Looping · Backyard",
};

type Route = Extract<BackyardData["route"], { ok: true }>["value"];

export default async function BackyardPage() {
  const vault = BACKYARD_VAULT;
  const data = await getBackyardData();
  const now = Date.parse(data.loadedAt);
  const route = data.route.ok ? data.route.value : null;
  const voltr = data.voltr.ok ? data.voltr.value : null;
  const ltv =
    route?.navUsd != null && route.debtUsd != null && route.custodyUsd !== null
      ? loanToValue(route.navUsd, route.debtUsd, route.custodyUsd)
      : null;
  // Actual leverage = collateral / equity = (NAV + debt) / NAV.
  const leverageNow =
    route?.currentApy?.level ??
    (route?.navUsd && route.debtUsd != null
      ? (route.navUsd + route.debtUsd) / route.navUsd
      : null);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <AutoRefresh />
      <section className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-10">
          <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <Image
                alt=""
                aria-hidden="true"
                className="size-11 shrink-0"
                height={44}
                priority
                src="/app-icon.svg"
                width={44}
              />
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Loyal × Backyard
                </p>
                <h1 className="text-2xl font-semibold tracking-normal">
                  {vault.name}
                </h1>
              </div>
            </div>
            <a
              className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
              href={`https://voltr.xyz/vault/${vault.voltrVault}`}
              rel="noreferrer"
              target="_blank"
            >
              {vault.short} vault on Voltr
              <ArrowUpRight aria-hidden="true" className="size-4" />
            </a>
          </header>

          <div className="grid gap-8 border-t pt-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <HeroChart
              apy={
                voltr
                  ? {
                      current: route?.currentApy
                        ? {
                            lane: route.currentApy.lane,
                            pct: route.currentApy.apyPct,
                          }
                        : null,
                      daily: voltr.daily,
                      history: voltr.apyHistory,
                      priceNow: voltr.priceNow,
                    }
                  : null
              }
              breakdown={data.breakdown.ok ? data.breakdown.value : null}
              moveDays={
                data.moveDays.ok ? data.moveDays.value.map((d) => d.day) : []
              }
              nowIso={data.loadedAt}
              tvl={
                voltr
                  ? {
                      exposureUsd:
                        route?.navUsd != null && route.debtUsd != null
                          ? route.navUsd + route.debtUsd
                          : null,
                      points: voltr.tvl,
                      totalUsd: voltr.totalValueUsd,
                    }
                  : null
              }
            />
            <Overview data={data} route={route} vault={vault} />
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-10">
        <Pulse data={data} route={route} />
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <RightNow data={data} leverageNow={leverageNow} ltv={ltv} now={now} />
          <LoanSafety
            leverageNow={leverageNow}
            ltv={ltv}
            route={route}
            vault={vault}
          />
        </section>
        <ApyHistory data={data} />
        <LeverageLevels data={data} leverageNow={leverageNow} now={now} />
        <BorrowingRoom data={data} />
        <PositionHistory data={data} />
        <MoneyMoves data={data} />
        <p className="text-xs leading-5 text-muted-foreground">
          Loaded {dateTime(data.loadedAt)}; refreshes every minute. Sources: the
          Loyal worker&apos;s own records, Voltr and Kamino public APIs. Every
          number is computed on load and can be checked on chain; see{" "}
          <a
            className="underline underline-offset-2"
            href={DOCS_URL}
            rel="noreferrer"
            target="_blank"
          >
            how the strategy works
          </a>
          .
        </p>
      </div>
    </main>
  );
}

function Overview({
  data,
  route,
  vault,
}: {
  data: BackyardData;
  route: Route | null;
  vault: BackyardVault;
}) {
  const voltr = data.voltr.ok ? data.voltr.value : null;
  return (
    <aside className="flex min-w-0 flex-col gap-5 lg:border-l lg:pl-8">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Overview
        </p>
        <h2 className="text-2xl font-semibold tracking-tight">
          Leveraged stablecoin looping
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Automated USDC looping on Kamino against yield-bearing RWA collateral.
          The Loyal worker picks the market and leverage, rebalances, and
          reports NAV to Voltr {vault.navCadence}.
        </p>
        <p className="text-sm leading-6">{vault.custody}</p>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-t pt-5">
        <div>
          <Label>TVL</Label>
          <dd className="mt-1 text-lg font-semibold tabular-nums">
            {compactUsd(voltr?.totalValueUsd)}
          </dd>
        </div>
        <div>
          <Label>Share price</Label>
          <dd className="mt-1 text-lg font-semibold tabular-nums">
            {voltr
              ? voltr.sharePrice.toLocaleString("en-US", {
                  maximumFractionDigits: 4,
                })
              : "—"}
          </dd>
          <p className="text-xs text-muted-foreground">USDC per LP</p>
        </div>
        <div>
          <Label>Realized APY, 7 days</Label>
          <dd className="mt-1 text-lg font-semibold tabular-nums">
            {voltr?.realized ? pct(voltr.realized.apy * 100) : "—"}
          </dd>
        </div>
        <div>
          <Label>Last NAV report</Label>
          <dd className="mt-1 text-lg font-semibold tabular-nums">
            {route ? `${ago(route.reportAgeS)} ago` : "—"}
          </dd>
        </div>
      </dl>
      <div className="space-y-1.5 border-t pt-5 text-sm">
        <p className="flex justify-between gap-3">
          <span className="text-muted-foreground">Voltr vault</span>
          <Address address={vault.voltrVault} />
        </p>
        <p className="flex justify-between gap-3">
          <span className="text-muted-foreground">LP mint</span>
          <Address address={vault.lpMint} />
        </p>
        <p className="flex justify-between gap-3">
          <span className="text-muted-foreground">Manager Squads account</span>
          <Address address={vault.squads} />
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <a
          className="inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors duration-150 hover:bg-[#e72f34]"
          href={`https://voltr.xyz/vault/${vault.voltrVault}`}
          rel="noreferrer"
          target="_blank"
        >
          Open on Voltr <ArrowUpRight aria-hidden="true" className="size-4" />
        </a>
        <a
          className="inline-flex h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors duration-150 hover:bg-muted"
          href={DOCS_URL}
          rel="noreferrer"
          target="_blank"
        >
          Strategy docs <ArrowUpRight aria-hidden="true" className="size-4" />
        </a>
      </div>
    </aside>
  );
}

function Pulse({ data, route }: { data: BackyardData; route: Route | null }) {
  const stops = data.health.ok ? data.health.value.openStops : null;
  const stopped = Boolean(stops?.length);
  const stale = (route?.reportAgeS ?? Infinity) > STALE_REPORT_S;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Pill tone={stopped || stale ? "bad" : "good"}>
        {stopped
          ? "Paused for an operator check"
          : route
          ? `Last NAV report ${ago(route.reportAgeS)} ago`
          : "Worker state unavailable"}
      </Pill>
      {route?.routeStatus ? (
        <Pill>Route {words(route.routeStatus)}</Pill>
      ) : null}
      {route?.reportObservedAt ? (
        <span className="text-xs text-muted-foreground">
          Last report {dateTime(route.reportObservedAt)} · state written{" "}
          {ago(route.updatedAgeS)} ago
        </span>
      ) : null}
    </div>
  );
}

function verdict(
  route: Route | null,
  stops: string[] | null,
  ltv: number | null
) {
  if (!route) return { bad: true, text: "Worker state is unavailable." };
  if (stops?.length)
    return { bad: true, text: "Paused for an operator check." };
  if (ltv !== null && ltv >= ALERT_LTV)
    return {
      bad: true,
      text: `The loan is above the ${Math.round(ALERT_LTV * 100)}% alert.`,
    };
  if ((route.reportAgeS ?? Infinity) > STALE_REPORT_S)
    return { bad: true, text: "NAV reports have stalled." };
  if (route.currentApy?.flat || (route.debtUsd ?? 0) === 0)
    return { bad: false, text: "Healthy. No loop open yet." };
  return { bad: false, text: "Healthy and earning." };
}

function RightNow({
  data,
  leverageNow,
  ltv,
  now,
}: {
  data: BackyardData;
  leverageNow: number | null;
  ltv: number | null;
  now: number;
}) {
  const route = data.route.ok ? data.route.value : null;
  const health = data.health.ok ? data.health.value : null;
  const voltr = data.voltr.ok ? data.voltr.value : null;
  const state = verdict(route, health?.openStops ?? null, ltv);
  const why = [
    `LTV ${ltv === null ? "—" : pct(ltv * 100, 1)} (alert at ${Math.round(
      ALERT_LTV * 100
    )}%, hard rule ${Math.round(HARD_RULE_LTV * 100)}%).`,
    health
      ? `${health.navReconciled} of ${health.navAll} NAV reports landed in the last 24 hours.`
      : "",
    route?.selectorAction && route.selectorReason !== "accounting_first"
      ? `Optimizer: ${words(route.selectorAction)} (${
          (route.selectorReason && SELECTOR_REASONS[route.selectorReason]) ??
          words(route.selectorReason)
        }).`
      : "",
  ].join(" ");
  const apyNow = route?.currentApy;
  const idle = route?.voltrIdleUsd ?? null;
  const series = data.navSeries.ok ? data.navSeries.value : [];

  return (
    <Card>
      <header className="mb-5 space-y-1">
        <p className="text-sm text-muted-foreground">Right now</p>
        <h2
          className={`text-2xl font-semibold tracking-tight ${
            state.bad ? "text-primary" : ""
          }`}
        >
          {state.text}
        </h2>
        <p className="text-sm text-muted-foreground">{why}</p>
      </header>
      <div className="space-y-5">
        <div>
          <p className="text-4xl font-semibold tabular-nums tracking-tight">
            {usd(voltr?.totalValueUsd ?? route?.navUsd)}
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            {route?.navUsd != null
              ? `${usd(route.navUsd)} in the loop · ${
                  idle === null
                    ? "idle cash unavailable"
                    : idle > 0.005
                    ? `${usd(idle)} idle in the vault, not earning yet`
                    : "all of it earning"
                }`
              : null}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Fact
            hint={
              apyNow
                ? `${apyNow.lane ?? "position"} at ${
                    leverageNow === null ? "—" : `${leverageNow.toFixed(2)}x`
                  }${apyNow.flat ? " · no position" : ""} · ${ago(
                    apyNow.observedAt
                      ? (now - Date.parse(apyNow.observedAt)) / 1000
                      : null
                  )} ago`
                : "Not published by the worker yet"
            }
            label="APY now"
            value={apyNow ? pct(apyNow.apyPct) : "—"}
          />
          <Fact
            hint={
              voltr?.realized
                ? `From the share price since ${voltr.realized.since}`
                : data.voltr.ok
                ? "Needs 12 hours of history"
                : "Voltr unavailable"
            }
            label="Realized APY, 7 days"
            value={voltr?.realized ? pct(voltr.realized.apy * 100) : "—"}
          />
        </div>
        <div className="space-y-1">
          <Label>Value in the loop, last 24 hours</Label>
          {series.length > 1 ? (
            <TimeChart
              data={series.map((point) => ({
                at: point.at,
                value: point.navUsd,
              }))}
              label="NAV"
              unit="usd"
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Not enough NAV reports to draw a chart.
            </p>
          )}
          {!data.navSeries.ok ? (
            <Unavailable error={data.navSeries.error} what="NAV history" />
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function LoanSafety({
  leverageNow,
  ltv,
  route,
  vault,
}: {
  leverageNow: number | null;
  ltv: number | null;
  route: Route | null;
  vault: BackyardVault;
}) {
  const x = (value: number) =>
    `${(Math.min(value, LIQUIDATION_LTV) / LIQUIDATION_LTV) * 100}%`;
  const marks = [
    { label: "alert", value: ALERT_LTV },
    { label: "withdrawal step cap", value: WITHDRAWAL_STEP_LTV },
    { label: "hard rule", value: HARD_RULE_LTV },
  ];
  const target = route?.leverageTarget ?? null;
  const targetHint =
    target === null
      ? "Not chosen yet"
      : leverageNow !== null && target <= leverageNow + 0.05
      ? "At target"
      : route?.lastHoldReason === "debt_reserve_utilization_blocks_borrow"
      ? "Waiting: Kamino blocks borrowing (pool above 90%)"
      : "Moving up";

  return (
    <Card>
      <CardHead
        eyebrow="Loan safety"
        note={`The worker must stay left of the ${Math.round(
          HARD_RULE_LTV * 100
        )}% rule. Liquidation starts near ${Math.round(
          LIQUIDATION_LTV * 100
        )}%.`}
        title="Borrowed against collateral on Kamino"
      />
      <div className="space-y-6">
        <div>
          <div className="relative h-10">
            <div
              className="absolute top-3.5 h-3 rounded-l-full bg-muted"
              style={{ left: 0, width: x(ALERT_LTV) }}
            />
            <div
              className="absolute top-3.5 h-3 bg-foreground/15"
              style={{
                left: x(ALERT_LTV),
                width: `calc(${x(HARD_RULE_LTV)} - ${x(ALERT_LTV)})`,
              }}
            />
            <div
              className="absolute top-3.5 h-3 rounded-r-full bg-primary/25"
              style={{ left: x(HARD_RULE_LTV), right: 0 }}
            />
            {marks.map((mark) => (
              <div
                className="absolute top-2 h-6 border-l border-dashed border-foreground/40"
                key={mark.label}
                style={{ left: x(mark.value) }}
              />
            ))}
            {ltv !== null ? (
              <div
                aria-label={`LTV ${(ltv * 100).toFixed(1)}%`}
                className="absolute top-1 h-8 w-0.5 -translate-x-1/2 rounded bg-foreground"
                role="img"
                style={{ left: x(ltv) }}
              />
            ) : null}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {marks.map((mark) => (
              <span key={mark.label}>
                <b className="font-mono text-foreground">
                  {Math.round(mark.value * 100)}%
                </b>{" "}
                {mark.label}
              </span>
            ))}
            <span>
              <b className="font-mono text-foreground">
                {Math.round(LIQUIDATION_LTV * 100)}%
              </b>{" "}
              liquidation (right edge)
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Fact
            hint="Debt / collateral in Kamino"
            label="LTV"
            value={ltv === null ? "—" : pct(ltv * 100, 1)}
          />
          <Fact
            hint="Payoff amount, interest included"
            label="Borrowed"
            value={usd(route?.debtUsd)}
          />
          <Fact
            hint={
              <>
                Squads account <Address address={vault.squads} />
              </>
            }
            label="Cash in worker custody"
            value={usd(route?.custodyUsd)}
          />
          <Fact
            hint="Waiting in Voltr, not yet allocated"
            label="Idle in the vault"
            value={usd(route?.voltrIdleUsd)}
          />
          <Fact
            hint="Collateral / equity"
            label="Leverage now"
            value={leverageNow === null ? "—" : `${leverageNow.toFixed(2)}x`}
          />
          <Fact
            hint={targetHint}
            label="Leverage target"
            value={target === null ? "—" : levelLabel(target)}
          />
        </div>
      </div>
    </Card>
  );
}

function ApyHistory({ data }: { data: BackyardData }) {
  const history = data.voltr.ok ? data.voltr.value.apyHistory : [];
  const chart = (title: string, key: "dayApy" | "sevenDayApy") => (
    <div className="min-w-0 space-y-1">
      <Label>{title}</Label>
      <TimeChart
        data={history.map((p) => ({
          at: p.at,
          value: p[key] === null ? null : p[key] * 100,
        }))}
        label={title}
        unit="pct"
      />
    </div>
  );
  return (
    <Card>
      <CardHead
        eyebrow="APY paid to depositors"
        title="Share-price growth after all costs, per day"
      />
      {!data.voltr.ok ? (
        <Unavailable error={data.voltr.error} what="APY history" />
      ) : history.length < 2 ? (
        <p className="text-sm text-muted-foreground">
          Not enough days of history yet.
        </p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {chart("7-day APY", "sevenDayApy")}
          {chart("Daily APY", "dayApy")}
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        From the Voltr share price at the end of each UTC day. The 7-day line
        ends at now; the daily line shows finished days only. This is what
        depositors actually earned, unlike APY now, which is the forecast for
        the live position.
      </p>
    </Card>
  );
}

function LeverageLevels({
  data,
  leverageNow,
  now,
}: {
  data: BackyardData;
  leverageNow: number | null;
  now: number;
}) {
  const watch = data.route.ok ? data.route.value.leverageWatch : null;
  const levels = watch
    ? [
        ...new Set(watch.lanes.flatMap((lane) => Object.keys(lane.apyPct))),
      ].sort((a, b) => Number(a) - Number(b))
    : [];
  const nowLevel =
    leverageNow === null
      ? null
      : levels.reduce<string | null>(
          (best, level) =>
            best === null ||
            Math.abs(Number(level) - leverageNow) <
              Math.abs(Number(best) - leverageNow)
              ? level
              : best,
          null
        );

  return (
    <Card>
      <CardHead
        eyebrow="Leverage levels"
        note={
          watch
            ? `Hourly worker reading from ${dateTime(watch.observedAt)} (${ago(
                (now - Date.parse(watch.observedAt)) / 1000
              )} ago)`
            : undefined
        }
        title="What each market would pay at each leverage level"
      />
      {!data.route.ok ? (
        <Unavailable error={data.route.error} what="Leverage readings" />
      ) : !watch ? (
        <p className="text-sm text-muted-foreground">
          Awaiting the first reading. The worker writes one every hour.
        </p>
      ) : (
        <>
          <TableWrap>
            <thead>
              <tr>
                <Th>Market</Th>
                <Th right>Spread</Th>
                {levels.map((level) => (
                  <Th key={level} right>
                    {levelLabel(Number(level))}
                    {level === nowLevel ? " (now)" : ""}
                  </Th>
                ))}
                <Th>Level picks</Th>
              </tr>
            </thead>
            <tbody>
              {watch.lanes.map((lane) => {
                const best = Math.max(...Object.values(lane.apyPct));
                return (
                  <tr key={lane.lane}>
                    <Td>
                      <p className="font-medium">{lane.lane}</p>
                      <p className="text-xs text-muted-foreground">
                        {lane.enterable ? "Can enter" : "Cannot enter yet"}
                        {lane.older ? " · older reading" : ""}
                      </p>
                    </Td>
                    <Td
                      className={lane.spreadPct < 0 ? "text-primary" : ""}
                      right
                    >
                      {lane.spreadPct > 0 ? "+" : lane.spreadPct < 0 ? "−" : ""}
                      {Math.abs(lane.spreadPct).toFixed(2)}
                    </Td>
                    {levels.map((level) => {
                      const apy = lane.apyPct[level];
                      return (
                        <Td
                          className={
                            apy === best
                              ? "font-semibold text-foreground"
                              : "text-muted-foreground"
                          }
                          key={level}
                          right
                        >
                          {apy === undefined ? "—" : pct(apy)}
                        </Td>
                      );
                    })}
                    <Td className="font-mono">
                      {lane.levels.map(levelLabel).join(" · ") || "—"}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
          <p className="mt-3 text-xs text-muted-foreground">
            Spread is token yield minus borrow cost, in percentage points. Bold
            is the best level for each market. An older reading means the market
            was missing from the latest hourly reading. Level picks: the level
            the worker would choose under its three safety settings.
          </p>
        </>
      )}
    </Card>
  );
}

function BorrowingRoom({ data }: { data: BackyardData }) {
  return (
    <Card>
      <CardHead
        eyebrow="Borrowing room"
        title="How much more each market can lend before Kamino blocks borrowing"
      />
      {data.borrowing.ok ? (
        <TableWrap>
          <thead>
            <tr>
              <Th>Market</Th>
              <Th>Borrowed token</Th>
              <Th right>Pool used</Th>
              <Th right>Borrow APY</Th>
              <Th right>Room to 90% used</Th>
              <Th right>Pool size</Th>
            </tr>
          </thead>
          <tbody>
            {data.borrowing.value.map((row) => (
              <tr key={row.lane}>
                <Td className="font-medium">{row.lane}</Td>
                <Td>{row.token}</Td>
                <Td
                  className={row.utilization >= 0.9 ? "text-primary" : ""}
                  right
                >
                  {pct(row.utilization * 100, 1)}
                </Td>
                <Td right>{pct(row.borrowApyPct)}</Td>
                <Td right>{usd(row.roomTo90Usd)}</Td>
                <Td className="text-muted-foreground" right>
                  {compactUsd(row.supplyUsd)}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : (
        <Unavailable error={data.borrowing.error} what="Kamino metrics" />
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        From Kamino public reserve metrics. Pool used = borrowed / supplied.
        Above 90% used, Kamino stops new borrows.
      </p>
    </Card>
  );
}

function PositionHistory({ data }: { data: BackyardData }) {
  const points = data.history.ok ? data.history.value : [];
  const chart = (
    title: string,
    key: "equityUsd" | "ltvPct",
    unit: "pct" | "usd"
  ) => (
    <div className="min-w-0 space-y-1">
      <Label>{title}</Label>
      <TimeChart
        data={points.map((p) => ({ at: p.at, value: p[key] }))}
        label={title}
        unit={unit}
      />
    </div>
  );
  return (
    <Card>
      <CardHead
        eyebrow="Position history"
        title="Last 7 days, hourly average"
      />
      {!data.history.ok ? (
        <Unavailable error={data.history.error} what="Position history" />
      ) : points.length < 2 ? (
        <p className="text-sm text-muted-foreground">
          Not enough snapshots in the last 7 days.
        </p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {chart("Equity", "equityUsd", "usd")}
          {chart("LTV", "ltvPct", "pct")}
        </div>
      )}
    </Card>
  );
}

function moveLabel(move: { action: string; reason: string | null }) {
  if (move.action === "OPEN_ROUTE_STEP") {
    if (move.reason === "leverage_up") return "Borrowed on Kamino";
    if (move.reason?.includes("redeposit"))
      return "Deposited collateral on Kamino";
  }
  return ACTION_WORDS[move.action] ?? words(move.action);
}

function MoneyMoves({ data }: { data: BackyardData }) {
  return (
    <Card>
      <CardHead
        eyebrow="Money moves"
        title="Last 30 worker steps that reached the chain, newest first"
      />
      {!data.moves.ok ? (
        <Unavailable error={data.moves.error} what="Money moves" />
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <Th>Time</Th>
              <Th>What it did</Th>
              <Th right>Amount</Th>
              <Th>Status</Th>
              <Th>Transaction</Th>
            </tr>
          </thead>
          <tbody>
            {data.moves.value.length ? (
              data.moves.value.map((move, index) => (
                <tr key={`${move.at}-${index}`}>
                  <Td className="whitespace-nowrap">{dateTime(move.at)}</Td>
                  <Td>
                    <p>{moveLabel(move)}</p>
                    <p className="max-w-[28rem] truncate text-xs text-muted-foreground">
                      {[move.strategyKey, words(move.reason)]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </Td>
                  <Td right>
                    {move.amountRaw && Number(move.amountRaw) > 0
                      ? (Number(move.amountRaw) / 1e6).toLocaleString("en-US", {
                          maximumFractionDigits: 2,
                        })
                      : "—"}
                  </Td>
                  <Td>
                    <Pill tone={move.status === "failed" ? "bad" : "neutral"}>
                      {words(move.status)}
                    </Pill>
                  </Td>
                  <Td>
                    {move.signature ? (
                      <Address address={move.signature} kind="tx" />
                    ) : (
                      "—"
                    )}
                  </Td>
                </tr>
              ))
            ) : (
              <tr>
                <Td className="text-muted-foreground">
                  No money moves recorded yet.
                </Td>
              </tr>
            )}
          </tbody>
        </TableWrap>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Amounts are in the step&apos;s input token (6 decimals). Hold decisions
        and NAV reports are left out.
        {data.health.ok
          ? ` ${data.health.value.refusedBeforeSending} steps refused by the worker's own checks before sending in the last 24 h.`
          : ""}
      </p>
    </Card>
  );
}
