"use client";

import { useCallback, useEffect, useState } from "react";

/** Requests are cancelled and hidden immediately when their wallet key changes. */
export function useVaultRead<T>(url: string | null, refreshKey = 0) {
  const [revision, setRevision] = useState(0);
  const [lastSuccess, setLastSuccess] = useState<{ key: string; at: string } | null>(null);
  const [result, setResult] = useState<{
    key: string;
    data: T | null;
    error: string | null;
    loading: boolean;
  } | null>(null);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    async function refresh() {
      if (busy || controller.signal.aborted || document.hidden) return;
      busy = true;
      let delay = 5_000;
      try {
        const response = await fetch(url!, {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        });
        if (!response.headers.get("content-type")?.includes("application/json")) {
          throw new Error("The data service is temporarily unavailable. Please retry.");
        }
        const data = await response.json();
        if (!response.ok || data.unavailable === true)
          throw new Error(
            typeof data.reason === "string"
              ? data.reason
              : "Vault data is temporarily unavailable."
          );
        if (!controller.signal.aborted) {
          setResult({ key: url!, data, error: null, loading: false });
          setLastSuccess({ key: url!, at: new Date().toISOString() });
        }
      } catch (error) {
        delay = 30_000;
        if (!controller.signal.aborted)
          setResult({
            key: url!,
            data: null,
            error:
              error instanceof Error
                ? error.message
                : "Unable to refresh vault data.",
            loading: false,
          });
      } finally {
        busy = false;
        if (!controller.signal.aborted && !document.hidden)
          timer = setTimeout(refresh, delay);
      }
    }
    const onVisibility = () => {
      clearTimeout(timer);
      if (!document.hidden) void refresh();
    };
    setResult({ key: url, data: null, error: null, loading: true });
    void refresh();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [url, revision, refreshKey]);
  const current = result?.key === url ? result : null;
  return {
    data: current?.data ?? null,
    lastSuccessAt: lastSuccess?.key === url ? lastSuccess.at : null,
    error: current?.error ?? null,
    loading: !!url && (current?.loading ?? true),
    refresh: useCallback(() => setRevision((value) => value + 1), []),
  };
}

export function formatUnits(
  raw: string,
  decimals: number,
  precision = 6
): string {
  if (
    !/^\d+$/.test(raw) ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 24
  )
    return "Unavailable";
  const value = BigInt(raw),
    scale = 10n ** BigInt(decimals);
  const digits = Math.min(decimals, precision);
  const fraction = (value % scale)
    .toString()
    .padStart(decimals, "0")
    .slice(0, digits)
    .replace(/0+$/, "");
  if (value > 0n && value / scale === 0n && !fraction)
    return `<0.${"0".repeat(Math.max(0, digits - 1))}1`;
  return (
    (value / scale).toLocaleString("en-US") + (fraction ? `.${fraction}` : "")
  );
}
export const shortAddress = (address: string) =>
  `${address.slice(0, 5)}…${address.slice(-5)}`;
