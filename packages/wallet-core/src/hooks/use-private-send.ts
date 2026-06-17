import {
  DELEGATION_PROGRAM_ID,
  type ShieldFlowExecutionResult,
  type ShieldFlowPlan,
  type ShieldFlowTransactionPlan,
  delegateDepositIx,
  delegateUsernameDepositIx,
  findDepositPda,
  findUsernameDepositPda,
  getErValidatorForSolanaEnv,
  initializeDepositIx,
  initializeUsernameDepositIx,
  LoyalPrivateTransactionsClient,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  transferDepositIx,
  transferToUsernameDepositIx,
  USDC_MINT_DEVNET,
  USDC_MINT_MAINNET,
} from "@loyal-labs/private-transactions";
import {
  type SolanaEnv,
  getPerEndpoints,
  getSolanaEndpoints,
} from "@loyal-labs/solana-rpc";
import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useRef, useState } from "react";

import { TOKEN_DECIMALS, TOKEN_MINTS } from "../constants/token-mints";
import type { WalletSigner } from "../types/signer";

export type PrivateSendResult = {
  signature?: string;
  success: boolean;
  error?: string;
};

function cleanSolanaErrorMessage(message: string): string {
  const logsIndex = message.indexOf("Logs:");
  if (logsIndex !== -1) {
    return message.slice(0, logsIndex).trim();
  }
  return message;
}

function getLastSignature(
  result: ShieldFlowExecutionResult
): string | undefined {
  return result.signatures[result.signatures.length - 1]?.signature;
}

function isKaminoUsdcMint(tokenMint: PublicKey, solanaEnv: SolanaEnv): boolean {
  const trackedMint =
    solanaEnv === "mainnet"
      ? USDC_MINT_MAINNET
      : solanaEnv === "devnet"
      ? USDC_MINT_DEVNET
      : null;
  return trackedMint ? tokenMint.equals(trackedMint) : false;
}

async function getTransferDepositAmount(args: {
  client: LoyalPrivateTransactionsClient;
  tokenMint: PublicKey;
  liquidityAmountRaw: number;
  solanaEnv: SolanaEnv;
}): Promise<bigint> {
  const liquidityAmountRaw = BigInt(args.liquidityAmountRaw);
  if (!isKaminoUsdcMint(args.tokenMint, args.solanaEnv)) {
    return liquidityAmountRaw;
  }

  const collateralSharesAmountRaw =
    await args.client.getKaminoCollateralSharesForLiquidityAmount({
      tokenMint: args.tokenMint,
      liquidityAmountRaw,
    });
  if (collateralSharesAmountRaw === null) {
    throw new Error(
      "Could not quote the current USDC shielded exchange rate. Please retry."
    );
  }
  return collateralSharesAmountRaw;
}

function appendBaseSetupTransaction(
  plan: ShieldFlowPlan,
  setupTransaction: ShieldFlowTransactionPlan | null
): void {
  if (!setupTransaction) {
    return;
  }

  const lastBaseTransaction = [...plan.transactions]
    .reverse()
    .find((transaction) => transaction.cluster === "base");

  if (!lastBaseTransaction) {
    plan.transactions.push(setupTransaction);
    return;
  }

  lastBaseTransaction.instructions.push(...setupTransaction.instructions);
  lastBaseTransaction.checks = [
    ...(lastBaseTransaction.checks ?? []),
    ...(setupTransaction.checks ?? []),
  ];
  lastBaseTransaction.postSendOwnerChange ??=
    setupTransaction.postSendOwnerChange;
}

async function buildWalletRecipientTransferPlan(args: {
  client: LoyalPrivateTransactionsClient;
  connection: Connection;
  destination: PublicKey;
  tokenMint: PublicKey;
  user: PublicKey;
  payer: PublicKey;
  validator: PublicKey;
  amount: bigint;
}): Promise<{
  setupTransaction: ShieldFlowTransactionPlan | null;
  transferTransaction: ShieldFlowTransactionPlan;
}> {
  const {
    client,
    connection,
    destination,
    tokenMint,
    user,
    payer,
    validator,
    amount,
  } = args;
  const [destinationDepositPda] = findDepositPda(destination, tokenMint);
  const destinationInfo = await connection.getAccountInfo(
    destinationDepositPda
  );
  const setupInstructions: ShieldFlowTransactionPlan["instructions"] = [];
  const setupChecks: ShieldFlowTransactionPlan["checks"] = [];

  if (!destinationInfo) {
    const initializeDeposit = await initializeDepositIx(client.baseProgram, {
      tokenMint,
      user: destination,
      payer,
    });
    setupInstructions.push({
      label: "initializeRecipientDeposit",
      ix: initializeDeposit.ix,
    });
    setupChecks.push(...initializeDeposit.ensure);
  }

  if (!destinationInfo?.owner.equals(DELEGATION_PROGRAM_ID)) {
    const delegateDeposit = await delegateDepositIx(client.baseProgram, {
      tokenMint,
      user: destination,
      payer,
      validator,
      passNotExist: true,
    });
    setupInstructions.push({
      label: "delegateRecipientDeposit",
      ix: delegateDeposit.ix,
    });
    setupChecks.push(...delegateDeposit.ensure);
  }

  const transfer = await transferDepositIx(client.ephemeralProgram, {
    user,
    tokenMint,
    destinationUser: destination,
    amount,
    payer,
  });

  return {
    setupTransaction:
      setupInstructions.length > 0
        ? {
            label: "privateSend:prepareRecipientDeposit",
            cluster: "base",
            instructions: setupInstructions,
            checks: setupChecks,
            postSendOwnerChange: {
              address: destinationDepositPda,
              owner: DELEGATION_PROGRAM_ID,
              bestEffort: true,
            },
          }
        : null,
    transferTransaction: {
      label: "privateSend:transferDeposit",
      cluster: "ephemeral",
      instructions: [{ label: "transferDeposit", ix: transfer.ix }],
      checks: transfer.ensure,
    },
  };
}

async function buildTelegramRecipientTransferPlan(args: {
  client: LoyalPrivateTransactionsClient;
  connection: Connection;
  username: string;
  tokenMint: PublicKey;
  user: PublicKey;
  payer: PublicKey;
  validator: PublicKey;
  amount: bigint;
}): Promise<{
  setupTransaction: ShieldFlowTransactionPlan | null;
  transferTransaction: ShieldFlowTransactionPlan;
}> {
  const {
    client,
    connection,
    username,
    tokenMint,
    user,
    payer,
    validator,
    amount,
  } = args;
  const [usernameDepositPda] = await findUsernameDepositPda(
    username,
    tokenMint
  );
  const [baseInfo, ephemeralDeposit] = await Promise.all([
    connection.getAccountInfo(usernameDepositPda),
    client.getEphemeralUsernameDeposit(username, tokenMint).catch(() => null),
  ]);
  const setupInstructions: ShieldFlowTransactionPlan["instructions"] = [];
  const setupChecks: ShieldFlowTransactionPlan["checks"] = [];

  if (!baseInfo && !ephemeralDeposit) {
    const initializeDeposit = await initializeUsernameDepositIx(
      client.baseProgram,
      {
        tokenMint,
        username,
        payer,
      }
    );
    setupInstructions.push({
      label: "initializeRecipientUsernameDeposit",
      ix: initializeDeposit.ix,
    });
    setupChecks.push(...initializeDeposit.ensure);
  }

  if (!baseInfo?.owner.equals(DELEGATION_PROGRAM_ID)) {
    const delegateDeposit = await delegateUsernameDepositIx(
      client.baseProgram,
      {
        tokenMint,
        username,
        payer,
        validator,
        passNotExist: true,
      }
    );
    setupInstructions.push({
      label: "delegateRecipientUsernameDeposit",
      ix: delegateDeposit.ix,
    });
    setupChecks.push(...delegateDeposit.ensure);
  }

  const transfer = await transferToUsernameDepositIx(client.ephemeralProgram, {
    username,
    user,
    tokenMint,
    amount,
    payer,
  });

  return {
    setupTransaction:
      setupInstructions.length > 0
        ? {
            label: "privateSend:prepareRecipientUsernameDeposit",
            cluster: "base",
            instructions: setupInstructions,
            checks: setupChecks,
            postSendOwnerChange: {
              address: usernameDepositPda,
              owner: DELEGATION_PROGRAM_ID,
              bestEffort: true,
            },
          }
        : null,
    transferTransaction: {
      label: "privateSend:transferToUsernameDeposit",
      cluster: "ephemeral",
      instructions: [
        { label: "transferToUsernameDeposit", ix: transfer.ix },
      ],
      checks: transfer.ensure,
    },
  };
}

export function usePrivateSend(
  signer: WalletSigner | null,
  connection: Connection,
  solanaEnv: SolanaEnv
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<LoyalPrivateTransactionsClient | null>(null);

  const getClient =
    useCallback(async (): Promise<LoyalPrivateTransactionsClient> => {
      if (clientRef.current) return clientRef.current;

      if (!signer || !signer.signMessage) {
        throw new Error(
          "Wallet must support signTransaction, signAllTransactions, and signMessage for private send"
        );
      }

      const { rpcEndpoint, websocketEndpoint } = getSolanaEndpoints(solanaEnv);
      const { perRpcEndpoint, perWsEndpoint } = getPerEndpoints(solanaEnv);

      const walletLike = {
        publicKey: signer.publicKey,
        signTransaction: signer.signTransaction.bind(signer),
        signAllTransactions: signer.signAllTransactions.bind(signer),
        signMessage: signer.signMessage.bind(signer),
      } as unknown as import("@loyal-labs/private-transactions").WalletLike;

      const client = await LoyalPrivateTransactionsClient.fromConfig({
        signer: walletLike,
        baseRpcEndpoint: rpcEndpoint,
        baseWsEndpoint: websocketEndpoint,
        ephemeralRpcEndpoint: perRpcEndpoint,
        ephemeralWsEndpoint: perWsEndpoint,
      });

      clientRef.current = client;
      return client;
    }, [signer, solanaEnv]);

  // Reset client when wallet changes
  const prevPubkey = useRef(signer?.publicKey.toBase58());
  if (signer?.publicKey.toBase58() !== prevPubkey.current) {
    clientRef.current = null;
    prevPubkey.current = signer?.publicKey.toBase58();
  }

  const executePrivateSend = useCallback(
    async (params: {
      tokenSymbol: string;
      amount: number;
      recipient: string;
      recipientType: "wallet" | "telegram";
      tokenMint?: string;
    }): Promise<PrivateSendResult> => {
      if (!signer) {
        return {
          success: false,
          error: "Wallet not connected or missing signing capability",
        };
      }

      setLoading(true);
      setError(null);

      try {
        const client = await getClient();
        const resolvedMint =
          params.tokenMint || TOKEN_MINTS[params.tokenSymbol.toUpperCase()];
        if (!resolvedMint) {
          throw new Error(`Unknown token: ${params.tokenSymbol}`);
        }
        const tokenMint = new PublicKey(resolvedMint);
        const decimals = TOKEN_DECIMALS[params.tokenSymbol.toUpperCase()] ?? 6;
        const rawAmount = Math.floor(params.amount * 10 ** decimals);
        const user = signer.publicKey;
        const validator = getErValidatorForSolanaEnv(solanaEnv);
        const transferAmount = await getTransferDepositAmount({
          client,
          tokenMint,
          liquidityAmountRaw: rawAmount,
          solanaEnv,
        });

        // 1. Check ephemeral balance - skip shield if sufficient
        const existingDeposit = await client.getEphemeralDeposit(
          user,
          tokenMint
        );
        const existingBalance = existingDeposit?.amount ?? BigInt(0);
        const needsShield = existingBalance < transferAmount;
        const plan = needsShield
          ? await client.buildShieldTokensTransactionPlan({
              tokenMint,
              amount: BigInt(rawAmount),
              user,
              payer: user,
              magicProgram: MAGIC_PROGRAM_ID,
              magicContext: MAGIC_CONTEXT_ID,
            })
          : ({
              kind: "shield",
              user,
              payer: user,
              tokenMint,
              amount: transferAmount,
              transactions: [],
            } satisfies ShieldFlowPlan);

        if (params.recipientType === "telegram") {
          const username = params.recipient.toLowerCase();
          const { setupTransaction, transferTransaction } =
            await buildTelegramRecipientTransferPlan({
              client,
              connection,
              tokenMint,
              username,
              user,
              payer: user,
              validator,
              amount: transferAmount,
            });
          appendBaseSetupTransaction(plan, setupTransaction);
          plan.transactions.push(transferTransaction);
        } else {
          const destination = new PublicKey(params.recipient);
          const { setupTransaction, transferTransaction } =
            await buildWalletRecipientTransferPlan({
              client,
              connection,
              destination,
              tokenMint,
              user,
              payer: user,
              validator,
              amount: transferAmount,
            });
          appendBaseSetupTransaction(plan, setupTransaction);
          plan.transactions.push(transferTransaction);
        }

        const executionResult = await client.executeShieldFlowTransactionPlan({
          plan,
        });

        setLoading(false);
        return { signature: getLastSignature(executionResult), success: true };
      } catch (err) {
        let errorMessage = "Private send failed";
        if (err instanceof Error) {
          errorMessage = err.message.includes("User rejected")
            ? "Transaction was rejected in your wallet."
            : cleanSolanaErrorMessage(err.message);
        }
        setError(errorMessage);
        setLoading(false);
        return { success: false, error: errorMessage };
      }
    },
    [signer, connection, getClient, solanaEnv]
  );

  return { executePrivateSend, loading, error };
}
