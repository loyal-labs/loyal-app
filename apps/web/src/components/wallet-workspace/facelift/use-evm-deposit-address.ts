"use client";

import { useAuthorizationSignature, usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useRef, useState } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";

export type EvmDepositInfo = {
  address: string;
  chains: readonly string[];
  assets: readonly string[];
  minimums: Record<string, number>;
};

/**
 * Cross-chain deposit address for the signed-in user's Privy-embedded wallet.
 * `eligible` is false for external wallets (Loyal extension, Phantom…); the
 * address is fetched lazily on `load()` because Privy provisions it on first
 * call and we only want that when the user opens the tab.
 */
export function useEvmDepositAddress(walletAddress: string | null) {
  const { privyAppId } = usePublicEnv();
  const { user } = usePrivy();
  const { generateAuthorizationSignature } = useAuthorizationSignature();
  const [info, setInfo] = useState<EvmDepositInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const eligible =
    Boolean(privyAppId) &&
    Boolean(walletAddress) &&
    (user?.linkedAccounts.some(
      (a) =>
        a.type === "wallet" &&
        a.chainType === "solana" &&
        a.walletClientType === "privy" &&
        a.address === walletAddress
    ) ??
      false);

  useEffect(() => {
    setInfo(null);
    setError(null);
  }, [walletAddress]);

  const attemptedRef = useRef(false);
  useEffect(() => {
    attemptedRef.current = false;
  }, [walletAddress]);

  const load = useCallback(async () => {
    if (!eligible || info || loading || attemptedRef.current) return;
    attemptedRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const read = (await (
        await fetch("/api/funding/evm-deposit-address", {
          credentials: "include",
        })
      ).json()) as {
        address?: string | null;
        toSign?: unknown;
        requestExpiry?: number;
        chains?: readonly string[];
        assets?: readonly string[];
        minimums?: Record<string, number>;
        error?: { message?: string };
      };
      if (read.error) throw new Error(read.error.message ?? "Request failed.");
      if (read.address) {
        setInfo({
          address: read.address,
          chains: read.chains ?? [],
          assets: read.assets ?? [],
          minimums: read.minimums ?? {},
        });
        return;
      }
      // First time: the wallet is user-owned, so the user signs the exact
      // Privy request with their key and the server forwards the signature.
      const { signature } = await generateAuthorizationSignature(
        read.toSign as Parameters<typeof generateAuthorizationSignature>[0]
      );
      const res = await fetch("/api/funding/evm-deposit-address", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signature,
          requestExpiry: read.requestExpiry,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | (EvmDepositInfo & { error?: undefined })
        | { error?: { message?: string } }
        | null;
      if (!res.ok || !body || body.error || !("address" in body)) {
        throw new Error(
          body?.error?.message ??
            `Could not get a deposit address (${res.status}).`
        );
      }
      setInfo(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [eligible, generateAuthorizationSignature, info, loading]);

  return { eligible, info, error, loading, load };
}
