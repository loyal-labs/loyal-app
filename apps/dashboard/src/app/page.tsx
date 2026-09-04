import { ArrowUpRight } from "lucide-react";
import Image from "next/image";

import { EarnAumBarChart } from "@/components/earn-aum-bar-chart";
import { MetricHelpTooltip } from "@/components/metric-help-tooltip";
import { getPublicPerformanceSnapshot } from "@/lib/performance-snapshot";

export const dynamic = "force-dynamic";

export default async function DashboardHome() {
  const snapshot = await getPublicPerformanceSnapshot();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-7 px-6 py-8 lg:px-10">
          <header className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <Image
                alt=""
                aria-hidden="true"
                className="size-14 shrink-0"
                height={56}
                priority
                src="/app-icon.svg"
                width={56}
              />
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Loyal
                </p>
                <h1 className="text-3xl font-semibold tracking-normal">
                  Performance Dashboard
                </h1>
              </div>
            </div>
            <a
              className="inline-flex h-12 w-fit items-center justify-center gap-2 rounded-full bg-primary px-5 text-base font-medium leading-5 text-primary-foreground transition-[background,transform] duration-150 ease-out hover:-translate-y-0.5 hover:bg-[#e72f34] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:translate-y-0"
              href="https://askloyal.com/app"
              rel="noopener noreferrer"
              target="_blank"
            >
              Open app
              <ArrowUpRight aria-hidden="true" className="size-5" />
            </a>
          </header>

          <div className="grid gap-x-8 gap-y-6 border-t pt-7 md:grid-cols-3">
            {snapshot.metrics.map((metric) => (
              <div className="min-w-0 text-center" key={metric.label}>
                <div className="flex min-w-0 items-center justify-center gap-2">
                  <p className="min-w-0 text-sm font-medium text-muted-foreground">
                    {metric.label}
                  </p>
                  <MetricHelpTooltip
                    ariaLabel={`About ${metric.label}`}
                    tooltip={metric.tooltip}
                  />
                </div>
                <p className="mt-2 text-3xl font-semibold tracking-normal">
                  {metric.value}
                </p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {metric.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 py-12 lg:px-10">
        <div className="min-w-0">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold tracking-normal">
              Earn AUM by Week
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Weekly snapshot. Current AUM is shown above.
            </p>
          </div>
          <EarnAumBarChart
            ariaLabel="Earn AUM weekly snapshot bar chart from Jun 15 through the latest data"
            metricLabel="Earn AUM"
            points={snapshot.earnAumSeries}
          />
        </div>
      </section>
    </main>
  );
}
