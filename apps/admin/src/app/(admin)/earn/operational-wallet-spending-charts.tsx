"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Label,
  Line,
  LineChart,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { formatShortAddress } from "@/components/blockchain/address-link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";

import type {
  EarnFundingWallet,
  OperationalWalletSpendEvent,
  OperationalWalletSpendGroup,
} from "./earn-funding-data";

const DAY_MS = 24 * 60 * 60 * 1_000;

const GROUP_LABELS: Record<OperationalWalletSpendGroup, string> = {
  gasless_store: "Gasless store",
  gasless_top_up_to_0_01_sol: "Gasless top-up",
  gasless_verify_telegram_init_data: "Gasless verification",
  lookup_table_close: "Lookup close",
  lookup_table_create: "Lookup create",
  lookup_table_deactivate: "Lookup deactivate",
  lookup_table_extend: "Lookup extend",
  lookup_table_rollover: "Lookup rollover",
  lookup_table_verify: "Lookup verify",
  smart_account_sponsorship: "Smart-account sponsorship",
  yield_route_fee: "Yield route fee",
};

const GROUP_ORDER = Object.keys(GROUP_LABELS) as OperationalWalletSpendGroup[];

const LINE_STYLES = [
  { dash: undefined, opacity: 1 },
  { dash: "7 4", opacity: 0.82 },
  { dash: "2 4", opacity: 0.68 },
] as const;

type ScatterPoint = OperationalWalletSpendEvent & {
  groupIndex: number;
  lamportsNumber: number;
  occurredAtMs: number;
};

type DailySpendPoint = Record<string, number> & { occurredAtMs: number };

type WalletScatterData = {
  groups: OperationalWalletSpendGroup[];
  points: ScatterPoint[];
};

type TooltipPayload<T> = Array<{
  dataKey?: string | number;
  payload?: T;
  value?: number;
}>;

function getWalletTitle(wallet: EarnFundingWallet) {
  if (wallet.roles.length === 1) {
    return wallet.roles[0].label;
  }

  if (
    wallet.roles.some((role) => role.key === "policy") &&
    wallet.roles.some((role) => role.key === "deployment")
  ) {
    return "Policy + deployment wallet";
  }

  return wallet.roles.map((role) => role.label).join(" + ");
}

function formatUtcDate(value: number | string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

function formatUtcTimestamp(value: number | string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    timeZoneName: "short",
    year: "numeric",
  }).format(date);
}

function formatSol(lamports: string) {
  const amount = BigInt(lamports);
  const whole = amount / BigInt(1_000_000_000);
  const fraction = (amount % BigInt(1_000_000_000))
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "");

  return whole.toLocaleString("en-US") + "." + (fraction || "0") + " SOL";
}

function SpendEventTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload<ScatterPoint>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }

  return (
    <div className="grid min-w-[17rem] gap-1 rounded-lg border border-border/70 bg-background px-3 py-2 text-xs shadow-xl">
      <div className="font-medium">
        {formatUtcTimestamp(point.occurredAtMs)}
      </div>
      <div className="text-muted-foreground">{GROUP_LABELS[point.group]}</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pt-1">
        <dt className="text-muted-foreground">Spent</dt>
        <dd className="text-right font-medium tabular-nums">
          {formatSol(point.lamports)}
        </dd>
        <dt className="text-muted-foreground">Lamports</dt>
        <dd className="text-right font-mono tabular-nums">
          {BigInt(point.lamports).toLocaleString("en-US")}
        </dd>
        <dt className="text-muted-foreground">Amount basis</dt>
        <dd className="text-right">
          {point.amountBasis === "compiled_fee"
            ? "Confirmed compiled fee"
            : "Confirmed payer outflow"}
        </dd>
        {point.signature ? (
          <>
            <dt className="text-muted-foreground">Signature</dt>
            <dd className="text-right font-mono">
              {formatShortAddress(point.signature)}
            </dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

function DailySpendTooltip({
  active,
  payload,
  wallets,
}: {
  active?: boolean;
  payload?: TooltipPayload<DailySpendPoint>;
  wallets: EarnFundingWallet[];
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }

  return (
    <div className="grid min-w-[17rem] gap-1.5 rounded-lg border border-border/70 bg-background px-3 py-2 text-xs shadow-xl">
      <div className="font-medium">{formatUtcDate(point.occurredAtMs)} UTC</div>
      <div className="grid gap-1">
        {wallets.map((wallet, index) => (
          <div
            className="flex items-center justify-between gap-4"
            key={wallet.address}
          >
            <span className="text-muted-foreground">
              {getWalletTitle(wallet)}
            </span>
            <span className="font-mono font-medium tabular-nums">
              {(point["wallet_" + index] ?? 0).toLocaleString("en-US", {
                maximumFractionDigits: 6,
              })}{" "}
              SOL
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildDailySpendPoints(args: {
  endedAtMs: number;
  events: OperationalWalletSpendEvent[];
  startedAtMs: number;
  wallets: EarnFundingWallet[];
}) {
  const start = new Date(args.startedAtMs);
  const end = new Date(args.endedAtMs);
  const firstDay = Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate()
  );
  const lastDay = Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate()
  );
  const lamportsByDay = new Map<number, Map<string, bigint>>();

  for (const event of args.events) {
    const occurredAt = new Date(event.occurredAt);
    const day = Date.UTC(
      occurredAt.getUTCFullYear(),
      occurredAt.getUTCMonth(),
      occurredAt.getUTCDate()
    );
    const walletTotals = lamportsByDay.get(day) ?? new Map<string, bigint>();
    walletTotals.set(
      event.address,
      (walletTotals.get(event.address) ?? BigInt(0)) + BigInt(event.lamports)
    );
    lamportsByDay.set(day, walletTotals);
  }

  const points: DailySpendPoint[] = [];
  for (let day = firstDay; day <= lastDay; day += DAY_MS) {
    const walletTotals = lamportsByDay.get(day);
    const point: DailySpendPoint = { occurredAtMs: day };
    args.wallets.forEach((wallet, index) => {
      point["wallet_" + index] =
        Number(walletTotals?.get(wallet.address) ?? BigInt(0)) / 1_000_000_000;
    });
    points.push(point);
  }

  return points;
}

export function OperationalWalletSpendingCharts({
  events,
  sourceErrors,
  wallets,
  window,
}: {
  events: OperationalWalletSpendEvent[];
  sourceErrors: string[];
  wallets: EarnFundingWallet[];
  window: { endedAt: string; startedAt: string };
}) {
  const primaryWallets = useMemo(
    () =>
      wallets.filter((wallet) =>
        wallet.roles.some((role) => role.key !== "route_fee_payer")
      ),
    [wallets]
  );
  const startedAtMs = Date.parse(window.startedAt);
  const endedAtMs = Date.parse(window.endedAt);
  const visibleEvents = useMemo(() => {
    const primaryAddresses = new Set(
      primaryWallets.map((wallet) => wallet.address)
    );
    return events.filter((event) => primaryAddresses.has(event.address));
  }, [events, primaryWallets]);
  const trackedWallets = useMemo(
    () =>
      primaryWallets.filter((wallet) =>
        wallet.roles.some((role) => role.key !== "settings_authority")
      ),
    [primaryWallets]
  );
  const scatterByWallet = useMemo(() => {
    const eventsByWallet = new Map<string, OperationalWalletSpendEvent[]>();
    for (const event of visibleEvents) {
      const walletEvents = eventsByWallet.get(event.address) ?? [];
      walletEvents.push(event);
      eventsByWallet.set(event.address, walletEvents);
    }

    return new Map<string, WalletScatterData>(
      primaryWallets.map((wallet) => {
        const walletEvents = eventsByWallet.get(wallet.address) ?? [];
        const groups = GROUP_ORDER.filter((group) =>
          walletEvents.some((event) => event.group === group)
        );
        const groupIndex = new Map(
          groups.map((group, index) => [group, index])
        );
        const points = walletEvents
          .map((event) => ({
            ...event,
            groupIndex: groupIndex.get(event.group) ?? -1,
            lamportsNumber: Number(event.lamports),
            occurredAtMs: Date.parse(event.occurredAt),
          }))
          .filter(
            (event) =>
              event.groupIndex >= 0 &&
              Number.isFinite(event.lamportsNumber) &&
              Number.isFinite(event.occurredAtMs)
          );

        return [wallet.address, { groups, points }];
      })
    );
  }, [primaryWallets, visibleEvents]);
  const dailySpendPoints = useMemo(
    () =>
      buildDailySpendPoints({
        endedAtMs,
        events: visibleEvents,
        startedAtMs,
        wallets: trackedWallets,
      }),
    [endedAtMs, startedAtMs, trackedWallets, visibleEvents]
  );
  const lineConfig = Object.fromEntries(
    trackedWallets.map((wallet, index) => [
      "wallet_" + index,
      { color: "var(--foreground)", label: getWalletTitle(wallet) },
    ])
  ) satisfies ChartConfig;
  const scatterConfig = {
    spend: { color: "var(--foreground)", label: "Transaction spend" },
  } satisfies ChartConfig;
  const startLabel = formatUtcDate(startedAtMs);

  if (sourceErrors.length > 0) {
    return (
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Operational wallet spending</CardTitle>
          <CardDescription>
            Transaction history is unavailable because at least one required App
            or Yield spend source could not be read. No partial totals are
            plotted.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card
        aria-labelledby="operational-wallet-transactions-title"
        className="min-w-0"
      >
        <CardHeader>
          <CardTitle id="operational-wallet-transactions-title">
            Operational wallet transactions
          </CardTitle>
          <CardDescription>
            One dot per recorded transaction since {startLabel}; dot area is
            proportional to lamports spent. App and lookup-table rows use
            confirmed payer outflow; route rows use confirmed compiled fees.
          </CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 space-y-6">
          {primaryWallets.map((wallet) => {
            const walletScatter = scatterByWallet.get(wallet.address);
            const walletGroups = walletScatter?.groups ?? [];
            const walletPoints = walletScatter?.points ?? [];
            const isUntrackedSettingsAuthority = wallet.roles.some(
              (role) => role.key === "settings_authority"
            );

            return (
              <section className="min-w-0 space-y-2" key={wallet.address}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
                  <div>
                    <h3 className="text-sm font-medium">
                      {getWalletTitle(wallet)}
                    </h3>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {formatShortAddress(wallet.address)}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {walletPoints.length.toLocaleString("en-US")} transactions
                  </p>
                </div>
                {walletPoints.length === 0 || walletGroups.length === 0 ? (
                  <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                    {isUntrackedSettingsAuthority
                      ? "No App/Yield spend table tracks this settings authority yet; zero rows does not mean zero on-chain fees."
                      : "No recorded spending since " + startLabel + "."}
                  </div>
                ) : (
                  <ChartContainer
                    className="aspect-auto w-full min-w-0"
                    config={scatterConfig}
                    style={{ height: Math.max(180, walletGroups.length * 42) }}
                  >
                    <ScatterChart
                      accessibilityLayer
                      margin={{ bottom: 24, left: 8, right: 16, top: 10 }}
                    >
                      <CartesianGrid />
                      <XAxis
                        axisLine={false}
                        dataKey="occurredAtMs"
                        domain={[startedAtMs, endedAtMs]}
                        minTickGap={40}
                        tickFormatter={formatUtcDate}
                        tickLine={false}
                        tickMargin={8}
                        type="number"
                      >
                        <Label
                          offset={-16}
                          position="insideBottom"
                          value="Time (UTC)"
                        />
                      </XAxis>
                      <YAxis
                        allowDecimals={false}
                        axisLine={false}
                        dataKey="groupIndex"
                        domain={[
                          -0.5,
                          Math.max(walletGroups.length - 0.5, 0.5),
                        ]}
                        tickFormatter={(value: number) =>
                          GROUP_LABELS[walletGroups[value]] ?? ""
                        }
                        tickLine={false}
                        ticks={walletGroups.map((_, index) => index)}
                        type="number"
                        width={116}
                      />
                      <ZAxis
                        dataKey="lamportsNumber"
                        domain={["dataMin", "dataMax"]}
                        range={[20, 240]}
                      />
                      <ChartTooltip
                        content={<SpendEventTooltip />}
                        cursor={{ strokeDasharray: "3 3" }}
                      />
                      <Scatter
                        data={walletPoints}
                        fill="var(--color-spend)"
                        fillOpacity={0.72}
                        name="Transaction spend"
                      />
                    </ScatterChart>
                  </ChartContainer>
                )}
              </section>
            );
          })}
        </CardContent>
      </Card>

      <Card
        aria-labelledby="daily-operational-wallet-spending-title"
        className="min-w-0"
      >
        <CardHeader className="gap-3">
          <div>
            <CardTitle id="daily-operational-wallet-spending-title">
              Daily operational wallet spending
            </CardTitle>
            <CardDescription>
              Overlapping UTC daily totals since {startLabel}. A zero is shown
              only because every required spend source loaded successfully.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            {trackedWallets.map((wallet, index) => {
              const style = LINE_STYLES[index % LINE_STYLES.length];
              return (
                <span
                  className="inline-flex items-center gap-1.5"
                  key={wallet.address}
                >
                  <svg aria-hidden className="h-2 w-5" viewBox="0 0 20 8">
                    <line
                      stroke="currentColor"
                      strokeDasharray={style.dash}
                      strokeOpacity={style.opacity}
                      strokeWidth="2"
                      x1="0"
                      x2="20"
                      y1="4"
                      y2="4"
                    />
                  </svg>
                  {getWalletTitle(wallet)}
                </span>
              );
            })}
            {primaryWallets.some((wallet) =>
              wallet.roles.some((role) => role.key === "settings_authority")
            ) ? (
              <span>Settings authority excluded: no spend table coverage</span>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="min-w-0">
          {visibleEvents.length === 0 ? (
            <div className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
              No recorded operational-wallet spending since {startLabel}.
            </div>
          ) : (
            <ChartContainer
              className="aspect-auto h-[320px] w-full min-w-0"
              config={lineConfig}
            >
              <LineChart
                accessibilityLayer
                data={dailySpendPoints}
                margin={{ bottom: 24, left: 8, right: 20, top: 10 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  axisLine={false}
                  dataKey="occurredAtMs"
                  domain={[startedAtMs, endedAtMs]}
                  minTickGap={40}
                  scale="time"
                  tickFormatter={formatUtcDate}
                  tickLine={false}
                  tickMargin={8}
                  type="number"
                >
                  <Label
                    offset={-16}
                    position="insideBottom"
                    value="Time (UTC)"
                  />
                </XAxis>
                <YAxis
                  axisLine={false}
                  domain={[0, "auto"]}
                  tickFormatter={(value: number) =>
                    value.toLocaleString("en-US", {
                      maximumFractionDigits: 4,
                    })
                  }
                  tickLine={false}
                  width={62}
                >
                  <Label
                    angle={-90}
                    position="insideLeft"
                    style={{ textAnchor: "middle" }}
                    value="SOL / day"
                  />
                </YAxis>
                <ChartTooltip
                  content={<DailySpendTooltip wallets={trackedWallets} />}
                />
                {trackedWallets.map((wallet, index) => {
                  const style = LINE_STYLES[index % LINE_STYLES.length];
                  return (
                    <Line
                      connectNulls
                      dataKey={"wallet_" + index}
                      dot={false}
                      key={wallet.address}
                      name={getWalletTitle(wallet)}
                      stroke={"var(--color-wallet_" + index + ")"}
                      strokeDasharray={style.dash}
                      strokeOpacity={style.opacity}
                      strokeWidth={2}
                      type="linear"
                    />
                  );
                })}
              </LineChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
