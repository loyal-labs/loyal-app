"use client";

import type { AuthSessionUser } from "@loyal-labs/auth-core";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useRef, useState } from "react";

import type {
  EnsureSmartAccountRequest,
  SmartAccountProvisioningResponse,
} from "@/features/smart-accounts/contracts";
import {
  ensureSmartAccountRequestSchema,
  smartAccountProvisioningResponseSchema,
} from "@/features/smart-accounts/contracts";
import {
  provisionSmartAccountForWalletSession,
  shouldRetrySmartAccountProvisionError,
  shouldProvisionWalletSmartAccount,
} from "@/features/smart-accounts/client/provisioning";
import { useAuthSession } from "@/contexts/auth-session-context";
import { usePublicEnv } from "@/contexts/public-env-context";

async function postSmartAccountJson<TRequest, TResponse>(args: {
  path: string;
  body: TRequest;
  requestSchema: { parse: (value: unknown) => TRequest };
  responseSchema: { parse: (value: unknown) => TResponse };
}): Promise<TResponse> {
  const response = await fetch(args.path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(args.requestSchema.parse(args.body)),
  });

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof (payload as { error?: { message?: unknown } }).error?.message ===
        "string"
        ? ((payload as { error: { message: string } }).error.message as string)
        : "Smart account provisioning request failed.";

    throw new Error(message);
  }

  return args.responseSchema.parse(payload);
}

function maybePatchAuthenticatedUser(
  user: AuthSessionUser | null,
  smartAccountAddress: string,
  setAuthenticatedUser: (user: AuthSessionUser) => void
): void {
  if (!user || user.smartAccountAddress === smartAccountAddress) {
    return;
  }

  setAuthenticatedUser({
    ...user,
    smartAccountAddress,
  });
}

export function SmartAccountProvisioner() {
  const [retryNonce, setRetryNonce] = useState(0);
  const { connection } = useConnection();
  const {
    connected,
    publicKey,
    signTransaction,
    sendTransaction,
  } = useWallet();
  const {
    isHydrated,
    user,
    setAuthenticatedUser,
  } = useAuthSession();
  const { solanaEnv } = usePublicEnv();
  const attemptKeyRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const scheduleRetry = () => {
      if (retryTimeoutRef.current) {
        return;
      }

      retryTimeoutRef.current = setTimeout(() => {
        retryTimeoutRef.current = null;
        attemptKeyRef.current = null;
        setRetryNonce((value) => value + 1);
      }, 1500);
    };

    const walletAddress = publicKey?.toBase58() ?? null;
    const shouldProvision = shouldProvisionWalletSmartAccount({
      isHydrated,
      user,
      connected,
      walletAddress,
      hasSendTransaction: Boolean(sendTransaction),
    });

    if (!shouldProvision) {
      attemptKeyRef.current = null;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      return;
    }

    const attemptKey = `${user!.walletAddress}:${walletAddress}:${solanaEnv}`;
    if (attemptKeyRef.current === attemptKey || inFlightRef.current) {
      return;
    }

    attemptKeyRef.current = attemptKey;
    inFlightRef.current = true;

    const ensure = (body?: EnsureSmartAccountRequest) =>
      postSmartAccountJson<
        EnsureSmartAccountRequest,
        SmartAccountProvisioningResponse
      >({
        path: "/api/smart-account/ensure",
        body: body ?? {},
        requestSchema: ensureSmartAccountRequestSchema,
        responseSchema: smartAccountProvisioningResponseSchema,
      });

    void provisionSmartAccountForWalletSession({
      connection,
      walletAddress: walletAddress!,
      signTransaction,
      sendTransaction: sendTransaction!,
      ensure,
    })
      .then((response) => {
        if (response.state === "ready") {
          if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current);
            retryTimeoutRef.current = null;
          }
          maybePatchAuthenticatedUser(
            user,
            response.smartAccountAddress,
            setAuthenticatedUser
          );
          return;
        }

        scheduleRetry();
      })
      .catch((error) => {
        console.warn("[smart-account] provisioning failed:", error);
        attemptKeyRef.current = null;

        if (shouldRetrySmartAccountProvisionError(error)) {
          scheduleRetry();
        }
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }, [
    connected,
    connection,
    isHydrated,
    publicKey,
    signTransaction,
    sendTransaction,
    setAuthenticatedUser,
    solanaEnv,
    user,
    retryNonce,
  ]);

  return null;
}
