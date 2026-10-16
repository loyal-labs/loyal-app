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
  recoveredStaleAdapter?: boolean;
  terminalKey?: string;
  succeeded?: boolean;
  stateKey: string;
  waitingForWallet: boolean;
  interactive: boolean;
};

export function useSignerRestoration({
  address,
  enabled,
  adapter,
  wallets,
  lifecycle,
  onSettled,
}: {
  address: string | null;
  enabled: boolean;
  adapter: WalletContextState;
  wallets: readonly { address: string; standardWallet: { name: string } }[];
  lifecycle?: LifecycleTracker | null;
  onSettled?: () => void;
}) {
  const attemptRef = useRef<Attempt | null>(null);
  const targetRef = useRef(address);
  targetRef.current = enabled ? address : null;
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
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
      if (attemptRef.current?.interactive) onSettledRef.current?.();
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
      (!lifecycle || lifecycle === attempt.tracker) &&
      (attempt.terminalKey === stateKey ||
        (attempt.succeeded &&
          adapter.connected &&
          adapter.publicKey?.toBase58() === address))
    )
      return;
    if (
      !attempt ||
      attempt.address !== address ||
      (lifecycle && lifecycle !== attempt.tracker) ||
      attempt.terminalKey !== undefined
    ) {
      if (attempt) clearTimeout(attempt.timer);
      const tracker =
        lifecycle ??
        createBrowserLifecycleTracker({
          flowName: "auth.signer_restore",
          flowVariant: "return",
        });
      if (!lifecycle) {
        tracker.start("intent");
        tracker.observe("backend_session_valid");
      }
      attempt = {
        address,
        tracker,
        connecting: false,
        stateKey,
        waitingForWallet: !entry,
        interactive: !!lifecycle,
        timer: setTimeout(
          () => {
            const pending = attemptRef.current;
            if (
              !pending ||
              pending.tracker !== tracker ||
              targetRef.current !== address
            )
              return;
            if (pending.waitingForWallet) {
              pending.terminalKey = pending.stateKey;
              tracker.fail("wallet_connect", {
                errorCode: "wallet_unavailable",
              });
              if (pending.interactive) onSettledRef.current?.();
              return;
            }
            tracker.timeout("wallet_connect", {
              errorCode: "request_failed",
              errorDetail: "request_timeout",
            });
          },
          lifecycle ? 120_000 : 30_000
        ),
      };
      attemptRef.current = attempt;
    }
    const current = attempt;
    current.stateKey = stateKey;
    current.waitingForWallet = !entry;
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
      current.terminalKey = current.stateKey;
      current.succeeded = !errorCode;
      if (errorCode === "wallet_rejected")
        current.tracker.cancel("wallet_connect", { errorCode });
      else if (errorCode) current.tracker.fail("wallet_connect", { errorCode });
      else {
        if (current.interactive) current.tracker.observe("signer_ready");
        current.tracker.complete(
          current.interactive ? "ui_commit" : "signer_ready"
        );
      }
      if (current.interactive) onSettledRef.current?.();
    };
    if (adapter.connected && adapter.publicKey?.toBase58() === address) {
      finish();
      return;
    }
    if (adapter.connecting || current.connecting) return;
    if (!entry) {
      // Privy's wallet list and Wallet Standard registration settle separately.
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
      // The adapter can be ready one render before WalletProvider catches up.
      if (entry.adapter.publicKey?.toBase58() !== address) {
        finish("wallet_account_mismatch");
        return;
      }
      if (current.recoveredStaleAdapter) return;
      // Recover a missed connect event only after normal context updates settle.
      const recoveryTimer = setTimeout(() => {
        if (attemptRef.current !== current || targetRef.current !== address) return;
        current.recoveredStaleAdapter = true;
        const connectedKey = entry.adapter.publicKey;
        if (!entry.adapter.connected || connectedKey?.toBase58() !== address) return;
        current.tracker.observe("wallet_connect");
        // Replay the verified connection; disconnecting revokes extension authorization.
        entry.adapter.emit("connect", connectedKey);
      }, 2500);
      return () => clearTimeout(recoveryTimer);
    }
    current.connecting = true;
    current.tracker.observe("wallet_connect");
    void adapter
      .connect()
      .then(() => {
        current.connecting = false;
        if (
          entry.adapter.connected &&
          entry.adapter.publicKey?.toBase58() !== address
        )
          finish("wallet_account_mismatch");
        // Success is emitted by the effect after the matching context renders.
      })
      .catch((error: unknown) => {
        finish(
          classifyTransactionFailure(error) === "wallet_rejected"
            ? "wallet_rejected"
            : "wallet_connection_failed"
        );
      });
  }, [address, enabled, adapter, wallets, lifecycle]);
}
