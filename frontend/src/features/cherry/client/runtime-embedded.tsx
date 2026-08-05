"use client";

import {
  CherryMiniAppProvider,
  useCherryApp,
  useCherryMiniApp,
} from "@cherrydotfun/miniapp-sdk/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { CherryRuntimeContext } from "./runtime-context";
import {
  CHERRY_INIT_TIMEOUT_MS,
  createCherryOperationLease,
  invalidateCherryOperationsForLifecycleEvent,
  reduceCherryLifecycle,
  parseVerifiedCherryLaunchResponse,
  runCherryDisconnectActions,
  type CherryLifecyclePhase,
  type CherryHostPlatform,
  type VerifiedCherryLaunchResponse,
} from "./runtime-contract";
import { CherryStatusScreen } from "./status-screen";

type AttestationPhase = "verifying" | "verified" | "failed";

async function verifyLaunchToken(
  launchToken: string,
  platform: CherryHostPlatform,
  signal: AbortSignal
): Promise<VerifiedCherryLaunchResponse> {
  const response = await fetch("/api/cherry/launch", {
    body: JSON.stringify({ launchToken, platform }),
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
    signal,
  });
  const body = (await response.json().catch(() => null)) as unknown;
  const launch = parseVerifiedCherryLaunchResponse(body);
  if (!(response.ok && launch)) {
    throw new Error("Cherry launch could not be verified.");
  }
  return launch;
}

function VerifiedCherryRuntime({
  children,
  platform,
}: {
  children: ReactNode;
  platform: CherryHostPlatform;
}) {
  const app = useCherryApp();
  const { error, isReady, launchToken } = useCherryMiniApp();
  const [launch, setLaunch] = useState<VerifiedCherryLaunchResponse | null>(
    null
  );
  const [attestationPhase, setAttestationPhase] =
    useState<AttestationPhase>("verifying");
  const [lifecyclePhase, setLifecyclePhase] =
    useState<CherryLifecyclePhase>("active");
  const operationLease = useMemo(() => createCherryOperationLease(), []);
  const verifiedLaunchTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (error) {
      setAttestationPhase("failed");
      return;
    }
    if (!(isReady && launchToken)) {
      return;
    }

    const controller = new AbortController();
    verifiedLaunchTokenRef.current = null;
    setLaunch(null);
    setAttestationPhase("verifying");
    void verifyLaunchToken(launchToken, platform, controller.signal)
      .then((verifiedLaunch) => {
        if (controller.signal.aborted) {
          return;
        }
        verifiedLaunchTokenRef.current = launchToken;
        setLaunch(verifiedLaunch);
        setAttestationPhase("verified");
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          verifiedLaunchTokenRef.current = null;
          setAttestationPhase("failed");
        }
      });

    return () => {
      controller.abort();
      verifiedLaunchTokenRef.current = null;
    };
  }, [error, isReady, launchToken, platform]);

  useEffect(() => {
    if (!app) {
      return;
    }

    const applyLifecycleEvent = (
      event: "suspended" | "resumed" | "walletDisconnected"
    ) => {
      invalidateCherryOperationsForLifecycleEvent(operationLease, event);
      setLifecyclePhase((current) => reduceCherryLifecycle(current, event));
    };
    const handleSuspended = () => applyLifecycleEvent("suspended");
    const handleResumed = () => applyLifecycleEvent("resumed");
    const handleWalletDisconnected = () => {
      runCherryDisconnectActions({
        block: () => applyLifecycleEvent("walletDisconnected"),
        logout: () =>
          fetch("/api/auth/logout", {
            credentials: "same-origin",
            method: "POST",
          }),
        destroy: () => app.destroy(),
      });
    };

    app.on("suspended", handleSuspended);
    app.on("resumed", handleResumed);
    app.on("walletDisconnected", handleWalletDisconnected);
    return () => {
      app.off("suspended", handleSuspended);
      app.off("resumed", handleResumed);
      app.off("walletDisconnected", handleWalletDisconnected);
    };
  }, [app, operationLease]);

  if (attestationPhase === "failed") {
    return (
      <CherryStatusScreen message="Loyal could not verify this Cherry launch. Please reopen the Mini App." />
    );
  }
  if (lifecyclePhase === "disconnected") {
    return (
      <CherryStatusScreen message="The Cherry wallet disconnected. Reopen the Mini App to continue." />
    );
  }
  if (lifecyclePhase === "suspended") {
    return <CherryStatusScreen message="Returning to Cherry…" />;
  }
  if (
    !(
      attestationPhase === "verified" &&
      isReady &&
      launch &&
      launchToken &&
      verifiedLaunchTokenRef.current === launchToken
    )
  ) {
    return <CherryStatusScreen message="Verifying the Cherry wallet…" />;
  }

  return (
    <CherryRuntimeContext.Provider
      value={{
        mode: "cherry_embedded",
        operationLease,
        platform,
        roomId: launch.roomId,
        verifiedWalletAddress: launch.walletAddress,
      }}
    >
      {children}
    </CherryRuntimeContext.Provider>
  );
}

export function CherryEmbeddedRuntime({
  children,
  platform,
}: {
  children: ReactNode;
  platform: CherryHostPlatform;
}) {
  return (
    <CherryMiniAppProvider initTimeout={CHERRY_INIT_TIMEOUT_MS} strict>
      <VerifiedCherryRuntime platform={platform}>
        {children}
      </VerifiedCherryRuntime>
    </CherryMiniAppProvider>
  );
}
