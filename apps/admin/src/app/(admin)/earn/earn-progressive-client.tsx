"use client";

import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

import type { EarnData } from "./earn-data";
import type { EarnFundingData } from "./earn-funding-data";
import type { EarnStablecoinHealthRow } from "./earn-stablecoin-monitoring";
import type { AdminEarnSnapshot } from "./earn-snapshot";
import {
  EarnDetailsContent,
  EarnSnapshotStats,
} from "./earn-progressive-content";
import {
  getEarnStablecoinBySymbol,
  type EarnStablecoinSymbol,
} from "@/lib/earn/stablecoin-monitor.shared";

type ProgressiveState = "loading" | "ready" | "error";

function revive(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((item) => revive(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        revive(childValue, childKey),
      ])
    );
  }
  return typeof value === "string" && key.endsWith("Raw")
    ? BigInt(value)
    : value;
}

export function MonitoringSkeleton() {
  return (
    <div className="min-h-[4200px] space-y-6" aria-hidden="true">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton className="h-[116px]" key={index} />
        ))}
      </div>
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-[260px] w-full" />
      <Skeleton className="h-[1000px] w-full" />
      <Skeleton className="h-[2200px] w-full" />
      <Skeleton className="h-[800px] w-full" />
    </div>
  );
}

export function EarnProgressiveClient({
  initialMonitoring,
  initialMonitoringError = false,
  positionDirection,
  positionSort,
  selectedMint: selectedMintParam,
}: {
  initialMonitoring?: { data: unknown; rows: unknown; snapshot: unknown };
  initialMonitoringError?: boolean;
  positionDirection?: string;
  positionSort?: string;
  selectedMint?: string;
}) {
  const [monitoring, setMonitoring] = useState<{
    data: EarnData;
    rows: EarnStablecoinHealthRow[];
    snapshot: AdminEarnSnapshot | null;
  } | null>(() =>
    initialMonitoring
      ? {
          data: revive(initialMonitoring.data) as EarnData,
          rows: revive(initialMonitoring.rows) as EarnStablecoinHealthRow[],
          snapshot: revive(
            initialMonitoring.snapshot
          ) as AdminEarnSnapshot | null,
        }
      : null
  );
  const [funding, setFunding] = useState<EarnFundingData | null>(null);
  const [monitoringState, setMonitoringState] = useState<ProgressiveState>(
    initialMonitoring ? "ready" : initialMonitoringError ? "error" : "loading"
  );
  const [fundingState, setFundingState] = useState<ProgressiveState>("loading");
  const [activityState, setActivityState] =
    useState<ProgressiveState>("loading");
  const [positionsState, setPositionsState] =
    useState<ProgressiveState>("loading");
  const fundingRequested = useRef(false);
  const fundingRef = useRef<HTMLDivElement>(null);
  const activityRef = useRef<HTMLDivElement>(null);
  const positionsRef = useRef<HTMLDivElement>(null);
  const selectedMint = getEarnStablecoinBySymbol(selectedMintParam ?? "")
    ? (selectedMintParam as EarnStablecoinSymbol)
    : null;

  useEffect(() => {
    if (initialMonitoring || initialMonitoringError) {
      return;
    }
    const query = new URLSearchParams();
    if (selectedMint) query.set("mint", selectedMint);
    if (positionSort) query.set("positionSort", positionSort);
    if (positionDirection) query.set("positionDirection", positionDirection);
    fetch(
      `/api/earn/progressive?section=monitoring${
        query.toString() ? `&${query}` : ""
      }`
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("monitoring request failed");
        return response.json();
      })
      .then((payload: { data: unknown; rows: unknown; snapshot: unknown }) => {
        setMonitoring({
          data: revive(payload.data) as EarnData,
          rows: revive(payload.rows) as EarnStablecoinHealthRow[],
          snapshot: revive(payload.snapshot) as AdminEarnSnapshot | null,
        });
        setMonitoringState("ready");
      })
      .catch(() => setMonitoringState("error"));
  }, [
    initialMonitoring,
    initialMonitoringError,
    positionDirection,
    positionSort,
    selectedMint,
  ]);

  useEffect(() => {
    if (monitoringState !== "ready") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const section = entry.target.getAttribute("data-progressive-section");
          if (section === "earn-activity") setActivityState("ready");
          if (section === "earn-positions") setPositionsState("ready");
          if (section === "earn-funding" && !fundingRequested.current) {
            fundingRequested.current = true;
            fetch("/api/earn/progressive?section=funding")
              .then(async (response) => {
                if (!response.ok) throw new Error("funding request failed");
                return response.json();
              })
              .then((payload: { data: unknown }) => {
                setFunding(revive(payload.data) as EarnFundingData);
                setFundingState("ready");
              })
              .catch(() => setFundingState("error"));
          }
        }
      },
      { rootMargin: "160px 0px" }
    );
    [fundingRef.current, activityRef.current, positionsRef.current].forEach(
      (section) => section && observer.observe(section)
    );
    return () => observer.disconnect();
  }, [monitoringState]);

  if (monitoringState === "error") {
    return (
      <section
        data-progressive-section="earn-monitoring"
        data-progressive-state="error"
      >
        <div className="rounded-md border border-destructive/40 px-3 py-4 text-sm text-destructive">
          Monitoring data could not be loaded. Refresh to try again.
        </div>
      </section>
    );
  }

  return (
    <section
      className="min-h-[4200px] space-y-6"
      data-progressive-section="earn-monitoring"
      data-progressive-state={monitoringState}
    >
      {monitoringState === "loading" ? (
        <MonitoringSkeleton />
      ) : monitoring ? (
        <>
          <EarnSnapshotStats snapshot={monitoring.snapshot} />
          <EarnDetailsContent
            activityReady={activityState === "ready"}
            activityRef={activityRef}
            data={monitoring.data}
            fundingData={fundingState === "ready" ? funding : null}
            fundingRef={fundingRef}
            positionSort={
              positionSort === "idle" ||
              positionSort === "normalized" ||
              positionSort === "observed" ||
              positionSort === "pointerDelta" ||
              positionSort === "principal" ||
              positionSort === "reserve" ||
              positionSort === "warnings"
                ? {
                    key: positionSort,
                    direction: positionDirection === "asc" ? "asc" : "desc",
                  }
                : { key: "normalized", direction: "desc" }
            }
            positionsReady={positionsState === "ready"}
            positionsRef={positionsRef}
            selectedMint={selectedMint}
            stablecoinHealth={monitoring.rows}
          />
        </>
      ) : null}
    </section>
  );
}
