"use client";

import {
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
} from "@solana/kit";
import { getAddMemoInstruction } from "@solana-program/memo";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { useEffect, useState } from "react";

type TxVersion = 0 | 1;

type ProbeRow = {
  wallet: string;
  account: string;
  declared: string;
  version: TxVersion;
  result: string;
};

const SIGN_TRANSACTION = "solana:signTransaction";
const CONNECT = "standard:connect";

type SignTransactionFeature = {
  supportedTransactionVersions?: readonly (string | number)[];
  signTransaction: (
    ...inputs: { account: WalletAccount; transaction: Uint8Array }[]
  ) => Promise<readonly { signedTransaction: Uint8Array }[]>;
};

type ConnectFeature = {
  connect: () => Promise<{ accounts: readonly WalletAccount[] }>;
};

function solanaWallets(): Wallet[] {
  return getWallets()
    .get()
    .filter((wallet) => SIGN_TRANSACTION in wallet.features);
}

async function buildMemoTransaction(
  rpcEndpoint: string,
  payer: string,
  version: TxVersion
): Promise<Uint8Array> {
  const rpc = createSolanaRpc(rpcEndpoint);
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version }),
    (m) => setTransactionMessageFeePayer(address(payer), m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: blockhash.blockhash as Blockhash,
          lastValidBlockHeight: blockhash.lastValidBlockHeight,
        },
        m
      ),
    (m) =>
      appendTransactionMessageInstruction(
        getAddMemoInstruction({ memo: `loyal txv1 probe v${version}` }),
        m
      )
  );
  return new Uint8Array(
    getTransactionEncoder().encode(compileTransaction(message))
  );
}

async function probe(
  rpcEndpoint: string,
  wallet: Wallet,
  version: TxVersion
): Promise<ProbeRow> {
  const feature = wallet.features[SIGN_TRANSACTION] as SignTransactionFeature;
  const declared = JSON.stringify(feature.supportedTransactionVersions ?? []);
  let account = wallet.accounts[0];
  if (!account && CONNECT in wallet.features) {
    const connected = await (
      wallet.features[CONNECT] as ConnectFeature
    ).connect();
    account = connected.accounts[0];
  }
  if (!account) {
    return {
      wallet: wallet.name,
      account: "-",
      declared,
      version,
      result: "no account",
    };
  }
  const row = {
    wallet: wallet.name,
    account: account.address,
    declared,
    version,
  };
  try {
    const transaction = await buildMemoTransaction(
      rpcEndpoint,
      account.address,
      version
    );
    const [output] = await feature.signTransaction({ account, transaction });
    const signed = getTransactionDecoder().decode(output.signedTransaction);
    const signature = signed.signatures[address(account.address)];
    if (!signature) {
      return { ...row, result: "returned without our signature" };
    }
    // Simulate only; the probe never sends.
    const simulation = await createSolanaRpc(rpcEndpoint)
      .simulateTransaction(getBase64EncodedWireTransaction(signed), {
        encoding: "base64",
        sigVerify: true,
      })
      .send();
    const simulated = simulation.value.err
      ? `sim error ${JSON.stringify(simulation.value.err)}`
      : "sim ok";
    return { ...row, result: `signed, ${simulated}` };
  } catch (error) {
    return {
      ...row,
      result: `error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

export function TxV1WalletProbe({ rpcEndpoint }: { rpcEndpoint: string }) {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [rows, setRows] = useState<ProbeRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => setWallets(solanaWallets());
    refresh();
    const { on } = getWallets();
    const offRegister = on("register", refresh);
    const offUnregister = on("unregister", refresh);
    return () => {
      offRegister();
      offUnregister();
    };
  }, []);

  const run = async (wallet: Wallet) => {
    setBusy(wallet.name);
    try {
      for (const version of [0, 1] as const) {
        const row = await probe(rpcEndpoint, wallet, version);
        setRows((current) => [...current, row]);
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <main
      style={{
        fontFamily: "monospace",
        margin: "40px auto",
        maxWidth: 960,
        padding: 16,
      }}
    >
      <h1>Wallet v1 transaction probe</h1>
      <p>
        Builds a memo transaction as v0 (control) and v1 with @solana/kit, asks
        the wallet to sign it through solana:signTransaction, then simulates it.
        Nothing is sent. RPC: {new URL(rpcEndpoint).host}
      </p>
      {wallets.length === 0 ? (
        <p>No Wallet Standard wallets detected.</p>
      ) : null}
      {wallets.map((wallet) => (
        <button
          disabled={busy !== null}
          key={wallet.name}
          onClick={() => void run(wallet)}
          style={{ display: "block", margin: "8px 0", padding: "8px 12px" }}
          type="button"
        >
          {busy === wallet.name ? "Probing" : "Probe"} {wallet.name}
        </button>
      ))}
      <table
        style={{ borderCollapse: "collapse", marginTop: 24, width: "100%" }}
      >
        <thead>
          <tr>
            {["wallet", "account", "declared versions", "tx", "result"].map(
              (label) => (
                <th
                  key={label}
                  style={{ borderBottom: "1px solid #999", textAlign: "left" }}
                >
                  {label}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.wallet}-${row.version}-${index}`}>
              <td>{row.wallet}</td>
              <td>{row.account.slice(0, 8)}</td>
              <td>{row.declared}</td>
              <td>v{row.version}</td>
              <td>{row.result}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
