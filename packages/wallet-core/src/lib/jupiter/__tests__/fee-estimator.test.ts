import {
	ACCOUNT_SIZE,
	createAssociatedTokenAccountIdempotentInstruction,
	getAssociatedTokenAddressSync,
	TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
	ComputeBudgetProgram,
	Keypair,
	PublicKey,
	TransactionMessage,
	VersionedTransaction,
} from "@solana/web3.js";
import { describe, expect, test } from "bun:test";

import {
	estimateJupiterSwapFeeState,
	estimateSwapTransactionFee,
	getJupiterSwapFeeEstimateFlowKey,
	getJupiterSwapFeeEstimateKey,
	getSwapFeeEstimateDebounceMs,
	getSwapFeeEstimateDisplayState,
	isNonEmptySwapFeeEstimateState,
	SWAP_FEE_ESTIMATE_DEBOUNCE_MS,
	SWAP_FEE_ESTIMATE_RECOMPUTE_DEBOUNCE_MS,
} from "../fee-estimator";
import type { SwapFeeEstimateState } from "../types";
import type { JupiterInstruction } from "../types";

const RENT_EXEMPT_TOKEN_ACCOUNT_LAMPORTS = 2_039_280;
const MESSAGE_FEE_LAMPORTS = 7_000;
type EstimateFeeConnection = Parameters<
	typeof estimateSwapTransactionFee
>[0]["connection"];
type MultipleAccountInfos = Awaited<
	ReturnType<EstimateFeeConnection["getMultipleAccountsInfo"]>
>;
const EXISTING_ACCOUNT = {} as NonNullable<MultipleAccountInfos[number]>;

const toJupiterInstruction = (
	instruction: ReturnType<
		typeof createAssociatedTokenAccountIdempotentInstruction
	>
): JupiterInstruction => ({
	programId: instruction.programId.toBase58(),
	accounts: instruction.keys.map((account) => ({
		pubkey: account.pubkey.toBase58(),
		isSigner: account.isSigner,
		isWritable: account.isWritable,
	})),
	data: Buffer.from(instruction.data).toString("base64"),
});

const createSwapTransaction = (params: {
	payer: PublicKey;
	instructions: ReturnType<
		typeof createAssociatedTokenAccountIdempotentInstruction
	>[];
}): VersionedTransaction => {
	const message = new TransactionMessage({
		payerKey: params.payer,
		recentBlockhash: Keypair.generate().publicKey.toBase58(),
		instructions: [
			ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
			ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 2_000 }),
			...params.instructions,
		],
	}).compileToV0Message();
	return new VersionedTransaction(message);
};

const createMockConnection = (
	existingAccounts: MultipleAccountInfos = []
): EstimateFeeConnection => ({
	getFeeForMessage: async () => ({
		context: { slot: 1 },
		value: MESSAGE_FEE_LAMPORTS,
	}),
	getMinimumBalanceForRentExemption: async (size: number) => {
		expect(size).toBe(ACCOUNT_SIZE);
		return RENT_EXEMPT_TOKEN_ACCOUNT_LAMPORTS;
	},
	getMultipleAccountsInfo: async () => existingAccounts,
	simulateTransaction: async () => ({
		context: { slot: 1 },
		value: {
			err: null,
			logs: ["ok"],
			unitsConsumed: 42_000,
		},
	}),
});

const createQuoteResponse = (params?: {
	inputMint?: string;
	outputMint?: string;
	inAmount?: string;
	outAmount?: string;
	contextSlot?: number;
	timeTaken?: number;
}) => {
	const inputMint = params?.inputMint ?? Keypair.generate().publicKey.toBase58();
	const outputMint =
		params?.outputMint ?? Keypair.generate().publicKey.toBase58();
	const inAmount = params?.inAmount ?? "1000000";
	const outAmount = params?.outAmount ?? "990000";

	return {
		inputMint,
		inAmount,
		outputMint,
		outAmount,
		otherAmountThreshold: "980000",
		swapMode: "ExactIn",
		slippageBps: 50,
		platformFee: null,
		priceImpactPct: "0",
		routePlan: [
			{
				swapInfo: {
					ammKey: Keypair.generate().publicKey.toBase58(),
					label: "Test AMM",
					inputMint,
					outputMint,
					inAmount,
					outAmount,
					feeAmount: "0",
					feeMint: inputMint,
				},
				percent: 100,
			},
		],
		contextSlot: params?.contextSlot,
		timeTaken: params?.timeTaken,
	};
};

const jsonResponse = (body: unknown) =>
	new Response(JSON.stringify(body), {
		headers: { "Content-Type": "application/json" },
		status: 200,
	});

const createFeeEstimateState = (
	totalLamports: number
): Extract<SwapFeeEstimateState, { status: "success" }> => ({
	status: "success",
	estimate: {
		totalLamports,
		transactionFeeLamports: totalLamports,
		prioritizationFeeLamports: null,
		prioritizationFeeIncludedInTransactionFee: false,
		rentLamports: 0,
		createdAtaAccounts: [],
		simulation: {
			status: "passed",
			error: null,
			unitsConsumed: 1,
			logs: [],
		},
	},
});

describe("estimateSwapTransactionFee", () => {
	test("adds missing user-paid ATA rent to the simulated network fee", async () => {
		const payer = Keypair.generate().publicKey;
		const owner = payer;
		const mint = Keypair.generate().publicKey;
		const ata = getAssociatedTokenAddressSync(mint, owner);
		const createAtaInstruction =
			createAssociatedTokenAccountIdempotentInstruction(
				payer,
				ata,
				owner,
				mint,
				TOKEN_PROGRAM_ID
			);
		const transaction = createSwapTransaction({
			payer,
			instructions: [createAtaInstruction],
		});

		const estimate = await estimateSwapTransactionFee({
			connection: createMockConnection([null]),
			transaction,
			swapResponse: {
				swapTransaction: Buffer.from(transaction.serialize()).toString(
					"base64"
				),
				prioritizationFeeLamports: 123,
			},
			swapInstructions: {
				setupInstructions: [toJupiterInstruction(createAtaInstruction)],
			},
			userPublicKey: payer,
		});

		expect(estimate.simulation.status).toBe("passed");
		expect(estimate.transactionFeeLamports).toBe(MESSAGE_FEE_LAMPORTS);
		expect(estimate.prioritizationFeeLamports).toBe(123);
		expect(estimate.rentLamports).toBe(RENT_EXEMPT_TOKEN_ACCOUNT_LAMPORTS);
		expect(estimate.totalLamports).toBe(
			MESSAGE_FEE_LAMPORTS + RENT_EXEMPT_TOKEN_ACCOUNT_LAMPORTS
		);
		expect(estimate.createdAtaAccounts).toHaveLength(1);
		expect(estimate.createdAtaAccounts[0]).toMatchObject({
			address: ata.toBase58(),
			mint: mint.toBase58(),
			owner: owner.toBase58(),
			paidByUser: true,
			alreadyExisted: false,
			rentLamports: RENT_EXEMPT_TOKEN_ACCOUNT_LAMPORTS,
		});
	});

	test("does not charge ATA rent for accounts that already exist", async () => {
		const payer = Keypair.generate().publicKey;
		const owner = payer;
		const mint = Keypair.generate().publicKey;
		const ata = getAssociatedTokenAddressSync(mint, owner);
		const createAtaInstruction =
			createAssociatedTokenAccountIdempotentInstruction(
				payer,
				ata,
				owner,
				mint,
				TOKEN_PROGRAM_ID
			);
		const transaction = createSwapTransaction({
			payer,
			instructions: [createAtaInstruction],
		});

		const estimate = await estimateSwapTransactionFee({
			connection: createMockConnection([EXISTING_ACCOUNT]),
			transaction,
			swapInstructions: {
				setupInstructions: [toJupiterInstruction(createAtaInstruction)],
			},
			userPublicKey: payer,
		});

		expect(estimate.rentLamports).toBe(0);
		expect(estimate.totalLamports).toBe(MESSAGE_FEE_LAMPORTS);
		expect(estimate.createdAtaAccounts[0]?.alreadyExisted).toBe(true);
	});

	test("does not include ATA rent paid by a different payer", async () => {
		const payer = Keypair.generate().publicKey;
		const user = Keypair.generate().publicKey;
		const owner = user;
		const mint = Keypair.generate().publicKey;
		const ata = getAssociatedTokenAddressSync(mint, owner);
		const createAtaInstruction =
			createAssociatedTokenAccountIdempotentInstruction(
				payer,
				ata,
				owner,
				mint,
				TOKEN_PROGRAM_ID
			);
		const transaction = createSwapTransaction({
			payer,
			instructions: [createAtaInstruction],
		});

		const estimate = await estimateSwapTransactionFee({
			connection: createMockConnection([null]),
			transaction,
			swapInstructions: {
				setupInstructions: [toJupiterInstruction(createAtaInstruction)],
			},
			userPublicKey: user,
		});

		expect(estimate.createdAtaAccounts).toHaveLength(0);
		expect(estimate.rentLamports).toBe(0);
		expect(estimate.totalLamports).toBe(MESSAGE_FEE_LAMPORTS);
	});
});

describe("estimateJupiterSwapFeeState", () => {
	test("uses a stable key for materially identical quote responses", () => {
		const userPublicKey = Keypair.generate().publicKey;
		const quoteResponse = createQuoteResponse({
			contextSlot: 1,
			timeTaken: 0.1,
		});

		const firstKey = getJupiterSwapFeeEstimateKey({
			connection: createMockConnection(),
			quoteResponse,
			userPublicKey,
			baseUrl: "https://api.jup.ag/swap/v1",
		});
		const secondKey = getJupiterSwapFeeEstimateKey({
			connection: createMockConnection(),
			quoteResponse: {
				...quoteResponse,
				contextSlot: 2,
				timeTaken: 0.2,
			},
			userPublicKey,
			baseUrl: "https://api.jup.ag/swap/v1",
		});

		expect(secondKey).toBe(firstKey);
	});

	test("dedupes inflight swap builds and caches the completed estimate", async () => {
		const userPublicKey = Keypair.generate().publicKey;
		const quoteResponse = createQuoteResponse();
		const transaction = createSwapTransaction({
			payer: userPublicKey,
			instructions: [],
		});
		const swapTransaction = Buffer.from(transaction.serialize()).toString(
			"base64"
		);
		let swapCalls = 0;
		let instructionCalls = 0;
		const fetchFn = (async (input: Parameters<typeof fetch>[0]) => {
			const url = String(input);
			if (url.endsWith("/swap")) {
				swapCalls += 1;
				await new Promise((resolve) => setTimeout(resolve, 5));
				return jsonResponse({
					swapTransaction,
					lastValidBlockHeight: 1,
					prioritizationFeeLamports: 123,
				});
			}
			if (url.endsWith("/swap-instructions")) {
				instructionCalls += 1;
				await new Promise((resolve) => setTimeout(resolve, 5));
				return jsonResponse({
					setupInstructions: [],
					swapInstruction: {
						programId: Keypair.generate().publicKey.toBase58(),
						accounts: [],
						data: "",
					},
				});
			}
			return jsonResponse({});
		}) as typeof fetch;
		const params = {
			connection: createMockConnection(),
			quoteResponse,
			userPublicKey,
			baseUrl: "https://api.jup.ag/swap/v1",
			fetchFn,
		};

		const [firstState, secondState] = await Promise.all([
			estimateJupiterSwapFeeState(params),
			estimateJupiterSwapFeeState(params),
		]);

		expect(firstState.status).toBe("success");
		expect(secondState.status).toBe("success");
		expect(swapCalls).toBe(1);
		expect(instructionCalls).toBe(1);

		const cachedState = await estimateJupiterSwapFeeState(params);

		expect(cachedState.status).toBe("success");
		expect(swapCalls).toBe(1);
		expect(instructionCalls).toBe(1);
	});

	test("does not fetch when fee estimation is already aborted", async () => {
		const abortController = new AbortController();
		abortController.abort();
		let fetchCalls = 0;
		const fetchFn = (async (_input: Parameters<typeof fetch>[0]) => {
			fetchCalls += 1;
			return jsonResponse({});
		}) as typeof fetch;

		const state = await estimateJupiterSwapFeeState({
			connection: createMockConnection(),
			quoteResponse: createQuoteResponse(),
			userPublicKey: Keypair.generate().publicKey,
			baseUrl: "https://api.jup.ag/swap/v1",
			fetchFn,
			signal: abortController.signal,
		});

		expect(state).toEqual({ status: "idle" });
		expect(fetchCalls).toBe(0);
	});
});

describe("swap fee estimate display policy", () => {
	test("uses the longer recompute debounce after a non-empty fee estimate", () => {
		expect(getSwapFeeEstimateDebounceMs()).toBe(
			SWAP_FEE_ESTIMATE_DEBOUNCE_MS
		);
		expect(getSwapFeeEstimateDebounceMs(createFeeEstimateState(0))).toBe(
			SWAP_FEE_ESTIMATE_DEBOUNCE_MS
		);
		expect(getSwapFeeEstimateDebounceMs(createFeeEstimateState(5_000))).toBe(
			SWAP_FEE_ESTIMATE_RECOMPUTE_DEBOUNCE_MS
		);
	});

	test("retains the last non-empty fee while recomputing or after errors", () => {
		const lastSuccessfulState = createFeeEstimateState(5_000);

		expect(isNonEmptySwapFeeEstimateState(lastSuccessfulState)).toBe(true);
		expect(
			getSwapFeeEstimateDisplayState(
				{ status: "loading" },
				lastSuccessfulState
			)
		).toBe(lastSuccessfulState);
		expect(
			getSwapFeeEstimateDisplayState(
				{ status: "error", error: "rate limited" },
				lastSuccessfulState
			)
		).toBe(lastSuccessfulState);
		expect(
			getSwapFeeEstimateDisplayState({ status: "idle" }, lastSuccessfulState)
		).toBe(lastSuccessfulState);
		expect(
			getSwapFeeEstimateDisplayState({ status: "loading" }, null)
		).toEqual({ status: "loading" });
	});

	test("keys retained display state by token pair and user, not amount", () => {
		const userPublicKey = Keypair.generate().publicKey;
		const inputMint = Keypair.generate().publicKey.toBase58();
		const outputMint = Keypair.generate().publicKey.toBase58();
		const baseParams = {
			inputMint,
			outputMint,
			userPublicKey,
			baseUrl: "https://api.jup.ag/swap/v1",
		};

		expect(getJupiterSwapFeeEstimateFlowKey(baseParams)).toBe(
			getJupiterSwapFeeEstimateFlowKey(baseParams)
		);
		expect(getJupiterSwapFeeEstimateFlowKey(baseParams)).not.toBe(
			getJupiterSwapFeeEstimateFlowKey({
				...baseParams,
				outputMint: Keypair.generate().publicKey.toBase58(),
			})
		);
		expect(
			getJupiterSwapFeeEstimateFlowKey({
				...baseParams,
				userPublicKey: null,
			})
		).toBeNull();
	});
});
