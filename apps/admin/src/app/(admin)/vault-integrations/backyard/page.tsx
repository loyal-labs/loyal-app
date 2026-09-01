import {
  AddressLink,
  ShortAddressText,
} from "@/components/blockchain/address-link";
import { PageContainer } from "@/components/layout/page-container";
import { SectionHeader } from "@/components/layout/section-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireAdminSession } from "@/lib/require-admin-session";

import { getBackyardVaultData } from "./backyard-vault-data";

export const dynamic = "force-dynamic";

function formatUsdMicros(value: bigint | null) {
  if (value === null) return "—";
  const cents = (value + BigInt(5_000)) / BigInt(10_000);
  const whole = cents / BigInt(100);
  return `$${whole.toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",")}.${(
    cents % BigInt(100)
  )
    .toString()
    .padStart(2, "0")}`;
}

function formatBps(value: bigint | null) {
  if (value === null) return "—";
  return `${(Number(value) / 100).toFixed(2)}%`;
}

function formatRaw(value: bigint | null) {
  if (value === null) return "Unavailable";
  const whole = value / BigInt(1_000_000);
  const fraction = ((value % BigInt(1_000_000)) / BigInt(10_000))
    .toString()
    .padStart(2, "0");
  return `${whole
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function actionKind(action: string) {
  if (action.includes("ALLOCATE") || action.includes("OPEN"))
    return "Deposit / deploy";
  if (
    action.includes("DELEVER") ||
    action.includes("STAGE") ||
    action.includes("RESTORE")
  )
    return "Withdrawal / restore";
  return action.replaceAll("_", " ");
}

export default async function BackyardVaultPage() {
  await requireAdminSession();
  const data = await getBackyardVaultData();

  return (
    <PageContainer className="max-w-6xl space-y-6">
      <SectionHeader
        breadcrumbs={[{ label: "Vault integrations" }, { label: "Backyard" }]}
        subtitle="Read-only view of the Voltr vault, its bound Squads smart account, and the Backyard RWA worker projection."
        title="Backyard vault"
      />

      {!data.available ? (
        <Card>
          <CardHeader>
            <Badge variant="outline">Awaiting projection</Badge>
            <CardTitle className="text-base">No live vault snapshot</CardTitle>
            <CardDescription>{formatDate(data.observedAt)} UTC</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {data.error}
          </CardContent>
        </Card>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-3">
            <Metric
              title="Current AUM"
              value={formatUsdMicros(data.aumUsdMicros)}
              description="Latest worker valuation"
            />
            <Metric
              title="Reported NAV"
              value={formatUsdMicros(data.navUsdMicros)}
              description={`Observed ${formatDate(data.observedAt)} UTC`}
            />
            <Metric
              title="Forecast APY"
              value={formatBps(data.projectedApyBps)}
              description="Latest route snapshot; not a promise"
            />
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardDescription>Current route position</CardDescription>
                <CardTitle className="text-base">
                  {data.currentPosition.strategy ?? "No funded position"}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Collateral</p>
                  <p className="font-medium tabular-nums">
                    {formatRaw(data.currentPosition.collateralRaw)} PRIME
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Debt</p>
                  <p className="font-medium tabular-nums">
                    {formatRaw(data.currentPosition.debtRaw)} USDC
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">LTV</p>
                  <p className="font-medium tabular-nums">
                    {formatBps(data.currentPosition.ltvBps)}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Bound accounts</CardDescription>
                <CardTitle className="text-base">Voltr + Squads</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {data.settings.slice(0, 5).map((setting) => (
                  <p key={setting.key} className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{setting.key}</span>
                    <AddressLink address={setting.value} />
                  </p>
                ))}
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            <Metric
              title="Voltr idle"
              value={`${formatRaw(data.voltrIdleRaw)} USDC`}
              description="Strategy idle balance projected by worker"
            />
            <Metric
              title="Squads idle"
              value={`${formatRaw(data.squadsIdleRaw)} USDC`}
              description="Smart-account idle balance projected by worker"
            />
            <Metric
              title="Withdrawal wait"
              value={`${data.withdrawalWaitSeconds}s`}
              description={`Vault cap ${formatRaw(data.vaultCapRaw)} USDC`}
            />
          </section>

          <Card>
            <CardHeader>
              <CardDescription>Route and NAV report</CardDescription>
              <CardTitle className="text-base">
                {data.routeStatus ?? "Route status unavailable"}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              <span>
                Report slot:{" "}
                {data.report.slot?.toLocaleString("en-US") ?? "Unavailable"}
              </span>
              <span>
                Report time:{" "}
                {data.report.observedAt
                  ? `${formatDate(data.report.observedAt)} UTC`
                  : "Unavailable"}
              </span>
              <span>
                Freshness:{" "}
                {data.report.fresh === null
                  ? "Unavailable"
                  : data.report.fresh
                  ? "Fresh"
                  : "Stale"}
              </span>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription>Vault settings</CardDescription>
              <CardTitle className="text-base">
                Configuration observed by the worker
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm md:grid-cols-2">
              {data.settings.slice(5).length ? (
                data.settings.slice(5).map((setting) => (
                  <p
                    key={setting.key}
                    className="flex justify-between gap-4 rounded border p-2"
                  >
                    <span className="text-muted-foreground">{setting.key}</span>
                    <span className="font-mono text-xs">{setting.value}</span>
                  </p>
                ))
              ) : (
                <p className="text-muted-foreground">
                  Fee and admin settings are unavailable until projected by the
                  worker.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription>Recent worker journal</CardDescription>
              <CardTitle className="text-base">
                Capital decisions and execution steps
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Transaction</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.history.length ? (
                    data.history.map((item, index) => (
                      <TableRow key={`${item.created_at}-${index}`}>
                        <TableCell>
                          {formatDate(String(item.created_at))} UTC
                        </TableCell>
                        <TableCell>{actionKind(item.action)}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              item.status === "reconciled"
                                ? "outline"
                                : "secondary"
                            }
                          >
                            {item.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {item.amount_raw
                            ? formatRaw(BigInt(item.amount_raw))
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {item.transaction_signature ? (
                            <ShortAddressText
                              address={item.transaction_signature}
                            />
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground">
                        No worker decisions or execution steps recorded yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </PageContainer>
  );
}

function Metric({
  description,
  title,
  value,
}: {
  description: string;
  title: string;
  value: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{description}</CardDescription>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums tracking-tight">
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
