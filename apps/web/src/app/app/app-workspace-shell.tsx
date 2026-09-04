"use client";

import { AutodepositMockSheet } from "@/components/wallet-sidebar/autodeposit-mock-sheet";
import { WorkspaceFaceliftShell } from "@/components/wallet-workspace/facelift/shell";

export function AppWorkspaceShell() {
  return (
    <>
      <WorkspaceFaceliftShell />
      <AutodepositMockSheet />
    </>
  );
}
