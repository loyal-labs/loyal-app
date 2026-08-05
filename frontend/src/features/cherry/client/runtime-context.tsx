"use client";

import { createContext, useContext } from "react";

import type {
  CherryHostPlatform,
  CherryOperationLease,
} from "./runtime-contract";

export type CherryRuntimeValue =
  | { mode: "standalone" }
  | {
      mode: "cherry_embedded";
      operationLease: CherryOperationLease;
      platform: CherryHostPlatform;
      roomId: string;
      verifiedWalletAddress: string;
    };

export const CherryRuntimeContext = createContext<CherryRuntimeValue>({
  mode: "standalone",
});

export function useCherryRuntime(): CherryRuntimeValue {
  return useContext(CherryRuntimeContext);
}
