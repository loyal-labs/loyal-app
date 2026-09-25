"use client";

import {
  createSmartAccountVaultsClient,
  sendPreparedWithWallet,
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
import { readJson, viewModel, walletBridge } from "./use-earn-max";
import {
  voltrClaimPlan,
  voltrDepositPlan,
  type VoltrPlan,
  voltrRequestWithdrawalPlan,
} from "./voltr/plans";
import {
  deriveEarnMaxVoltrAuthority,
  EARN_MAX_VOLTR_ACCOUNT_INDEX,
} from "./voltr/program";

export function useEarnMaxVoltr(input: {
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

  // Flip a pending request to claimable without a manual reload.
  const readyBy = summary?.summary?.withdrawal?.readyBy;
  const canClaim = summary?.summary?.withdrawal?.canClaim;
  useEffect(() => {
    if (!readyBy || canClaim) return;
    const delay = Math.max(0, Date.parse(readyBy) - Date.now()) + 2_000;
    const timer = setTimeout(() => void refresh(), delay);
    return () => clearTimeout(timer);
  }, [canClaim, readyBy, refresh]);

  const run = useCallback(
    async (
      build: (context: {
        authority: PublicKey;
        owner: PublicKey;
      }) => Promise<VoltrPlan>
    ) => {
      setIsBusy(true);
      setError(null);
      try {
        const programId = summary?.config.programId;
        if (
          !(wallet.publicKey && input.settingsPda && programId) ||
          wallet.publicKey.toBase58() !== input.walletAddress
        ) {
          throw new Error("Connect the authenticated wallet to use Earn MAX.");
        }
        const owner = wallet.publicKey;
        const settingsPda = new PublicKey(input.settingsPda);
        const client = createSmartAccountVaultsClient({
          connection,
          programId: new PublicKey(programId),
        });
        const settings = await client.sdk.smartAccounts.queries.fetchSettings(
          settingsPda
        );
        if (Number(settings.threshold) > 1 || Number(settings.timeLock) > 0) {
          // ponytail: sync execute only; add the propose/approve/execute
          // fallback if multi-signer accounts ever get Earn MAX invites.
          throw new Error(
            "Earn MAX needs a single-signer smart account without a time lock."
          );
        }
        const authority = deriveEarnMaxVoltrAuthority(settingsPda, programId);
        const { outer, vault } = await build({ authority, owner });
        const prepared = await client.prepareCustomInstructionSync({
          accountIndex: EARN_MAX_VOLTR_ACCOUNT_INDEX,
          feePayer: owner,
          instructions: vault,
          settingsPda,
          signer: owner,
        });
        if (!prepared) {
          throw new Error("Earn MAX transaction is too large.");
        }
        await sendPreparedWithWallet({
          confirm: true,
          connection,
          prepared: {
            ...prepared,
            instructions: [...outer, ...prepared.instructions],
          },
          wallet: walletBridge(wallet),
        });
        await refresh();
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
    [
      connection,
      input.settingsPda,
      input.walletAddress,
      refresh,
      summary?.config.programId,
      wallet,
    ]
  );

  const actions = useMemo<EarnMaxActions>(
    () => ({
      refresh,
      // Pooled vault: no per-user install or close step.
      install: async () => true,
      close: async () => true,
      cancelWithdrawal: async () => false,
      deposit: (amountRaw) =>
        run(async (context) => voltrDepositPlan(context, amountRaw)),
      requestWithdrawal: (amountRaw) =>
        run((context) =>
          voltrRequestWithdrawalPlan(connection, context, amountRaw)
        ),
      // One signature: claim, then sweep the vault's USDC to the wallet.
      claim: () => run((context) => voltrClaimPlan(connection, context)),
    }),
    [connection, refresh, run]
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
