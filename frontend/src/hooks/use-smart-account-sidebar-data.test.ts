import { describe, expect, test } from "bun:test";

import {
  getSmartAccountTotalUsd,
  type SmartAccountSignerEntry,
  type SmartAccountVaultEntry,
} from "./use-smart-account-sidebar-data";

function makeSigner(
  address: string,
  totalUsd: number
): SmartAccountSignerEntry {
  return {
    accessLabel: "Suggest",
    accessLevel: "suggest",
    address,
    balanceFraction: ".00",
    balanceWhole: "$0",
    canExecute: false,
    canInitiate: true,
    canVote: false,
    icon: "/agents/Agent-01.svg",
    id: `policy:${address}`,
    label: "Agent 1",
    permissions: ["initiate"],
    policyAddress: null,
    scope: "policy",
    scopeLabel: "Constrained policy",
    shortAddress: `${address.slice(0, 4)}…${address.slice(-4)}`,
    spendingLimit: null,
    spendingLimits: [],
    totalUsd,
  };
}

function makeVault(
  accountIndex: number,
  totalUsd: number,
  signers: SmartAccountSignerEntry[]
): SmartAccountVaultEntry {
  return {
    accountIndex,
    address: `vault-${accountIndex}`,
    balanceFraction: ".00",
    balanceWhole: "$0",
    label: "Stash",
    signers,
    totalUsd,
  };
}

describe("getSmartAccountTotalUsd", () => {
  test("adds stash balances and non-main signer balances", () => {
    const totalUsd = getSmartAccountTotalUsd({
      authenticatedWalletAddress: "MAIN1111",
      vaultEntries: [
        makeVault(0, 25, [
          makeSigner("MAIN1111", 100),
          makeSigner("AGENT111", 7),
        ]),
        makeVault(1, 10, [makeSigner("AGENT111", 7)]),
      ],
    });

    expect(totalUsd).toBe(42);
  });
});
