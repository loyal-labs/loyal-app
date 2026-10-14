"use client";

import type { WalletContextState } from "@solana/wallet-adapter-react";
import { useEffect, useRef } from "react";
import { createBrowserLifecycleTracker } from "@/features/observability/client";
import type { LifecycleTracker } from "@/features/observability/lifecycle-contract";
import { classifyTransactionFailure } from "@/features/observability/transaction-failure";

type Attempt = {
  address: string;
  tracker: LifecycleTracker;
  timer: ReturnType<typeof setTimeout>;
  connecting: boolean;
  terminalKey?: string;
  succeeded?: boolean;
};

export function useSignerRestoration({
  address,
  enabled,
  adapter,
  wallets,
}: {
  address: string | null;
  enabled: boolean;
  adapter: WalletContextState;
  wallets: readonly { address: string; standardWallet: { name: string } }[];
}) {
  const attemptRef = useRef<Attempt | null>(null);
  const targetRef = useRef(address);
  targetRef.current = enabled ? address : null;
  useEffect(
    () => () => {
      if (attemptRef.current) clearTimeout(attemptRef.current.timer);
      attemptRef.current = null;
    },
    []
  );

  useEffect(() => {
    if (!enabled || !address) {
      if (attemptRef.current) clearTimeout(attemptRef.current.timer);
      attemptRef.current = null;
      return;
    }
    const owner = wallets.find((wallet) => wallet.address === address);
    const entry = owner
      ? adapter.wallets.find(
          (wallet) => wallet.adapter.name === owner.standardWallet.name
        )
      : undefined;
    const stateKey = JSON.stringify([
      adapter.wallet?.adapter.name,
      adapter.connected,
      adapter.publicKey?.toBase58(),
      entry?.adapter.name,
      entry?.adapter.connected,
      entry?.adapter.publicKey?.toBase58(),
    ]);
    let attempt = attemptRef.current;
    if (
      attempt?.address === address &&
      (attempt.terminalKey === stateKey ||
        (attempt.succeeded &&
          adapter.connected &&
          adapter.publicKey?.toBase58() === address))
    )
      return;
    if (
      !attempt ||
      attempt.address !== address ||
      attempt.terminalKey !== undefined
    ) {
      if (attempt) clearTimeout(attempt.timer);
      const tracker = createBrowserLifecycleTracker({
        flowName: "auth.signer_restore",
        flowVariant: "return",
      });
      tracker.start("intent");
      tracker.observe("backend_session_valid");
      attempt = {
        address,
        tracker,
        connecting: false,
        timer: setTimeout(
          () =>
            tracker.timeout("wallet_connect", {
              errorCode: "request_failed",
              errorDetail: "request_timeout",
            }),
          30_000
        ),
      };
      attemptRef.current = attempt;
    }
    const current = attempt;
    const finish = (
      errorCode?:
        | "wallet_unavailable"
        | "wallet_account_mismatch"
        | "wallet_connection_failed"
        | "wallet_rejected"
    ) => {
      if (
        attemptRef.current !== current ||
        targetRef.current !== address ||
        current.terminalKey !== undefined
      )
        return;
      clearTimeout(current.timer);
      current.connecting = false;
      current.terminalKey = stateKey;
      current.succeeded = !errorCode;
      if (errorCode === "wallet_rejected")
        current.tracker.cancel("wallet_connect", { errorCode });
      else if (errorCode) current.tracker.fail("wallet_connect", { errorCode });
      else current.tracker.complete("signer_ready");
    };
    if (adapter.connected && adapter.publicKey?.toBase58() === address) {
      finish();
      return;
    }
    if (adapter.connecting || current.connecting) return;
    if (!entry) {
      finish("wallet_unavailable");
      return;
    }
    if (adapter.wallet?.adapter.name !== entry.adapter.name) {
      current.tracker.observe("wallet_select");
      try {
        adapter.select(entry.adapter.name);
      } catch {
        finish("wallet_connection_failed");
      }
      return;
    }
    if (entry.adapter.connected) {
      finish("wallet_account_mismatch");
      return;
    }
    current.connecting = true;
    current.tracker.observe("wallet_connect");
    void adapter
      .connect()
      .then(() => {
        finish(
          entry.adapter.connected &&
            entry.adapter.publicKey?.toBase58() === address
            ? undefined
            : "wallet_account_mismatch"
        );
      })
      .catch((error: unknown) => {
        finish(
          classifyTransactionFailure(error) === "wallet_rejected"
            ? "wallet_rejected"
            : "wallet_connection_failed"
        );
      });
  }, [address, enabled, adapter, wallets]);
}
