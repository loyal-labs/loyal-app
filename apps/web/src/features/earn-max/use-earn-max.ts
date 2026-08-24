"use client";

import {
  buildEarnMaxClaimInstructions,
  buildEarnMaxCloseInstructions,
  buildEarnMaxDepositInstructions,
  buildEarnMaxInstallInstructions,
  buildEarnMaxSetupInstructions,
  buildEarnMaxWithdrawalCancelInstructions,
  buildEarnMaxWithdrawalRequestInstructions,
  deriveEarnMaxWalletClaimAta,
  type EarnMaxClientOperation,
} from "@loyal-labs/actions";
import {
  sendPreparedWithWallet,
  type WalletAdapterLike,
} from "@loyal-labs/smart-account-vaults";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  EarnMaxActions,
  EarnMaxActivityItem,
  EarnMaxPerformancePoint,
  EarnMaxViewModel,
  EarnMaxWithdrawalView,
} from "./types";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.map(record).filter((item): item is JsonRecord => item !== null)
    : [];
}

function raw(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value))
    return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  return null;
}

function number(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dollars(value: unknown): number {
  const micros = raw(value);
  return micros === null ? 0 : Number(micros) / 1_000_000;
}

async function readJson(path: string): Promise<unknown> {
  const response = await fetch(path, {
    cache: "no-store",
    credentials: "include",
  });
  const body = await response.json();
  if (!response.ok) {
    const error = record(record(body)?.error);
    throw new Error(
      typeof error?.message === "string"
        ? error.message
        : `Earn MAX request failed (${response.status}).`
    );
  }
  return body;
}

function walletBridge(wallet: ReturnType<typeof useWallet>): WalletAdapterLike {
  if (!wallet.publicKey || !wallet.signTransaction) {
    throw new Error("Connected wallet cannot sign Earn MAX transactions.");
  }
  return {
    publicKey: wallet.publicKey,
    signTransaction: wallet.signTransaction,
    ...(wallet.signAllTransactions
      ? { signAllTransactions: wallet.signAllTransactions }
      : {}),
    ...(wallet.sendTransaction
      ? { sendTransaction: wallet.sendTransaction }
      : {}),
  };
}

function withdrawalView(
  route: JsonRecord | null
): EarnMaxWithdrawalView | null {
  const withdrawal = record(route?.withdrawal);
  const status = withdrawal?.status;
  if (
    !withdrawal ||
    !["requested", "unwinding", "claimable", "claimed"].includes(String(status))
  ) {
    return null;
  }
  return {
    amountRaw: String(withdrawal.amountRaw ?? "0"),
    canCancel: status === "requested" && route?.currentOperationId === null,
    canClaim: status === "claimable",
    readyBy: String(withdrawal.readyBy ?? ""),
    requestId: String(withdrawal.requestId ?? ""),
    status: status as EarnMaxWithdrawalView["status"],
  };
}

function viewModel(input: {
  activity: unknown;
  busy: boolean;
  error: string | null;
  loading: boolean;
  performance: unknown;
  state: unknown;
}): EarnMaxViewModel {
  const stateResponse = record(input.state);
  const row = record(stateResponse?.state);
  const route = record(row?.state);
  const frontend = record(route?.frontend);
  const performance = record(record(input.performance)?.performance);
  const activity = record(input.activity);
  const operations: EarnMaxActivityItem[] = records(activity?.operations).map(
    (operation) => ({
      action: String(operation.action ?? "activity"),
      id: String(operation.operation_id ?? ""),
      signature:
        typeof operation.transaction_signature === "string"
          ? operation.transaction_signature
          : null,
      status: String(operation.status ?? "unknown"),
      timestamp: String(operation.created_at ?? ""),
    })
  );
  const points: EarnMaxPerformancePoint[] = records(activity?.snapshots)
    .flatMap((snapshot) => {
      const equity = raw(snapshot.equity_usd_micros);
      const timestamp = String(
        snapshot.valuation_observed_at ?? snapshot.observed_at ?? ""
      );
      return equity === null || timestamp.length === 0
        ? []
        : [{ equityUsd: Number(equity) / 1_000_000, timestamp }];
    })
    .reverse();
  const strategy = String(
    frontend?.strategyKey ?? route?.targetStrategyKey ?? ""
  );
  return {
    activity: operations,
    balanceUsd: dollars(
      performance?.equity_usd_micros ?? row?.equity_usd_micros
    ),
    coverage:
      performance?.performance_coverage === "complete"
        ? "complete"
        : "history_incomplete",
    earnedUsd:
      raw(performance?.earned_usd_micros) === null
        ? null
        : dollars(performance?.earned_usd_micros),
    error: input.error,
    forecastApyBps: number(performance?.forecast_apy_bps),
    isBusy: input.busy || route?.currentOperationId !== null,
    isLoading: input.loading,
    performance: points,
    policyStatus:
      typeof row?.policy_status === "string" ? row.policy_status : null,
    realizedApyBps: number(performance?.realized_apy_bps),
    status: String(frontend?.status ?? "not_installed"),
    strategyLabel:
      strategy === "syrup_usdc_pyusd"
        ? "syrupUSDC / PYUSD"
        : "syrupUSDC / USDC",
    withdrawal: withdrawalView(route),
  };
}

export function useEarnMax(input: {
  settingsPda: string | null | undefined;
  walletAddress: string | null;
}): { actions: EarnMaxActions; view: EarnMaxViewModel } {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [state, setState] = useState<unknown>(null);
  const [performance, setPerformance] = useState<unknown>(null);
  const [activity, setActivity] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!(input.settingsPda && input.walletAddress)) {
      setIsLoading(false);
      return;
    }
    try {
      const [nextState, nextPerformance, nextActivity] = await Promise.all([
        readJson("/api/smart-accounts/earn-max/state"),
        readJson("/api/smart-accounts/earn-max/performance"),
        readJson("/api/smart-accounts/earn-max/activity"),
      ]);
      setState(nextState);
      setPerformance(nextPerformance);
      setActivity(nextActivity);
      setError(null);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Earn MAX failed to load."
      );
    } finally {
      setIsLoading(false);
    }
  }, [input.settingsPda, input.walletAddress]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const send = useCallback(
    async (operations: readonly EarnMaxClientOperation[]) => {
      if (
        !wallet.publicKey ||
        wallet.publicKey.toBase58() !== input.walletAddress
      ) {
        throw new Error("Connect the authenticated wallet to use Earn MAX.");
      }
      const bridge = walletBridge(wallet);
      for (const operation of operations) {
        await sendPreparedWithWallet({
          connection,
          wallet: bridge,
          prepared: operation,
          confirm: true,
        });
      }
      await refresh();
    },
    [connection, input.walletAddress, refresh, wallet]
  );

  const run = useCallback(
    async (build: () => Promise<readonly EarnMaxClientOperation[]>) => {
      setIsBusy(true);
      setError(null);
      try {
        await send(await build());
        return true;
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Earn MAX transaction failed."
        );
        return false;
      } finally {
        setIsBusy(false);
      }
    },
    [send]
  );

  const context = useCallback(() => {
    const response = record(state);
    const config = record(response?.config);
    if (
      !wallet.publicKey ||
      !input.settingsPda ||
      typeof config?.programId !== "string"
    ) {
      throw new Error("Earn MAX smart-account context is not ready.");
    }
    return {
      config,
      feePayer: wallet.publicKey,
      programId: new PublicKey(config.programId),
      row: record(response?.state),
      settings: new PublicKey(input.settingsPda),
    };
  }, [input.settingsPda, state, wallet.publicKey]);

  const actions = useMemo<EarnMaxActions>(
    () => ({
      refresh,
      install: () =>
        run(async () => {
          const { config, feePayer, programId, row, settings } = context();
          if (typeof config.delegatedSigner !== "string")
            throw new Error("Earn MAX signer configuration is missing.");
          const bindings = records(row?.policy_accounts);
          const seeds = bindings
            .map((binding) => raw(binding.seed))
            .filter((seed): seed is bigint => seed !== null);
          return buildEarnMaxInstallInstructions({
            connection,
            delegatedSigner: new PublicKey(config.delegatedSigner),
            feePayer,
            firstPolicySeed:
              seeds.length === 6
                ? seeds.reduce((left, right) => (left < right ? left : right))
                : undefined,
            matchingPolicyAccounts: new Set(
              bindings
                .filter((binding) => binding.matches === true)
                .map((binding) => String(binding.account))
            ),
            programId,
            settings,
          });
        }),
      deposit: (amountRaw) =>
        run(async () => {
          const { feePayer, programId, settings } = context();
          return buildEarnMaxDepositInstructions({
            amountRaw,
            connection,
            feePayer,
            programId,
            settings,
          });
        }),
      requestWithdrawal: (amountRaw) =>
        run(async () => {
          const { feePayer, programId, settings } = context();
          return [
            await buildEarnMaxWithdrawalRequestInstructions({
              amountRaw,
              connection,
              destination: deriveEarnMaxWalletClaimAta(feePayer),
              feePayer,
              programId,
              requestId: crypto.randomUUID().replaceAll("-", ""),
              settings,
            }),
          ];
        }),
      cancelWithdrawal: () =>
        run(async () => {
          const current = viewModel({
            activity,
            busy: isBusy,
            error,
            loading: isLoading,
            performance,
            state,
          }).withdrawal;
          if (!current?.canCancel)
            throw new Error("Earn MAX withdrawal can no longer be cancelled.");
          const { feePayer, programId, settings } = context();
          return [
            await buildEarnMaxWithdrawalCancelInstructions({
              connection,
              feePayer,
              programId,
              requestId: current.requestId,
              settings,
            }),
          ];
        }),
      claim: () =>
        run(async () => {
          const current = viewModel({
            activity,
            busy: isBusy,
            error,
            loading: isLoading,
            performance,
            state,
          }).withdrawal;
          const row = record(record(state)?.state);
          const available = raw(row?.claim_raw) ?? BigInt(0);
          const requested = raw(current?.amountRaw) ?? BigInt(0);
          const amountRaw = requested < available ? requested : available;
          if (!current?.canClaim || amountRaw <= BigInt(0))
            throw new Error("Earn MAX withdrawal is not claimable.");
          const { feePayer, programId, settings } = context();
          const setup =
            amountRaw < available
              ? await buildEarnMaxSetupInstructions({
                  connection,
                  feePayer,
                  programId,
                  settings,
                })
              : [];
          const claim = await buildEarnMaxClaimInstructions({
            amountRaw,
            connection,
            feePayer,
            programId,
            settings,
          });
          return [...setup, claim.operation];
        }),
      close: () =>
        run(async () => {
          const { feePayer, programId, row, settings } = context();
          const policies = records(row?.policy_accounts).map(
            (binding) => new PublicKey(String(binding.account))
          );
          const operation = await buildEarnMaxCloseInstructions({
            connection,
            feePayer,
            policies,
            programId,
            settings,
          });
          return operation ? [operation] : [];
        }),
    }),
    [
      activity,
      connection,
      context,
      error,
      isBusy,
      isLoading,
      performance,
      refresh,
      run,
      state,
    ]
  );

  return {
    actions,
    view: viewModel({
      activity,
      busy: isBusy,
      error,
      loading: isLoading,
      performance,
      state,
    }),
  };
}
