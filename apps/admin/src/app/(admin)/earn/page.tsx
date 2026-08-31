import { Suspense } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { SectionHeader } from "@/components/layout/section-header";
import { requireAdminSession } from "@/lib/require-admin-session";

import {
  EarnProgressiveClient,
  MonitoringSkeleton,
} from "./earn-progressive-client";
import { getAdminEarnSnapshot } from "./earn-snapshot";
import { getEarnStablecoinMonitoring } from "./earn-stablecoin-monitoring";

export const dynamic = "force-dynamic";

type EarnPageSearchParams = {
  mint?: string | string[];
  positionDirection?: string | string[];
  positionSort?: string | string[];
};

function getSearchParamValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function serialize(value: unknown) {
  return JSON.parse(
    JSON.stringify(value, (_key, nestedValue: unknown) =>
      typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue
    )
  );
}

async function EarnMonitoringSection({
  searchParams,
}: {
  searchParams?: Promise<EarnPageSearchParams>;
}) {
  const resolvedSearchParams = await (searchParams ??
    Promise.resolve(undefined));
  const positionDirection = getSearchParamValue(
    resolvedSearchParams?.positionDirection
  );
  const positionSort = getSearchParamValue(resolvedSearchParams?.positionSort);
  const selectedMint = getSearchParamValue(resolvedSearchParams?.mint);

  try {
    const [{ data, rows }, snapshot] = await Promise.all([
      getEarnStablecoinMonitoring(),
      getAdminEarnSnapshot(),
    ]);
    return (
      <EarnProgressiveClient
        initialMonitoring={{
          data: serialize(data),
          rows: serialize(rows),
          snapshot: serialize(snapshot),
        }}
        key={`${selectedMint ?? "all"}:${positionSort ?? "normalized"}:${
          positionDirection ?? "desc"
        }`}
        positionDirection={positionDirection}
        positionSort={positionSort}
        selectedMint={selectedMint}
      />
    );
  } catch (error) {
    console.error("[admin/earn] Monitoring section failed to load", {
      errorMessage: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return (
      <EarnProgressiveClient
        initialMonitoringError
        positionDirection={positionDirection}
        positionSort={positionSort}
        selectedMint={selectedMint}
      />
    );
  }
}

export default async function EarnPage({
  searchParams,
}: {
  searchParams?: Promise<EarnPageSearchParams>;
}) {
  await requireAdminSession();

  return (
    <PageContainer>
      <SectionHeader
        breadcrumbs={[{ label: "Earn" }]}
        subtitle="Internal Yield Neon monitoring for Earn positions and autodeposit health"
        title="Earn"
      />
      <div data-progressive-page="/earn">
        <Suspense
          fallback={
            <section
              data-progressive-section="earn-monitoring"
              data-progressive-state="loading"
            >
              <MonitoringSkeleton />
            </section>
          }
        >
          <EarnMonitoringSection searchParams={searchParams} />
        </Suspense>
      </div>
    </PageContainer>
  );
}
