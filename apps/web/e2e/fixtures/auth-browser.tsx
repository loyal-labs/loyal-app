import React, { useState } from "react";
import { getWallets } from "@wallet-standard/app";
import { usePrivyAuth } from "../../src/components/auth/privy-session-sync";
import { useSignInModal } from "../../src/contexts/sign-in-modal-context";
import {
  walletCreationCount,
  replaceEmbeddedWallet,
  currentEmbeddedWallet,
} from "./privy";
import { completeFixtureConnection } from "./swap-wallet";

export function AuthProbe() {
  const auth = usePrivyAuth();
  const [registeredWallet, setRegisteredWallet] = useState("Unchecked");
  const modal = useSignInModal();
  return (
    <>
      <button onClick={replaceEmbeddedWallet}>Replace embedded wallet</button>
      <button
        onClick={() => {
          const wallets = getWallets()
            .get()
            .filter((wallet) => wallet.name === "Privy");
          setRegisteredWallet(
            wallets.length === 1 && wallets[0] === currentEmbeddedWallet()
              ? "Current"
              : "Stale"
          );
        }}
      >
        Check embedded wallet
      </button>
      <output aria-label="Registered wallet">{registeredWallet}</output>
      <button onClick={modal.open}>Connect wallet</button>
      <button onClick={completeFixtureConnection}>
        Finish wallet connection
      </button>
      <output aria-label="Account modal">
        {modal.isOpen ? "Open" : "Closed"}
      </output>
      <output aria-label="Sign-in step">{auth?.step}</output>
      <output aria-label="Sign-in error">{auth?.error ?? "None"}</output>
      <output aria-label="Created wallets">{walletCreationCount()}</output>
    </>
  );
}
