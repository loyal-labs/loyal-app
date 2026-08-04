import { isCherryEntryPath } from "../entry";

export const CHERRY_INIT_TIMEOUT_MS = 10_000;

export type CherryOperationLease = {
  capture: () => number;
  invalidate: () => void;
  isCurrent: (generation: number) => boolean;
};

export function createCherryOperationLease(): CherryOperationLease {
  let generation = 0;
  return {
    capture: () => generation,
    invalidate: () => {
      generation += 1;
    },
    isCurrent: (candidate) => candidate === generation,
  };
}

export type CherryMobileEntryMode =
  | "standalone"
  | "cherry_mobile"
  | "unsupported_cherry_entry";

export function resolveCherryMobileEntry(args: {
  pathname: string;
  hasCherryMarker: boolean;
  hasNativePostMessage: boolean;
}): CherryMobileEntryMode {
  if (!isCherryEntryPath(args.pathname)) {
    return "standalone";
  }

  return args.hasCherryMarker && args.hasNativePostMessage
    ? "cherry_mobile"
    : "unsupported_cherry_entry";
}

export type VerifiedCherryLaunchResponse = {
  walletAddress: string;
  roomId: string;
  issuedAt: number;
  expiresAt: number;
};

export function parseVerifiedCherryLaunchResponse(
  value: unknown
): VerifiedCherryLaunchResponse | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const response = value as Record<string, unknown>;
  if (
    typeof response.walletAddress !== "string" ||
    !response.walletAddress ||
    typeof response.roomId !== "string" ||
    !response.roomId ||
    !Number.isInteger(response.issuedAt) ||
    !Number.isInteger(response.expiresAt) ||
    (response.expiresAt as number) <= (response.issuedAt as number)
  ) {
    return null;
  }

  return {
    walletAddress: response.walletAddress,
    roomId: response.roomId,
    issuedAt: response.issuedAt as number,
    expiresAt: response.expiresAt as number,
  };
}

export function isVerifiedCherryWalletMatch(
  verifiedWalletAddress: string,
  connectedWalletAddress: string | null
): boolean {
  return (
    connectedWalletAddress !== null &&
    connectedWalletAddress === verifiedWalletAddress
  );
}

export function isVerifiedCherryAuthSessionMatch(
  verifiedWalletAddress: string,
  sessionWalletAddress: string | null
): boolean {
  return sessionWalletAddress === verifiedWalletAddress;
}

export type CherryLifecyclePhase = "active" | "suspended" | "disconnected";

export function reduceCherryLifecycle(
  phase: CherryLifecyclePhase,
  event: "suspended" | "resumed" | "walletDisconnected"
): CherryLifecyclePhase {
  if (phase === "disconnected" || event === "walletDisconnected") {
    return "disconnected";
  }
  return event === "suspended" ? "suspended" : "active";
}

export function invalidateCherryOperationsForLifecycleEvent(
  operationLease: CherryOperationLease,
  event: "suspended" | "resumed" | "walletDisconnected"
): void {
  if (event === "suspended" || event === "walletDisconnected") {
    operationLease.invalidate();
  }
}

export function runCherryDisconnectActions(actions: {
  block: () => void;
  logout: () => Promise<unknown>;
  destroy: () => void;
}): void {
  actions.block();
  void actions.logout().catch(() => undefined);
  queueMicrotask(actions.destroy);
}
