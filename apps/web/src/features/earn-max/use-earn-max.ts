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
  EarnMaxActivityResponse,
  EarnMaxSummaryResponse,
  EarnMaxViewModel,
} from "./types";

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    credentials: "include",
  });
  const body = (await response.json()) as T;
  if (!response.ok) {
    throw new Error(`Earn MAX request failed (${response.status}).`);
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

function viewModel(input: {
  activity: EarnMaxActivityResponse | null;
  busy: boolean;
  error: string | null;
  loading: boolean;
  summary: EarnMaxSummaryResponse | null;
}): EarnMaxViewModel {
  const summary = input.summary?.summary;
  return {
    activity: input.activity?.operations ?? [],
    balanceUsd: summary?.balanceUsd ?? 0,
    coverage: summary?.coverage ?? "history_incomplete",
    earnedUsd: summary?.earnedUsd ?? null,
    error: input.error,
    forecastApyBps: summary?.forecastApyBps ?? null,
    isBusy: input.busy || Boolean(summary?.currentOperationId),
    isLoading: input.loading,
    performance: input.activity?.performance ?? [],
    policyStatus: summary?.policyStatus ?? null,
    realizedApyBps: summary?.realizedApyBps ?? null,
    status: summary?.goal ?? "not_installed",
    strategyLabel: "syrupUSDC / USDC",
    withdrawal: summary?.withdrawal ?? null,
  };
}

export function useEarnMax(input: {
  settingsPda: string | null | undefined;
  walletAddress: string | null;
}): { actions: EarnMaxActions; view: EarnMaxViewModel } {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [summary, setSummary] = useState<EarnMaxSummaryResponse | null>(null);
  const [activity, setActivity] = useState<EarnMaxActivityResponse | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!(input.settingsPda && input.walletAddress)) {
      setIsLoading(false);
      return;
    }
    try {
      const [nextSummary, nextActivity] = await Promise.all([
        readJson<EarnMaxSummaryResponse>(
          "/api/smart-accounts/earn-max/summary"
        ),
        readJson<EarnMaxActivityResponse>(
          "/api/smart-accounts/earn-max/activity"
        ),
      ]);
      setSummary(nextSummary);
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
    const config = summary?.config;
    if (!wallet.publicKey || !input.settingsPda || !config) {
      throw new Error("Earn MAX smart-account context is not ready.");
    }
    return {
      config,
      feePayer: wallet.publicKey,
      programId: new PublicKey(config.programId),
      summary: summary.summary,
      settings: new PublicKey(input.settingsPda),
    };
  }, [input.settingsPda, summary, wallet.publicKey]);

  const actions = useMemo<EarnMaxActions>(
    () => ({
      refresh,
      install: () =>
        run(async () => {
          const {
            config,
            feePayer,
            programId,
            settings,
            summary: currentSummary,
          } = context();
          const bindings = currentSummary?.policyAccounts ?? [];
          const seeds = bindings.map((binding) => BigInt(binding.seed));
          return buildEarnMaxInstallInstructions({
            connection,
            delegatedSigner: new PublicKey(config.delegatedSigner),
            feePayer,
            firstPolicySeed:
              seeds.length === 3
                ? seeds.reduce((left, right) => (left < right ? left : right))
                : undefined,
            matchingPolicyAccounts: new Set(
              bindings
                .filter((binding) => binding.matches)
                .map((binding) => binding.account)
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
            summary,
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
            summary,
          }).withdrawal;
          const available = BigInt(summary?.summary?.claimAmountRaw ?? "0");
          const requested = BigInt(current?.amountRaw ?? "0");
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
            requestId: current.requestId,
            settings,
          });
          return [...setup, claim.operation];
        }),
      close: () =>
        run(async () => {
          const {
            feePayer,
            programId,
            settings,
            summary: currentSummary,
          } = context();
          const policies = (currentSummary?.policyAccounts ?? []).map(
            (binding) => new PublicKey(binding.account)
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
      refresh,
      run,
      summary,
    ]
  );

  return {
    actions,
    view: viewModel({
      activity,
      busy: isBusy,
      error,
      loading: isLoading,
      summary,
    }),
  };
}
