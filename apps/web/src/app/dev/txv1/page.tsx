import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getPublicEnv } from "@/lib/core/config/public";

import { TxV1WalletProbe } from "./txv1-wallet-probe";

export const metadata: Metadata = {
  title: "Wallet v1 transaction probe",
  robots: { index: false, follow: false },
};

// Internal test page for ASK-2292: which wallets can sign Solana v1
// transactions. Not linked anywhere; 404 on the production app environment.
export default function TxV1ProbePage() {
  const env = getPublicEnv();
  if (env.appEnvironment === "prod") {
    notFound();
  }
  return <TxV1WalletProbe rpcEndpoint={env.solanaRpcEndpoint} />;
}
