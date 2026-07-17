"use client";

import { AutodepositMockSheet } from "@/components/wallet-sidebar/autodeposit-mock-sheet";
import { AppWalletWorkspace } from "@/components/wallet-workspace/app-wallet-workspace";

export function AppWorkspaceShell() {
  return (
    <>
      <AppWalletWorkspace />
      <AutodepositMockSheet />
    </>
  );
}
