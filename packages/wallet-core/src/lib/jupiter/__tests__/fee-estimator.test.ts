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

import { estimateSwapTransactionFee } from "../fee-estimator";
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
