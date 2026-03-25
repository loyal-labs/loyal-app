import {
	DELEGATION_PROGRAM_ID,
	findDepositPda,
	getErValidatorForSolanaEnv,
	LoyalPrivateTransactionsClient,
	MAGIC_CONTEXT_ID,
	MAGIC_PROGRAM_ID,
} from "@loyal-labs/private-transactions";
import {
	type SolanaEnv,
	getPerEndpoints,
	getSolanaEndpoints,
} from "@loyal-labs/solana-rpc";
import {
	getAssociatedTokenAddressSync,
	NATIVE_MINT,
	TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useRef, useState } from "react";

import { TOKEN_DECIMALS, TOKEN_MINTS } from "../constants/token-mints";
import { closeWsolAta, wrapSolToWSol } from "../lib/solana/wsol-adapter";
import type { WalletSigner } from "../types/signer";

export type ShieldResult = {
	signature?: string;
	success: boolean;
	error?: string;
};

async function waitForAccount(
	connection: Connection,
	pda: PublicKey,
	maxAttempts = 30,
): Promise<void> {
	for (let i = 0; i < maxAttempts; i++) {
		const info = await connection.getAccountInfo(pda);
		if (info) return;
		await new Promise((r) => setTimeout(r, 500));
	}
}

export function useShield(
	signer: WalletSigner | null,
	connection: Connection,
	solanaEnv: SolanaEnv,
) {
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const clientRef = useRef<LoyalPrivateTransactionsClient | null>(null);

	const getClient =
		useCallback(async (): Promise<LoyalPrivateTransactionsClient> => {
			if (clientRef.current) return clientRef.current;

			if (!signer || !signer.signMessage) {
				throw new Error(
					"Wallet must support signTransaction, signAllTransactions, and signMessage",
				);
			}

			const { rpcEndpoint, websocketEndpoint } =
				getSolanaEndpoints(solanaEnv);
			const { perRpcEndpoint, perWsEndpoint } =
				getPerEndpoints(solanaEnv);

			const walletLike = {
				publicKey: signer.publicKey,
				signTransaction: signer.signTransaction.bind(signer),
				signAllTransactions: signer.signAllTransactions.bind(signer),
				signMessage: signer.signMessage.bind(signer),
			} as unknown as import("@loyal-labs/private-transactions").WalletLike;

			const client =
				await LoyalPrivateTransactionsClient.fromConfig({
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

	const executeShield = useCallback(
		async (params: {
			tokenSymbol: string;
			amount: number;
			tokenMint?: string;
		}): Promise<ShieldResult> => {
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
					params.tokenMint ||
					TOKEN_MINTS[params.tokenSymbol.toUpperCase()];
				if (!resolvedMint) {
					throw new Error(
						`Unknown token: ${params.tokenSymbol}`,
					);
				}
				const tokenMint = new PublicKey(resolvedMint);
				const decimals =
					TOKEN_DECIMALS[params.tokenSymbol.toUpperCase()] ?? 6;
				const rawAmount = Math.floor(
					params.amount * 10 ** decimals,
				);
				const user = signer.publicKey;
				const validator = getErValidatorForSolanaEnv(solanaEnv);
				const isNativeSol = tokenMint.equals(NATIVE_MINT);

				// Init deposit if needed
				const baseDeposit = await client.getBaseDeposit(
					user,
					tokenMint,
				);
				if (!baseDeposit) {
					await client.initializeDeposit({
						tokenMint,
						user,
						payer: user,
					});
					const [depositPda] = findDepositPda(user, tokenMint);
					await waitForAccount(connection, depositPda);
				}

				// Wrap SOL -> wSOL if native
				const walletSigner = {
					publicKey: user,
					signTransaction: signer.signTransaction.bind(signer),
				};
				let createdAta = false;
				if (isNativeSol) {
					const result = await wrapSolToWSol({
						connection,
						wallet: walletSigner,
						lamports: rawAmount,
					});
					createdAta = result.createdAta;
				}

				// Undelegate if currently delegated
				const [depositPda] = findDepositPda(user, tokenMint);
				const depositInfo =
					await connection.getAccountInfo(depositPda);
				if (depositInfo?.owner.equals(DELEGATION_PROGRAM_ID)) {
					await client.undelegateDeposit({
						tokenMint,
						user,
						payer: user,
						magicProgram: MAGIC_PROGRAM_ID,
						magicContext: MAGIC_CONTEXT_ID,
					});
				}

				// Move tokens into deposit vault (increase balance)
				await client.modifyBalance({
					tokenMint,
					amount: rawAmount,
					increase: true,
					user,
					payer: user,
				});

				// Close wSOL ATA if we created it
				if (isNativeSol && createdAta) {
					const userTokenAccount = getAssociatedTokenAddressSync(
						tokenMint,
						user,
						false,
						TOKEN_PROGRAM_ID,
					);
					await closeWsolAta({
						connection,
						wallet: walletSigner,
						wsolAta: userTokenAccount,
					});
				}

				// Create permission (may already exist)
				try {
					await client.createPermission({
						tokenMint,
						user,
						payer: user,
					});
				} catch {
					// Permission may already exist
				}

				// Delegate deposit
				try {
					await client.delegateDeposit({
						tokenMint,
						user,
						payer: user,
						validator,
					});
				} catch {
					// May already be delegated
				}

				setLoading(false);
				return { success: true };
			} catch (err) {
				let errorMessage = "Shield failed";
				if (err instanceof Error) {
					errorMessage = err.message.includes("User rejected")
						? "Transaction was rejected in your wallet."
						: err.message;
				}
				setError(errorMessage);
				setLoading(false);
				return { success: false, error: errorMessage };
			}
		},
		[signer, connection, getClient, solanaEnv],
	);

	const executeUnshield = useCallback(
		async (params: {
			tokenSymbol: string;
			amount: number;
			tokenMint?: string;
		}): Promise<ShieldResult> => {
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
					params.tokenMint ||
					TOKEN_MINTS[params.tokenSymbol.toUpperCase()];
				if (!resolvedMint) {
					throw new Error(
						`Unknown token: ${params.tokenSymbol}`,
					);
				}
				const tokenMint = new PublicKey(resolvedMint);
				const decimals =
					TOKEN_DECIMALS[params.tokenSymbol.toUpperCase()] ?? 6;
				const rawAmount = Math.floor(
					params.amount * 10 ** decimals,
				);
				const user = signer.publicKey;
				const isNativeSol = tokenMint.equals(NATIVE_MINT);

				// Undelegate if currently delegated
				const [depositPda] = findDepositPda(user, tokenMint);
				const depositInfo =
					await connection.getAccountInfo(depositPda);
				if (depositInfo?.owner.equals(DELEGATION_PROGRAM_ID)) {
					await client.undelegateDeposit({
						tokenMint,
						user,
						payer: user,
						magicProgram: MAGIC_PROGRAM_ID,
						magicContext: MAGIC_CONTEXT_ID,
					});
				}

				// Move tokens out of deposit vault (decrease balance)
				await client.modifyBalance({
					tokenMint,
					amount: rawAmount,
					increase: false,
					user,
					payer: user,
				});

				// Unwrap wSOL if native SOL
				if (isNativeSol) {
					const walletSigner = {
						publicKey: user,
						signTransaction:
							signer.signTransaction.bind(signer),
          };
					const userTokenAccount = getAssociatedTokenAddressSync(
						tokenMint,
						user,
						false,
						TOKEN_PROGRAM_ID,
					);
					await closeWsolAta({
						connection,
						wallet: walletSigner,
						wsolAta: userTokenAccount,
					});
				}

				// Re-delegate deposit
				try {
					const validator =
						getErValidatorForSolanaEnv(solanaEnv);
					await client.delegateDeposit({
						tokenMint,
						user,
						payer: user,
						validator,
					});
				} catch {
					// May already be delegated or deposit empty
				}

				setLoading(false);
				return { success: true };
			} catch (err) {
				let errorMessage = "Unshield failed";
				if (err instanceof Error) {
					errorMessage = err.message.includes("User rejected")
						? "Transaction was rejected in your wallet."
						: err.message;
				}
				setError(errorMessage);
				setLoading(false);
				return { success: false, error: errorMessage };
			}
		},
		[signer, connection, getClient, solanaEnv],
	);

	return { executeShield, executeUnshield, loading, error };
}
