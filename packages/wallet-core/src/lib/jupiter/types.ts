export type JupiterQuoteResponse = {
	inputMint: string;
	inAmount: string;
	outputMint: string;
	outAmount: string;
	otherAmountThreshold: string;
	swapMode: string;
	slippageBps: number;
	platformFee: null | {
		amount: string;
		feeBps: number;
	};
	priceImpactPct: string;
	routePlan: Array<{
		swapInfo: {
			ammKey: string;
			label: string;
			inputMint: string;
			outputMint: string;
			inAmount: string;
			outAmount: string;
			feeAmount: string;
			feeMint: string;
		};
		percent: number;
	}>;
	contextSlot?: number;
	timeTaken?: number;
};

export type JupiterSwapResponse = {
	swapTransaction: string;
	lastValidBlockHeight: number;
	prioritizationFeeLamports: number;
	computeUnitLimit?: number;
	prioritizationType?: unknown;
	dynamicSlippageReport?: unknown;
	simulationError?: unknown;
};

export type JupiterInstructionAccount = {
	pubkey: string;
	isSigner: boolean;
	isWritable: boolean;
};

export type JupiterInstruction = {
	programId: string;
	accounts: JupiterInstructionAccount[];
	data: string;
};

export type JupiterSwapInstructionsResponse = {
	tokenLedgerInstruction?: JupiterInstruction | null;
	computeBudgetInstructions?: JupiterInstruction[];
	setupInstructions?: JupiterInstruction[];
	swapInstruction: JupiterInstruction;
	cleanupInstruction?: JupiterInstruction | null;
	otherInstructions?: JupiterInstruction[];
	addressLookupTableAddresses?: string[];
	error?: string;
};

export type SwapQuote = {
	inputAmount: string;
	outputAmount: string;
	inputToken: string;
	outputToken: string;
	priceImpact?: string;
	fee?: string;
};

export type SwapResult = {
	signature?: string;
	success: boolean;
	error?: string;
};

export type SwapCreatedAtaRentEntry = {
	address: string;
	payer: string;
	owner: string;
	mint: string;
	tokenProgramId: string;
	rentLamports: number;
	alreadyExisted: boolean;
	paidByUser: boolean;
	instructionSource: "swap-instructions" | "transaction";
};

export type SwapFeeSimulationResult = {
	status: "passed" | "failed";
	error: unknown | null;
	unitsConsumed: number | null;
	logs: string[] | null;
};

export type SwapFeeEstimate = {
	totalLamports: number;
	transactionFeeLamports: number;
	prioritizationFeeLamports: number | null;
	prioritizationFeeIncludedInTransactionFee: boolean;
	rentLamports: number;
	createdAtaAccounts: SwapCreatedAtaRentEntry[];
	simulation: SwapFeeSimulationResult;
};

export type SwapFeeEstimateState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "success"; estimate: SwapFeeEstimate }
	| { status: "error"; error: string };
