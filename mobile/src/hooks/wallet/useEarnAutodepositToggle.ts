import { useCallback, useMemo, useRef, useState } from "react";

import {
  createAutodepositToggleController,
  type AutodepositToggleController,
} from "@/lib/solana/earn/autodeposit-toggle-controller";
import { setEarnAutodepositActive } from "@/lib/solana/earn/autodeposit";
import type { EarnAutodepositState } from "@/lib/solana/earn/earn-api";
import type { Signer } from "@/lib/wallet/signer";

const AUTODEPOSIT_TOGGLE_DEBOUNCE_MS = 250;

type OptimisticActive = {
  active: boolean;
  targetKey: string;
};

export function useEarnAutodepositToggle(args: {
  autodeposit: EarnAutodepositState | null;
  signer: Signer | null;
  walletUnlocked: boolean;
  refreshAutodeposit(): Promise<EarnAutodepositState | null>;
}): {
  active: boolean;
  requestToggle(): Promise<void> | null;
} {
  const { autodeposit, signer, walletUnlocked, refreshAutodeposit } = args;
  const policyAccount = autodeposit?.policyAccount ?? null;
  const recurringDelegation = autodeposit?.recurringDelegation ?? null;
  const vaultIndex = autodeposit?.vaultIndex ?? null;
  const walletAddress = signer?.publicKey.toBase58() ?? null;
  const targetKey =
    walletAddress && policyAccount && recurringDelegation && vaultIndex !== null
      ? `${walletAddress}:${policyAccount}:${recurringDelegation}:${vaultIndex}`
      : null;

  const [optimisticActive, setOptimisticActive] =
    useState<OptimisticActive | null>(null);
  const currentTargetKeyRef = useRef(targetKey);
  currentTargetKeyRef.current = targetKey;

  const baseActive = autodeposit?.active ?? false;
  const authoritativeActiveRef = useRef<boolean | null>(
    autodeposit?.active ?? null
  );
  authoritativeActiveRef.current = autodeposit?.active ?? null;
  const active =
    targetKey && optimisticActive?.targetKey === targetKey
      ? optimisticActive.active
      : baseActive;
  const activeRef = useRef(active);
  activeRef.current = active;

  const controller = useMemo<AutodepositToggleController | null>(() => {
    if (
      !walletUnlocked ||
      !signer ||
      !targetKey ||
      !policyAccount ||
      !recurringDelegation ||
      vaultIndex === null
    ) {
      return null;
    }

    const controllerTargetKey = targetKey;
    return createAutodepositToggleController({
      debounceMs: AUTODEPOSIT_TOGGLE_DEBOUNCE_MS,
      submit: (nextActive) =>
        setEarnAutodepositActive({
          signer,
          active: nextActive,
          policyAccount,
          recurringDelegation,
          vaultIndex,
        }),
      refresh: async () => {
        const refreshed = await refreshAutodeposit();
        return refreshed?.active ?? authoritativeActiveRef.current;
      },
      onOptimisticActive: (nextActive) => {
        if (currentTargetKeyRef.current === controllerTargetKey) {
          activeRef.current = nextActive;
          setOptimisticActive({
            active: nextActive,
            targetKey: controllerTargetKey,
          });
        }
      },
      onReconciledActive: (authoritativeActive) => {
        if (currentTargetKeyRef.current === controllerTargetKey) {
          activeRef.current = authoritativeActive;
          // refreshAutodeposit has already installed the authoritative record.
          // Clearing the override lets future background refreshes drive UI.
          setOptimisticActive(null);
        }
      },
    });
  }, [
    walletUnlocked,
    signer,
    refreshAutodeposit,
    targetKey,
    policyAccount,
    recurringDelegation,
    vaultIndex,
  ]);

  const requestToggle = useCallback((): Promise<void> | null => {
    if (!controller) {
      return null;
    }
    const nextActive = !activeRef.current;
    activeRef.current = nextActive;
    return controller.request(nextActive);
  }, [controller]);

  return { active, requestToggle };
}
