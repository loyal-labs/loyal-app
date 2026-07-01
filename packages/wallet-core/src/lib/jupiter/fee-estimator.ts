import { ACCOUNT_SIZE, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
	ComputeBudgetProgram,
	type Connection,
	PublicKey,
	VersionedTransaction,
} from "@solana/web3.js";
import { Buffer } from "buffer";

import {
	deserializeJupiterSwapTransaction,
	getJupiterSwapInstructions,
	getJupiterSwapTransaction,
} from "./client";
import type {
	JupiterInstruction,
	JupiterQuoteResponse,
	JupiterSwapInstructionsResponse,
	JupiterSwapResponse,
	SwapCreatedAtaRentEntry,
	SwapFeeEstimate,
	SwapFeeEstimateState,
	SwapFeeSimulationResult,
} from "./types";

export type SwapFeeEstimateConnection = Pick<
	Connection,
	| "getFeeForMessage"
	| "getMinimumBalanceForRentExemption"
	| "getMultipleAccountsInfo"
	| "simulateTransaction"
>;

type EstimateSwapTransactionFeeParams = {
	connection: SwapFeeEstimateConnection;
	transaction?: VersionedTransaction | string;
	swapResponse?: Pick<
		JupiterSwapResponse,
		"prioritizationFeeLamports" | "swapTransaction"
	>;
	swapInstructions?: Pick<JupiterSwapInstructionsResponse, "setupInstructions">;
	userPublicKey?: PublicKey | string | { toBase58(): string };
	commitment?: "processed" | "confirmed" | "finalized";
};

type EstimateJupiterSwapFeeStateParams = {
	connection: SwapFeeEstimateConnection;
	quoteResponse: JupiterQuoteResponse;
	userPublicKey: PublicKey | string | { toBase58(): string };
	apiKey?: string;
	baseUrl?: string;
	fetchFn?: typeof fetch;
	signal?: AbortSignal;
	commitment?: "processed" | "confirmed" | "finalized";
};

const SOLANA_SIGNATURE_FEE_LAMPORTS = 5_000;
const MICRO_LAMPORTS_PER_LAMPORT = 1_000_000n;
export const SWAP_FEE_ESTIMATE_DEBOUNCE_MS = 700;
const SWAP_FEE_ESTIMATE_SUCCESS_CACHE_MS = 20_000;
const SWAP_FEE_ESTIMATE_ERROR_CACHE_MS = 3_000;

type SwapFeeEstimateCacheEntry = {
	state: SwapFeeEstimateState;
	expiresAt: number;
};

const feeEstimateStateCache = new Map<string, SwapFeeEstimateCacheEntry>();
const feeEstimateStateInflight = new Map<
	string,
	Promise<SwapFeeEstimateState>
>();

const getPublicKeyString = (
	value?: PublicKey | string | { toBase58(): string }
): string | null => {
	if (!value) return null;
	if (typeof value === "string") return value;
	return value.toBase58();
};

const getConnectionCacheKey = (connection: SwapFeeEstimateConnection): string => {
	const maybeConnection = connection as SwapFeeEstimateConnection & {
		rpcEndpoint?: string;
	};
	return maybeConnection.rpcEndpoint ?? "connection";
};

export const getJupiterSwapFeeEstimateKey = (params: {
	connection?: SwapFeeEstimateConnection;
	quoteResponse: JupiterQuoteResponse;
	userPublicKey: PublicKey | string | { toBase58(): string };
	baseUrl?: string;
	commitment?: "processed" | "confirmed" | "finalized";
}): string => {
	const { quoteResponse } = params;
	const routePlan = quoteResponse.routePlan.map((route) => ({
		percent: route.percent,
		swapInfo: {
			ammKey: route.swapInfo.ammKey,
			label: route.swapInfo.label,
			inputMint: route.swapInfo.inputMint,
			outputMint: route.swapInfo.outputMint,
			inAmount: route.swapInfo.inAmount,
			outAmount: route.swapInfo.outAmount,
			feeAmount: route.swapInfo.feeAmount,
			feeMint: route.swapInfo.feeMint,
		},
	}));

	return JSON.stringify({
		baseUrl: params.baseUrl ?? null,
		commitment: params.commitment ?? "confirmed",
		connection: params.connection
			? getConnectionCacheKey(params.connection)
			: null,
		userPublicKey: getPublicKeyString(params.userPublicKey),
		quote: {
			inputMint: quoteResponse.inputMint,
			inAmount: quoteResponse.inAmount,
			outputMint: quoteResponse.outputMint,
			outAmount: quoteResponse.outAmount,
			otherAmountThreshold: quoteResponse.otherAmountThreshold,
			swapMode: quoteResponse.swapMode,
			slippageBps: quoteResponse.slippageBps,
			platformFee: quoteResponse.platformFee,
			priceImpactPct: quoteResponse.priceImpactPct,
			routePlan,
		},
	});
};

const decodeBase64 = (value: string): Uint8Array => {
	return new Uint8Array(Buffer.from(value, "base64"));
};

const readLittleEndianU32 = (data: Uint8Array, offset: number): number => {
	let value = 0;
	for (let index = 0; index < 4; index += 1) {
		value += (data[offset + index] ?? 0) * 2 ** (8 * index);
	}
	return value;
};

const readLittleEndianU64 = (data: Uint8Array, offset: number): bigint => {
	let value = 0n;
	for (let index = 0; index < 8; index += 1) {
		value += BigInt(data[offset + index] ?? 0) << BigInt(8 * index);
	}
	return value;
};

const toTransaction = (
	transaction?: VersionedTransaction | string,
	swapResponse?: Pick<JupiterSwapResponse, "swapTransaction">
): VersionedTransaction => {
	if (transaction instanceof VersionedTransaction) {
		return transaction;
	}
	if (typeof transaction === "string") {
		return deserializeJupiterSwapTransaction(transaction);
	}
	if (swapResponse?.swapTransaction) {
		return deserializeJupiterSwapTransaction(swapResponse.swapTransaction);
	}
	throw new Error("Swap transaction is required for fee estimation");
};

type ParsedAtaCreate = Omit<
	SwapCreatedAtaRentEntry,
	"alreadyExisted" | "paidByUser" | "rentLamports"
>;

const parseAssociatedTokenCreate = (params: {
	programId: string;
	accounts: string[];
	data: Uint8Array;
	instructionSource: "swap-instructions" | "transaction";
}): ParsedAtaCreate | null => {
	if (params.programId !== ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()) {
		return null;
	}

	const tag = params.data[0] ?? 0;
	const isCreate =
		params.data.length === 0 ||
		tag === 0 ||
		(tag === 1 && params.data.length === 1);
	if (!isCreate || params.accounts.length < 6) {
		return null;
	}

	return {
		payer: params.accounts[0],
		address: params.accounts[1],
		owner: params.accounts[2],
		mint: params.accounts[3],
		tokenProgramId: params.accounts[5],
		instructionSource: params.instructionSource,
	};
};

const getStaticAccountKeys = (transaction: VersionedTransaction): string[] => {
	const message = transaction.message as typeof transaction.message & {
		accountKeys?: PublicKey[];
		staticAccountKeys?: PublicKey[];
	};
	const keys = message.staticAccountKeys ?? message.accountKeys ?? [];
	return keys.map((key) => key.toBase58());
};

const getCompiledInstructions = (transaction: VersionedTransaction) => {
	const message = transaction.message as typeof transaction.message & {
		compiledInstructions?: Array<{
			programIdIndex: number;
			accountKeyIndexes?: number[];
			accounts?: number[];
			data: Uint8Array;
		}>;
		instructions?: Array<{
			programIdIndex: number;
			accountKeyIndexes?: number[];
			accounts?: number[];
			data: Uint8Array;
		}>;
	};
	return message.compiledInstructions ?? message.instructions ?? [];
};

const getCreatedAtasFromTransaction = (
	transaction: VersionedTransaction
): ParsedAtaCreate[] => {
	const accountKeys = getStaticAccountKeys(transaction);
	const instructions = getCompiledInstructions(transaction);
	const entries: ParsedAtaCreate[] = [];

	for (const instruction of instructions) {
		const programId = accountKeys[instruction.programIdIndex];
		if (!programId) continue;
		const accountIndexes =
			instruction.accountKeyIndexes ?? instruction.accounts ?? [];
		const accounts = accountIndexes
			.map((index) => accountKeys[index])
			.filter((account): account is string => Boolean(account));
		const parsed = parseAssociatedTokenCreate({
			programId,
			accounts,
			data: instruction.data,
			instructionSource: "transaction",
		});
		if (parsed) entries.push(parsed);
	}

	return entries;
};

const getCreatedAtasFromSetupInstructions = (
	swapInstructions?: Pick<JupiterSwapInstructionsResponse, "setupInstructions">
): ParsedAtaCreate[] => {
	const instructions = swapInstructions?.setupInstructions ?? [];
	return instructions
		.map((instruction: JupiterInstruction) =>
			parseAssociatedTokenCreate({
				programId: instruction.programId,
				accounts: instruction.accounts.map((account) => account.pubkey),
				data: instruction.data
					? decodeBase64(instruction.data)
					: new Uint8Array(),
				instructionSource: "swap-instructions",
			})
		)
		.filter((entry): entry is ParsedAtaCreate => Boolean(entry));
};

const dedupeCreatedAtas = (entries: ParsedAtaCreate[]): ParsedAtaCreate[] => {
	const byAddress = new Map<string, ParsedAtaCreate>();
	for (const entry of entries) {
		if (!byAddress.has(entry.address)) {
			byAddress.set(entry.address, entry);
		}
	}
	return [...byAddress.values()];
};

const getRentEntries = async (params: {
	connection: SwapFeeEstimateConnection;
	transaction: VersionedTransaction;
	swapInstructions?: Pick<JupiterSwapInstructionsResponse, "setupInstructions">;
	userPublicKey: string | null;
}): Promise<{
	rentLamports: number;
	createdAtaAccounts: SwapCreatedAtaRentEntry[];
}> => {
	const parsedEntries = dedupeCreatedAtas([
		...getCreatedAtasFromSetupInstructions(params.swapInstructions),
		...getCreatedAtasFromTransaction(params.transaction),
	]).filter(
		(entry) => !params.userPublicKey || entry.payer === params.userPublicKey
	);

	if (parsedEntries.length === 0) {
		return { rentLamports: 0, createdAtaAccounts: [] };
	}

	const rentExemptionLamports =
		await params.connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE);
	const existingAccounts = await params.connection.getMultipleAccountsInfo(
		parsedEntries.map((entry) => new PublicKey(entry.address))
	);

	let rentLamports = 0;
	const createdAtaAccounts = parsedEntries.map((entry, index) => {
		const alreadyExisted = existingAccounts[index] !== null;
		const entryRentLamports = alreadyExisted ? 0 : rentExemptionLamports;
		rentLamports += entryRentLamports;
		return {
			...entry,
			rentLamports: entryRentLamports,
			alreadyExisted,
			paidByUser: !params.userPublicKey || entry.payer === params.userPublicKey,
		};
	});

	return { rentLamports, createdAtaAccounts };
};

const getSignatureFeeFallback = (transaction: VersionedTransaction): number => {
	const message = transaction.message as typeof transaction.message & {
		header?: { numRequiredSignatures: number };
	};
	return (
		(message.header?.numRequiredSignatures ?? transaction.signatures.length) *
		SOLANA_SIGNATURE_FEE_LAMPORTS
	);
};

const estimatePrioritizationFeeFromMessage = (
	transaction: VersionedTransaction
): number | null => {
	const accountKeys = getStaticAccountKeys(transaction);
	const instructions = getCompiledInstructions(transaction);
	let computeUnitLimit: number | null = null;
	let microLamportsPerUnit: bigint | null = null;

	for (const instruction of instructions) {
		const programId = accountKeys[instruction.programIdIndex];
		if (programId !== ComputeBudgetProgram.programId.toBase58()) {
			continue;
		}
		const data = instruction.data;
		if (data[0] === 2 && data.length >= 5) {
			computeUnitLimit = readLittleEndianU32(data, 1);
		}
		if (data[0] === 3 && data.length >= 9) {
			microLamportsPerUnit = readLittleEndianU64(data, 1);
		}
	}

	if (computeUnitLimit === null || microLamportsPerUnit === null) {
		return null;
	}

	const lamports =
		(BigInt(computeUnitLimit) * microLamportsPerUnit +
			MICRO_LAMPORTS_PER_LAMPORT -
			1n) /
		MICRO_LAMPORTS_PER_LAMPORT;
	return Number(lamports);
};

const simulateSwapTransaction = async (params: {
	connection: SwapFeeEstimateConnection;
	transaction: VersionedTransaction;
	commitment: "processed" | "confirmed" | "finalized";
}): Promise<SwapFeeSimulationResult> => {
	try {
		const simulation = await params.connection.simulateTransaction(
			params.transaction,
			{
				commitment: params.commitment,
				replaceRecentBlockhash: true,
				sigVerify: false,
			}
		);
		return {
			status: simulation.value.err ? "failed" : "passed",
			error: simulation.value.err ?? null,
			unitsConsumed: simulation.value.unitsConsumed ?? null,
			logs: simulation.value.logs ?? null,
		};
	} catch (error) {
		return {
			status: "failed",
			error,
			unitsConsumed: null,
			logs: null,
		};
	}
};

export const getSwapFeeEstimateState = (
	estimate: SwapFeeEstimate
): SwapFeeEstimateState => {
	if (estimate.simulation.status === "passed") {
		return { status: "success", estimate };
	}

	return {
		status: "error",
		error: "Swap fee simulation failed",
	};
};

export const getSwapFeeEstimateErrorState = (
	error: unknown
): SwapFeeEstimateState => ({
	status: "error",
	error: error instanceof Error ? error.message : "Swap fee unavailable",
});

const getCachedFeeEstimateState = (
	key: string,
	now = Date.now()
): SwapFeeEstimateState | null => {
	const entry = feeEstimateStateCache.get(key);
	if (!entry) return null;
	if (entry.expiresAt < now) {
		feeEstimateStateCache.delete(key);
		return null;
	}
	return entry.state;
};

const getCachedSuccessfulFeeEstimateState = (
	key: string
): SwapFeeEstimateState | null => {
	const entry = feeEstimateStateCache.get(key);
	return entry?.state.status === "success" ? entry.state : null;
};

const isAbortError = (error: unknown): boolean =>
	error instanceof Error && error.name === "AbortError";

const setCachedFeeEstimateState = (
	key: string,
	state: SwapFeeEstimateState,
	now = Date.now()
) => {
	feeEstimateStateCache.set(key, {
		state,
		expiresAt:
			now +
			(state.status === "success"
				? SWAP_FEE_ESTIMATE_SUCCESS_CACHE_MS
				: SWAP_FEE_ESTIMATE_ERROR_CACHE_MS),
	});
};

export async function estimateSwapTransactionFee(
	params: EstimateSwapTransactionFeeParams
): Promise<SwapFeeEstimate> {
	const transaction = toTransaction(params.transaction, params.swapResponse);
	const commitment = params.commitment ?? "confirmed";
	const [feeForMessage, rent, simulation] = await Promise.all([
		params.connection.getFeeForMessage(transaction.message, commitment),
		getRentEntries({
			connection: params.connection,
			transaction,
			swapInstructions: params.swapInstructions,
			userPublicKey: getPublicKeyString(params.userPublicKey),
		}),
		simulateSwapTransaction({
			connection: params.connection,
			transaction,
			commitment,
		}),
	]);
	const transactionFeeLamports =
		feeForMessage.value ?? getSignatureFeeFallback(transaction);
	const prioritizationFeeLamports =
		params.swapResponse?.prioritizationFeeLamports ??
		estimatePrioritizationFeeFromMessage(transaction);

	return {
		totalLamports: transactionFeeLamports + rent.rentLamports,
		transactionFeeLamports,
		prioritizationFeeLamports,
		prioritizationFeeIncludedInTransactionFee:
			prioritizationFeeLamports !== null,
		rentLamports: rent.rentLamports,
		createdAtaAccounts: rent.createdAtaAccounts,
		simulation,
	};
}

export async function estimateJupiterSwapFeeState(
	params: EstimateJupiterSwapFeeStateParams
): Promise<SwapFeeEstimateState> {
	const cacheKey = getJupiterSwapFeeEstimateKey(params);
	const cachedState = getCachedFeeEstimateState(cacheKey);
	if (cachedState) {
		return cachedState;
	}

	const inflight = feeEstimateStateInflight.get(cacheKey);
	if (inflight) {
		return inflight;
	}

	if (params.signal?.aborted) {
		return { status: "idle" };
	}

	const request = estimateUncachedJupiterSwapFeeState(params, cacheKey);
	feeEstimateStateInflight.set(cacheKey, request);
	request.finally(() => {
		feeEstimateStateInflight.delete(cacheKey);
	});
	return request;
}

async function estimateUncachedJupiterSwapFeeState(
	params: EstimateJupiterSwapFeeStateParams,
	cacheKey: string
): Promise<SwapFeeEstimateState> {
	try {
		const userPublicKey = getPublicKeyString(params.userPublicKey);
		if (!userPublicKey) {
			throw new Error("User public key is required for swap fee estimation");
		}

		const [swapResponse, swapInstructions] = await Promise.all([
			getJupiterSwapTransaction({
				quoteResponse: params.quoteResponse,
				userPublicKey,
				apiKey: params.apiKey,
				baseUrl: params.baseUrl,
				fetchFn: params.fetchFn,
				signal: params.signal,
			}),
			getJupiterSwapInstructions({
				quoteResponse: params.quoteResponse,
				userPublicKey,
				apiKey: params.apiKey,
				baseUrl: params.baseUrl,
				fetchFn: params.fetchFn,
				signal: params.signal,
			}).catch(() => undefined),
		]);
		if (params.signal?.aborted) {
			return { status: "idle" };
		}
		const estimate = await estimateSwapTransactionFee({
			connection: params.connection,
			swapResponse,
			swapInstructions,
			userPublicKey,
			commitment: params.commitment,
		});

		const state = getSwapFeeEstimateState(estimate);
		setCachedFeeEstimateState(cacheKey, state);
		return state;
	} catch (error) {
		if (params.signal?.aborted || isAbortError(error)) {
			return { status: "idle" };
		}
		const fallbackState = getCachedSuccessfulFeeEstimateState(cacheKey);
		if (fallbackState) {
			return fallbackState;
		}
		const state = getSwapFeeEstimateErrorState(error);
		setCachedFeeEstimateState(cacheKey, state);
		return state;
	}
}
