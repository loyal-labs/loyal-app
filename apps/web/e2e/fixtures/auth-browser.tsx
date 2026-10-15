import React from "react";
import { usePrivyAuth } from "../../src/components/auth/privy-session-sync";
import { useSignInModal } from "../../src/contexts/sign-in-modal-context";
import { walletCreationCount } from "./privy";
import { completeFixtureConnection } from "./swap-wallet";

export function AuthProbe() {
  const auth = usePrivyAuth();
  const modal = useSignInModal();
  return (
    <>
      <button onClick={modal.open}>Connect wallet</button>
      <button onClick={completeFixtureConnection}>
        Finish wallet connection
      </button>
      <output aria-label="Sign-in step">{auth?.step}</output>
      <output aria-label="Sign-in error">{auth?.error ?? "None"}</output>
      <output aria-label="Created wallets">{walletCreationCount()}</output>
    </>
  );
}
