import { describe, it, expect, beforeAll } from "bun:test";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
    Keypair,
    PublicKey,
    Transaction,
    SystemProgram,
    LAMPORTS_PER_SOL,
    Ed25519Program,
    SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import {
    createAssociatedTokenAccountIdempotent,
    createMint,
    getMint,
    getAssociatedTokenAddressSync,
    mintToChecked,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
    ConnectionMagicRouter,
    verifyTeeRpcIntegrity,
    getAuthToken,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import {
    LoyalPrivateTransactionsClient,
    MAGIC_CONTEXT_ID,
    MAGIC_PROGRAM_ID,
} from "../index";
import type { TelegramVerification } from "../../../target/types/telegram_verification";

const VALIDATION_BYTES: Uint8Array = new Uint8Array([
    56, 48, 54, 53, 49, 52, 48, 52, 57, 57, 58, 87, 101, 98, 65, 112, 112, 68,
    97, 116, 97, 10, 97, 117, 116, 104, 95, 100, 97, 116, 101, 61, 49, 55, 54,
    51, 53, 57, 56, 51, 55, 53, 10, 99, 104, 97, 116, 95, 105, 110, 115, 116,
    97, 110, 99, 101, 61, 45, 52, 53, 57, 55, 56, 48, 55, 53, 56, 53, 54, 55,
    51, 56, 52, 53, 53, 55, 49, 10, 99, 104, 97, 116, 95, 116, 121, 112, 101,
    61, 115, 101, 110, 100, 101, 114, 10, 117, 115, 101, 114, 61, 123, 34, 105,
    100, 34, 58, 56, 49, 51, 56, 55, 57, 55, 55, 54, 55, 44, 34, 102, 105, 114,
    115, 116, 95, 110, 97, 109, 101, 34, 58, 34, 84, 114, 97, 118, 105, 115, 34,
    44, 34, 108, 97, 115, 116, 95, 110, 97, 109, 101, 34, 58, 34, 34, 44, 34,
    117, 115, 101, 114, 110, 97, 109, 101, 34, 58, 34, 100, 105, 103, 49, 51,
    51, 55, 49, 51, 51, 51, 55, 34, 44, 34, 108, 97, 110, 103, 117, 97, 103,
    101, 95, 99, 111, 100, 101, 34, 58, 34, 101, 110, 34, 44, 34, 97, 108, 108,
    111, 119, 115, 95, 119, 114, 105, 116, 101, 95, 116, 111, 95, 112, 109, 34,
    58, 116, 114, 117, 101, 44, 34, 112, 104, 111, 116, 111, 95, 117, 114, 108,
    34, 58, 34, 104, 116, 116, 112, 115, 58, 92, 47, 92, 47, 116, 46, 109, 101,
    92, 47, 105, 92, 47, 117, 115, 101, 114, 112, 105, 99, 92, 47, 51, 50, 48,
    92, 47, 120, 99, 90, 85, 85, 85, 87, 51, 117, 74, 50, 99, 79, 80, 86, 73,
    81, 85, 111, 99, 104, 105, 119, 72, 99, 56, 113, 118, 114, 56, 106, 114,
    108, 66, 56, 74, 45, 72, 88, 120, 105, 112, 98, 83, 74, 76, 122, 122, 118,
    120, 73, 99, 79, 106, 55, 103, 55, 70, 49, 69, 78, 116, 72, 71, 46, 115,
    118, 103, 34, 125,
]);

const VALIDATION_SIGNATURE_BYTES: Uint8Array = new Uint8Array([
    139, 171, 57, 233, 145, 1, 218, 227, 29, 106, 55, 30, 237, 207, 28, 229, 22,
    234, 202, 160, 221, 31, 219, 251, 151, 181, 118, 207, 216, 254, 57, 79, 209,
    9, 176, 4, 81, 224, 69, 253, 250, 110, 16, 143, 73, 60, 35, 61, 66, 177,
    139, 178, 153, 248, 2, 121, 161, 49, 224, 103, 190, 108, 234, 4,
]);

const VALIDATION_USERNAME = "dig133713337";
const TELEGRAM_ED25519_PUBKEY = Buffer.from(
    "e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d",
    "hex",
);
const COMMIT_POLL_MS = Number(process.env.COMMIT_POLL_MS ?? "200");
const COMMIT_MAX_POLLS = Number(process.env.COMMIT_MAX_POLLS ?? "150");
const MINT_CACHE_PATH =
    process.env.MINT_CACHE_PATH ??
    path.join(process.cwd(), ".cache", "devnet-mint.json");

const deriveWsEndpoint = (rpcUrl: string) =>
    rpcUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const shouldRetryTransfer = (error: unknown) => {
    const message = (error as any)?.message ?? String(error ?? "");
    return (
        message.includes("Unknown action") ||
        message.includes("AccountClonerError") ||
        message.includes("FailedToGetSubscriptionSlot") ||
        message.includes("Timed out waiting for") ||
        message.includes("Transaction was not confirmed") ||
        message.includes("Transaction") ||
        message.includes("Blockhash not found") ||
        message.includes("InvalidWritableAccount")
    );
};

const runWithRetries = async <T>(
    label: string,
    fn: () => Promise<T>,
    attempts = 5,
    delayMs = 500,
): Promise<T> => {
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            if (attempt > 1) {
                console.log(`[sdk-test] retry ${label} attempt ${attempt}`);
            }
            return await fn();
        } catch (err) {
            lastErr = err;
            if (!shouldRetryTransfer(err) || attempt === attempts) {
                throw err;
            }
            await sleep(delayMs);
        }
    }
    throw lastErr;
};

const loadCachedMint = async (
    connection: anchor.web3.Connection,
    mintAuthority: PublicKey,
): Promise<PublicKey | null> => {
    if (!existsSync(MINT_CACHE_PATH)) {
        return null;
    }
    try {
        const raw = await Bun.file(MINT_CACHE_PATH).text();
        const parsed = JSON.parse(raw) as { mint?: string };
        if (!parsed.mint) {
            return null;
        }
        const mint = new PublicKey(parsed.mint);
        const mintInfo = await getMint(connection, mint, "confirmed");
        if (!mintInfo.mintAuthority?.equals(mintAuthority)) {
            return null;
        }
        if (mintInfo.decimals !== 6) {
            return null;
        }
        return mint;
    } catch {
        return null;
    }
};

const persistMint = async (mint: PublicKey) => {
    await mkdir(path.dirname(MINT_CACHE_PATH), { recursive: true });
    await Bun.write(
        MINT_CACHE_PATH,
        JSON.stringify({ mint: mint.toBase58() }, null, 2),
    );
};

describe("private-transactions SDK (PER)", () => {
    // 4WRGdAZ8LHmbPC3CfdCR8sspKhBATs9EZ8H83RYJQ8RG
    const userKp = Keypair.fromSecretKey(
        Uint8Array.from([
            54, 229, 115, 67, 69, 71, 205, 239, 251, 81, 102, 40, 48, 237, 241,
            66, 8, 22, 241, 216, 209, 140, 214, 111, 51, 58, 171, 169, 14, 90,
            182, 255, 52, 28, 88, 128, 77, 91, 157, 211, 179, 122, 209, 150, 17,
            24, 121, 242, 177, 212, 235, 216, 109, 5, 94, 31, 222, 100, 124,
            166, 124, 52, 149, 131,
        ]),
    );
    // 3cd5zjx8DAPDUciSrJtbrtniuNpDWhGLSKtk7xxCMCpP
    const otherUserKp = Keypair.fromSecretKey(
        Uint8Array.from([
            112, 50, 255, 102, 148, 177, 8, 136, 48, 146, 49, 69, 16, 165, 113,
            81, 123, 225, 207, 149, 216, 229, 105, 50, 249, 48, 232, 27, 165,
            181, 239, 97, 38, 215, 129, 64, 75, 228, 54, 138, 179, 234, 24, 136,
            233, 6, 252, 59, 233, 186, 135, 194, 87, 255, 97, 59, 189, 140, 157,
            56, 221, 35, 43, 56,
        ]),
    );
    const user = userKp.publicKey;
    const otherUser = otherUserKp.publicKey;

    console.log("[sdk-test] user 1", user.toString());
    console.log("[sdk-test] user 2", otherUser.toString());

    const commitment =
        (process.env.PROVIDER_COMMITMENT as anchor.web3.Commitment) ??
        "confirmed";

    const devnetErHostname = "devnet-router.magicblock.app";
    const devnetPerHostname = "tee.magicblock.app";

    const endpoint = `https://${devnetErHostname}`;
    const wsEndpoint = deriveWsEndpoint(endpoint);

    let privateEndpoint = `https://${devnetPerHostname}`;
    let privateWsEndpoint = deriveWsEndpoint(privateEndpoint);

    const connection: ConnectionMagicRouter = new ConnectionMagicRouter(
        endpoint,
        { wsEndpoint, commitment },
    );
    const baseDevnetEndpoint =
        process.env.BASE_DEVNET_RPC ?? "https://api.devnet.solana.com";
    const baseConnection = new anchor.web3.Connection(baseDevnetEndpoint, {
        commitment,
    });

    const initialAmount = 1_000_000;
    const depositAmount = 200_000;
    const claimAmount = 100_000;
    const transferAmount = 100_000;

    let tokenMint: PublicKey;
    let userTokenAccount: PublicKey;
    let otherUserTokenAccount: PublicKey;
    let sessionPda: PublicKey;
    let verificationProgram: Program<TelegramVerification>;
    let erValidator: PublicKey;
    let ephemeralProviderEndpoint: string;
    let ephemeralWsEndpoint: string;

    let clientUser: LoyalPrivateTransactionsClient;
    let clientOther: LoyalPrivateTransactionsClient;
    let ephemeralClientUser: LoyalPrivateTransactionsClient;
    let ephemeralClientOther: LoyalPrivateTransactionsClient;

    beforeAll(async () => {
        const validator = await connection.getClosestValidator();
        console.log(
            "[sdk-test] closest validator",
            JSON.stringify(validator, null, 2),
        );
        if (!validator.identity) {
            throw new Error("Validator identity missing from router response");
        }
        erValidator = new PublicKey(validator.identity);
        if (validator.fqdn) {
            privateEndpoint = validator.fqdn.replace(/\/$/, "");
            privateWsEndpoint = deriveWsEndpoint(privateEndpoint);
        }

        console.log("[sdk-test] router RPC", endpoint);
        console.log("[sdk-test] router WS", wsEndpoint);
        console.log("[sdk-test] private RPC", privateEndpoint);
        console.log("[sdk-test] private WS", privateWsEndpoint);
        console.log("[sdk-test] base RPC", baseDevnetEndpoint);

        clientUser = LoyalPrivateTransactionsClient.from(connection, userKp);
        clientOther = LoyalPrivateTransactionsClient.from(
            connection,
            otherUserKp,
        );

        ephemeralClientUser = LoyalPrivateTransactionsClient.from(
            new anchor.web3.Connection(privateEndpoint, {
                wsEndpoint: privateWsEndpoint,
                commitment,
            }),
            userKp,
        );
        ephemeralClientOther = LoyalPrivateTransactionsClient.from(
            new anchor.web3.Connection(privateEndpoint, {
                wsEndpoint: privateWsEndpoint,
                commitment,
            }),
            otherUserKp,
        );
        console.log(
            "[sdk-test] ephemeral user RPC",
            ephemeralClientUser.getProgram().provider.connection.rpcEndpoint,
        );
        console.log(
            "[sdk-test] ephemeral other RPC",
            ephemeralClientOther.getProgram().provider.connection.rpcEndpoint,
        );

        const verificationIdl = JSON.parse(
            await Bun.file(
                "../../target/idl/telegram_verification.json",
            ).text(),
        ) as TelegramVerification;
        const verificationProvider = new anchor.AnchorProvider(
            baseConnection,
            new anchor.Wallet(otherUserKp),
            {
                commitment,
                preflightCommitment: commitment,
            },
        );
        verificationProgram = new Program<TelegramVerification>(
            verificationIdl,
            verificationProvider,
        );

        for (const kp of [userKp, otherUserKp]) {
            const balance = await baseConnection.getBalance(
                kp.publicKey,
                "confirmed",
            );
            if (balance > 0.2 * LAMPORTS_PER_SOL) {
                continue;
            }
            const sig = await baseConnection.requestAirdrop(
                kp.publicKey,
                0.21 * LAMPORTS_PER_SOL,
            );
            await baseConnection.confirmTransaction(sig, "confirmed");
        }

        const reuseMint = process.env.REUSE_MINT === "true";
        const cachedMint = reuseMint
            ? await loadCachedMint(baseConnection, user)
            : null;
        if (cachedMint) {
            tokenMint = cachedMint;
            console.log("[sdk-test] reuse mint", tokenMint.toBase58());
        } else {
            tokenMint = await createMint(
                baseConnection,
                userKp,
                user,
                null,
                6,
                undefined,
                undefined,
                TOKEN_PROGRAM_ID,
            );
            await persistMint(tokenMint);
            console.log("[sdk-test] created mint", tokenMint.toBase58());
        }

        userTokenAccount = await createAssociatedTokenAccountIdempotent(
            baseConnection,
            userKp,
            tokenMint,
            user,
            undefined,
            TOKEN_PROGRAM_ID,
        );

        otherUserTokenAccount = await createAssociatedTokenAccountIdempotent(
            baseConnection,
            userKp,
            tokenMint,
            otherUser,
            undefined,
            TOKEN_PROGRAM_ID,
        );

        await mintToChecked(
            baseConnection,
            userKp,
            tokenMint,
            userTokenAccount,
            user,
            initialAmount,
            6,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID,
        );

        [sessionPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("tg_session_v2"), otherUser.toBuffer()],
            verificationProgram.programId,
        );
    });

    it("runs deposit, delegate, private transfer, claim, and undelegate flow", async () => {
        const rpcOptions = { skipPreflight: true };

        console.log("[sdk-test] initialize deposit");
        await runWithRetries("initializeDeposit", () =>
            clientUser.initializeDeposit({
                tokenMint,
                user,
                payer: user,
                rpcOptions,
            }),
        );
        console.log("[sdk-test] modify balance");
        const existingDeposit = await clientUser.getDeposit(user, tokenMint);
        const currentAmount = existingDeposit?.amount ?? 0;
        const delta = initialAmount - currentAmount;
        let depositResult = existingDeposit;
        if (delta !== 0) {
            const adjustResult = await runWithRetries("modifyBalance", () =>
                clientUser.modifyBalance({
                    tokenMint,
                    amount: Math.abs(delta),
                    increase: delta > 0,
                    user,
                    payer: user,
                    userTokenAccount,
                    rpcOptions,
                }),
            );
            depositResult = adjustResult.deposit;
        }
        expect(depositResult?.amount).toBe(initialAmount);

        console.log("[sdk-test] create permission + delegate deposit");
        await runWithRetries("createPermission", () =>
            clientUser.createPermission({
                tokenMint,
                user,
                payer: user,
                rpcOptions,
            }),
        );
        await runWithRetries("delegateDeposit", () =>
            clientUser.delegateDeposit({
                tokenMint,
                user,
                payer: user,
                validator: erValidator,
                rpcOptions,
            }),
        );
        let erUserDeposit = await ephemeralClientUser.getDeposit(
            user,
            tokenMint,
        );
        for (let i = 0; i < 25 && !erUserDeposit; i += 1) {
            await sleep(200);
            erUserDeposit = await ephemeralClientUser.getDeposit(
                user,
                tokenMint,
            );
        }

        console.log("[sdk-test] deposit for username");
        await mintToChecked(
            connection,
            userKp,
            tokenMint,
            userTokenAccount,
            user,
            depositAmount,
            6,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID,
        );
        try {
            await runWithRetries("depositForUsername", () =>
                clientUser.depositForUsername({
                    username: VALIDATION_USERNAME,
                    tokenMint,
                    amount: depositAmount,
                    depositor: user,
                    payer: user,
                    depositorTokenAccount: userTokenAccount,
                    rpcOptions,
                }),
            );
        } catch (err) {
            try {
                const [depositPda] = clientUser.findUsernameDepositPda(
                    VALIDATION_USERNAME,
                    tokenMint,
                );
                const [vaultPda] = clientUser.findVaultPda(tokenMint);
                const vaultTokenAccount = getAssociatedTokenAddressSync(
                    tokenMint,
                    vaultPda,
                    true,
                    TOKEN_PROGRAM_ID,
                    ASSOCIATED_TOKEN_PROGRAM_ID,
                );
                const sim = await clientUser
                    .getProgram()
                    .methods.depositForUsername(
                        VALIDATION_USERNAME,
                        new anchor.BN(depositAmount),
                    )
                    .accountsPartial({
                        payer: user,
                        depositor: user,
                        deposit: depositPda,
                        vault: vaultPda,
                        vaultTokenAccount,
                        depositorTokenAccount: userTokenAccount,
                        tokenMint,
                        tokenProgram: TOKEN_PROGRAM_ID,
                        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([userKp])
                    .simulate();
                const simLogs =
                    (sim as { logs?: string[] }).logs ??
                    (sim as { value?: { logs?: string[] } }).value?.logs;
                console.error(
                    "[sdk-test] depositForUsername simulate logs",
                    simLogs,
                );
            } catch (simErr) {
                console.error(
                    "[sdk-test] depositForUsername simulate error",
                    simErr,
                );
            }
            throw err;
        }

        console.log("[sdk-test] store + verify telegram initData");
        await runWithRetries("storeTelegramSession", () =>
            verificationProgram.methods
                .store(Buffer.from(VALIDATION_BYTES))
                .accounts({
                    payer: otherUser,
                    user: otherUser,
                    // @ts-ignore
                    session: sessionPda,
                    systemProgram: SystemProgram.programId,
                })
                .signers([otherUserKp])
                .rpc({ commitment: "confirmed" }),
        );

        const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
            publicKey: Uint8Array.from(TELEGRAM_ED25519_PUBKEY),
            message: VALIDATION_BYTES,
            signature: VALIDATION_SIGNATURE_BYTES,
        });
        const verifyIx = await verificationProgram.methods
            .verifyTelegramInitData()
            .accounts({
                session: sessionPda,
                // @ts-ignore
                instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
            })
            .instruction();
        const verifyTx = new Transaction().add(ed25519Ix, verifyIx);
        const { blockhash } = await baseConnection.getLatestBlockhash();
        verifyTx.feePayer = otherUser;
        verifyTx.recentBlockhash = blockhash;
        verifyTx.sign(otherUserKp);
        const verifySig = await runWithRetries("verifyTelegramSession", () =>
            baseConnection.sendRawTransaction(verifyTx.serialize()),
        );
        await baseConnection.confirmTransaction(verifySig, "confirmed");

        console.log("[sdk-test] claim username deposit");
        const balanceBefore = await connection.getTokenAccountBalance(
            otherUserTokenAccount,
        );
        await runWithRetries("claimUsernameDeposit", () =>
            clientOther.claimUsernameDeposit({
                username: VALIDATION_USERNAME,
                tokenMint,
                amount: claimAmount,
                recipient: otherUser,
                recipientTokenAccount: otherUserTokenAccount,
                session: sessionPda,
                rpcOptions,
            }),
        );
        const balanceAfter = await connection.getTokenAccountBalance(
            otherUserTokenAccount,
        );
        expect(Number(balanceAfter.value.amount)).toBeGreaterThan(
            Number(balanceBefore.value.amount),
        );

        console.log("[sdk-test] create permission + delegate username deposit");
        await runWithRetries("createUsernamePermission", () =>
            clientOther.createUsernamePermission({
                username: VALIDATION_USERNAME,
                tokenMint,
                session: sessionPda,
                authority: otherUser,
                payer: otherUser,
                rpcOptions,
            }),
        );
        await runWithRetries("delegateUsernameDeposit", () =>
            clientOther.delegateUsernameDeposit({
                username: VALIDATION_USERNAME,
                tokenMint,
                session: sessionPda,
                payer: otherUser,
                validator: erValidator,
                rpcOptions,
            }),
        );
        let erUsernameDepositForTransfer =
            await ephemeralClientOther.getUsernameDeposit(
                VALIDATION_USERNAME,
                tokenMint,
            );
        for (let i = 0; i < 25 && !erUsernameDepositForTransfer; i += 1) {
            await sleep(200);
            erUsernameDepositForTransfer =
                await ephemeralClientOther.getUsernameDeposit(
                    VALIDATION_USERNAME,
                    tokenMint,
                );
        }

        console.log("[sdk-test] private transfer to username deposit (PER)");
        const maxAttempts = Number(process.env.TRANSFER_RETRIES ?? "30");
        const retryDelayMs = Number(
            process.env.TRANSFER_RETRY_DELAY_MS ?? "1000",
        );
        let transferSig: string | null = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                const transferResult =
                    await ephemeralClientUser.transferToUsernameDeposit({
                        username: VALIDATION_USERNAME,
                        tokenMint,
                        amount: transferAmount,
                        user,
                        payer: user,
                        sessionToken: null,
                        rpcOptions,
                    });
                transferSig = transferResult.signature;
                break;
            } catch (err) {
                const message = (err as any)?.message ?? String(err ?? "");
                console.log(
                    `[sdk-test] transfer attempt ${attempt} failed: ${message}`,
                );
                if (!shouldRetryTransfer(err) || attempt === maxAttempts) {
                    throw err;
                }
                await sleep(retryDelayMs);
            }
        }
        expect(transferSig).not.toBeNull();

        if (transferSig) {
            await ephemeralClientUser
                .getProgram()
                .provider.connection.confirmTransaction(transferSig);
        }

        let erUsernameDeposit = await ephemeralClientOther.getUsernameDeposit(
            VALIDATION_USERNAME,
            tokenMint,
        );
        for (let i = 0; i < 25 && !erUsernameDeposit; i += 1) {
            await sleep(200);
            erUsernameDeposit = await ephemeralClientOther.getUsernameDeposit(
                VALIDATION_USERNAME,
                tokenMint,
            );
        }
        expect(erUsernameDeposit?.amount).toBe(
            depositAmount - claimAmount + transferAmount,
        );

        console.log("[sdk-test] undelegate username deposit + user deposit");
        const undelegateUsernameSig = await runWithRetries(
            "undelegateUsernameDeposit",
            () =>
                ephemeralClientOther.undelegateUsernameDeposit({
                    username: VALIDATION_USERNAME,
                    tokenMint,
                    session: sessionPda,
                    payer: otherUser,
                    magicProgram: MAGIC_PROGRAM_ID,
                    magicContext: MAGIC_CONTEXT_ID,
                    rpcOptions,
                }),
        );
        await ephemeralClientOther
            .getProgram()
            .provider.connection.confirmTransaction(undelegateUsernameSig);

        const undelegateSig = await runWithRetries("undelegateDeposit", () =>
            ephemeralClientUser.undelegateDeposit({
                tokenMint,
                user,
                payer: user,
                magicProgram: MAGIC_PROGRAM_ID,
                magicContext: MAGIC_CONTEXT_ID,
                rpcOptions,
            }),
        );
        await ephemeralClientUser
            .getProgram()
            .provider.connection.confirmTransaction(undelegateSig);

        console.log("[sdk-test] wait for base commit");
        let baseUsernameDeposit = await clientUser.getUsernameDeposit(
            VALIDATION_USERNAME,
            tokenMint,
        );
        for (let i = 0; i < COMMIT_MAX_POLLS; i += 1) {
            if (
                baseUsernameDeposit &&
                baseUsernameDeposit.amount ===
                    depositAmount - claimAmount + transferAmount
            ) {
                break;
            }
            await sleep(COMMIT_POLL_MS);
            baseUsernameDeposit = await clientUser.getUsernameDeposit(
                VALIDATION_USERNAME,
                tokenMint,
            );
        }
        expect(baseUsernameDeposit?.amount).toBe(
            depositAmount - claimAmount + transferAmount,
        );

        let baseUserDeposit = await clientUser.getDeposit(user, tokenMint);
        for (let i = 0; i < COMMIT_MAX_POLLS; i += 1) {
            if (
                baseUserDeposit &&
                baseUserDeposit.amount === initialAmount - transferAmount
            ) {
                break;
            }
            await sleep(COMMIT_POLL_MS);
            baseUserDeposit = await clientUser.getDeposit(user, tokenMint);
        }
        expect(baseUserDeposit?.amount).toBe(initialAmount - transferAmount);
    });
});
