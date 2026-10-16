import React, { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { useWallet } from "@solana/wallet-adapter-react";
import { PrivyAuthProvider } from "../../src/components/auth/privy-provider";
import { WalletConnectionProvider } from "../../src/components/solana/wallet-provider";
import { WalletReconnectPrompt } from "../../src/components/auth/wallet-reconnect-prompt";
import { useSignerRestoration } from "../../src/components/auth/use-signer-restoration";
import { PublicEnvProvider } from "../../src/contexts/public-env-context";
import { createPublicEnv } from "../../src/lib/core/config/public";
import {
  changeAccount,
  churn,
  chooseWrong,
  finish,
  owner,
  other,
  signatureCount,
  disconnectCount,
  useWallets,
} from "./standard-privy";

function Probe() {
  const adapter = useWallet();
  const { wallets } = useWallets();
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [signed, setSigned] = useState(0);
  const [error, setError] = useState("");
  useSignerRestoration({ address: owner, enabled, adapter, wallets });
  return (
    <>
      <output aria-label="Adapters">
        {adapter.wallets.map(({ adapter }) => adapter.name).join(",")}
      </output>
      <output aria-label="Signer">
        {adapter.connected ? adapter.publicKey?.toBase58() : "Disconnected"}
      </output>
      <output aria-label="Signatures">{signed}</output>
      <output aria-label="Disconnects">{disconnectCount()}</output>
      <output aria-label="Error">{error}</output>
      <button onClick={churn}>Refresh Privy wallets</button>
      <button onClick={finish}>Finish connection</button>
      <button onClick={() => setEnabled(true)}>Restore session signer</button>
      <button onClick={async () => {
        const entry = adapter.wallets.find(({ adapter }) => adapter.name === "Privy");
        if (!entry) throw new Error("Fixture wallet unavailable");
        await entry.adapter.connect();
        adapter.select(entry.adapter.name);
        setEnabled(true);
      }}>Restore preconnected signer</button>
      <button
        onClick={() => {
          setEnabled(false);
          void adapter.disconnect();
        }}
      >
        Disconnect session signer
      </button>
      <button
        onClick={() => {
          chooseWrong();
          changeAccount(other);
        }}
      >
        Switch account
      </button>
      <button onClick={() => changeAccount(owner)}>Restore account</button>
      <button onClick={() => setOpen(true)}>Withdraw</button>
      <button
        onClick={async () => {
          if (
            !adapter.connected ||
            adapter.publicKey?.toBase58() !== owner ||
            !adapter.signMessage
          ) {
            setError("Wrong signer blocked");
            return;
          }
          await adapter.signMessage(
            new TextEncoder().encode("Offline reconnect check")
          );
          setSigned(signatureCount());
        }}
      >
        Sign offline message
      </button>
      <WalletReconnectPrompt
        expectedWalletAddress={owner}
        open={open}
        onClose={() => setOpen(false)}
        onReady={() => setOpen(false)}
      />
    </>
  );
}
createRoot(document.getElementById("auth")!).render(
  <StrictMode>
    <PublicEnvProvider
      value={createPublicEnv({
        NEXT_PUBLIC_APP_ENVIRONMENT: "local",
        NEXT_PUBLIC_SOLANA_ENV: "mainnet",
        NEXT_PUBLIC_PRIVY_APP_ID: "controlled-fixture",
      })}
    >
      <PrivyAuthProvider>
        <WalletConnectionProvider>
          <Probe />
        </WalletConnectionProvider>
      </PrivyAuthProvider>
    </PublicEnvProvider>
  </StrictMode>
);
