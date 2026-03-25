import { describe, expect, it } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  SystemProgram,
} from "@solana/web3.js";
import {
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  closeAccount,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  DELEGATION_PROGRAM_ID,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  PROGRAM_ID,
  LoyalPrivateTransactionsClient,
  WSOL_MINT,
  estimateSupplyApy,
  estimateUnderlyingFromSharesAtSlot,
  estimateWarpSlotsForRequiredYield,
  fetchKlendReserveSnapshot,
  findDepositPda,
  findVaultPda,
  quoteSharesFromUnderlyingFloor,
  quoteUnderlyingFromSharesFloor,
} from "../index";

type MintLabel = "SOL" | "USDC" | "USDT";

type CheckpointFile = {
  mintLabel: MintLabel;
  tokenMint: string;
  principalRaw: string;
  requiredYieldRaw: string;
  shieldSlot: string;
  warpSlots: string;
  warpToSlot: string;
  reserve: string;
  lendingMarket: string;
  reserveLiquiditySupply: string;
  reserveCollateralMint: string;
  vault: string;
  vaultCollateralAta: string;
  depositPda: string;
  shareBalance: string;
  quotedUnderlyingBefore: string;
  projectedUnderlyingAfterWarp: string;
};

const runLocalKaminoTest =
  process.env.PRIVATE_TRANSACTIONS_LOCAL_KAMINO === "true";
const describeLocalKamino = runLocalKaminoTest ? describe : describe.skip;

const COMMON_MINTS: Record<MintLabel, PublicKey> = {
  SOL: WSOL_MINT,
  USDC: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  USDT: new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
};

const DEFAULT_PRINCIPAL_BY_MINT: Record<MintLabel, bigint> = {
  SOL: 1_000_000_000n,
  USDC: 100_000_000n,
  USDT: 100_000_000n,
};

const USER_KP = Keypair.fromSecretKey(
  Uint8Array.from([
    54, 229, 115, 67, 69, 71, 205, 239, 251, 81, 102, 40, 48, 237, 241, 66, 8,
    22, 241, 216, 209, 140, 214, 111, 51, 58, 171, 169, 14, 90, 182, 255, 52,
    28, 88, 128, 77, 91, 157, 211, 179, 122, 209, 150, 17, 24, 121, 242, 177,
    212, 235, 216, 109, 5, 94, 31, 222, 100, 124, 166, 124, 52, 149, 131,
  ])
);

const BASE_RPC_ENDPOINT =
  process.env.PROVIDER_ENDPOINT ??
  process.env.ANCHOR_PROVIDER_URL ??
  "http://127.0.0.1:8899";
const BASE_WS_ENDPOINT =
  process.env.WS_ENDPOINT ?? deriveWsEndpoint(BASE_RPC_ENDPOINT, 8900);
const PER_RPC_ENDPOINT =
  process.env.PRIVATE_TRANSACTIONS_TEE_RPC_URL ??
  process.env.EPHEMERAL_PROVIDER_ENDPOINT ??
  "http://127.0.0.1:7799";
const PER_WS_ENDPOINT =
  process.env.PRIVATE_TRANSACTIONS_TEE_WS_URL ??
  process.env.EPHEMERAL_WS_ENDPOINT ??
  deriveWsEndpoint(PER_RPC_ENDPOINT, 7800);
const CHECKPOINT_PATH =
  process.env.KAMINO_LOCAL_CHECKPOINT_PATH ??
  "sdk/private-transactions/tests/.state/private-transactions-kamino-local.json";
const MIN_REQUIRED_YIELD =
  process.env.KAMINO_LOCAL_REQUIRED_YIELD_RAW !== undefined
    ? BigInt(process.env.KAMINO_LOCAL_REQUIRED_YIELD_RAW)
    : 1n;
const MIN_WARP_SLOTS =
  process.env.KAMINO_LOCAL_MIN_WARP_SLOTS !== undefined
    ? BigInt(process.env.KAMINO_LOCAL_MIN_WARP_SLOTS)
    : 172_800n;
const PHASE = (process.env.PRIVATE_TRANSACTIONS_LOCAL_KAMINO_PHASE ??
  "shield") as "shield" | "unshield";

const baseConnection = new Connection(BASE_RPC_ENDPOINT, {
  wsEndpoint: BASE_WS_ENDPOINT,
  commitment: "confirmed",
});

const mintLabel = (
  process.env.PRIVATE_TRANSACTIONS_TEST_MINT ?? "SOL"
).toUpperCase() as MintLabel;
const tokenMint = COMMON_MINTS[mintLabel];

if (!tokenMint) {
  throw new Error(
    `Unsupported PRIVATE_TRANSACTIONS_TEST_MINT=${mintLabel}. Use SOL, USDC, or USDT.`
  );
}

const principalRaw =
  process.env.KAMINO_LOCAL_PRINCIPAL_RAW !== undefined
    ? BigInt(process.env.KAMINO_LOCAL_PRINCIPAL_RAW)
    : DEFAULT_PRINCIPAL_BY_MINT[mintLabel];

async function wrapSolToWSol(opts: {
  connection: Connection;
  payer: Keypair;
  lamports: bigint;
}): Promise<{ wsolAta: PublicKey; createdAta: boolean }> {
  const { connection, payer, lamports } = opts;
  const wsolAta = await getAssociatedTokenAddress(NATIVE_MINT, payer.publicKey);
  const instructions = [];
  let createdAta = false;

  const ataInfo = await connection.getAccountInfo(wsolAta);
  if (!ataInfo) {
    createdAta = true;
    instructions.push(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        wsolAta,
        payer.publicKey,
        NATIVE_MINT
      )
    );
  }

  instructions.push(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: wsolAta,
      lamports: Number(lamports),
    })
  );
  instructions.push(createSyncNativeInstruction(wsolAta));

  const tx = new Transaction().add(...instructions);
  await sendAndConfirmTransaction(connection, tx, [payer]);

  return { wsolAta, createdAta };
}

async function closeWsolAta(opts: {
  connection: Connection;
  payer: Keypair;
  wsolAta: PublicKey;
}): Promise<void> {
  const { connection, payer, wsolAta } = opts;
  await closeAccount(connection, payer, wsolAta, payer.publicKey, payer);
}

async function getTokenAmount(
  connection: Connection,
  tokenAccount: PublicKey
): Promise<bigint> {
  const accountInfo = await connection.getAccountInfo(
    tokenAccount,
    "confirmed"
  );
  if (!accountInfo) {
    return 0n;
  }

  const balance = await connection.getTokenAccountBalance(
    tokenAccount,
    "confirmed"
  );
  return BigInt(balance.value.amount);
}

async function getModifyBalanceTokenDelta(
  signature: string,
  ownerPubkey: PublicKey
): Promise<bigint> {
  const tx = await baseConnection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx?.meta) {
    throw new Error(`Transaction ${signature} not found`);
  }

  const ownerStr = ownerPubkey.toBase58();
  const mintStr = tokenMint.toBase58();
  const preBal = tx.meta.preTokenBalances?.find(
    (balance) => balance.owner === ownerStr && balance.mint === mintStr
  );
  const postBal = tx.meta.postTokenBalances?.find(
    (balance) => balance.owner === ownerStr && balance.mint === mintStr
  );

  return (
    BigInt(postBal?.uiTokenAmount.amount ?? "0") -
    BigInt(preBal?.uiTokenAmount.amount ?? "0")
  );
}

async function writeCheckpoint(checkpoint: CheckpointFile): Promise<void> {
  await mkdir(path.dirname(CHECKPOINT_PATH), { recursive: true });
  const output = Bun.file(CHECKPOINT_PATH);
  await Bun.write(output, JSON.stringify(checkpoint, null, 2));
}

async function readCheckpoint(): Promise<CheckpointFile> {
  const file = Bun.file(CHECKPOINT_PATH);
  if (!(await file.exists())) {
    throw new Error(`Checkpoint not found at ${CHECKPOINT_PATH}`);
  }
  return (await file.json()) as CheckpointFile;
}

async function deleteCheckpoint(): Promise<void> {
  const file = Bun.file(CHECKPOINT_PATH);
  if (await file.exists()) {
    await unlink(CHECKPOINT_PATH);
  }
}

function deriveWsEndpoint(endpoint: string, localPort: number): string {
  if (
    endpoint.startsWith("http://127.0.0.1:") ||
    endpoint.startsWith("http://localhost:")
  ) {
    return `ws://127.0.0.1:${localPort}`;
  }
  return endpoint.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
}

describeLocalKamino("private-transactions local Kamino APY", () => {
  it(`${PHASE} phase validates local Kamino lending flow`, async () => {
    const client = await LoyalPrivateTransactionsClient.fromConfig({
      signer: USER_KP,
      baseRpcEndpoint: BASE_RPC_ENDPOINT,
      baseWsEndpoint: BASE_WS_ENDPOINT,
      ephemeralRpcEndpoint: PER_RPC_ENDPOINT,
      ephemeralWsEndpoint: PER_WS_ENDPOINT,
    });
    const user = USER_KP.publicKey;
    const [depositPda] = findDepositPda(user, tokenMint);
    const [vaultPda] = findVaultPda(tokenMint);
    const userTokenAccount = getAssociatedTokenAddressSync(
      tokenMint,
      user,
      false,
      TOKEN_PROGRAM_ID
    );
    const isNativeSol = tokenMint.equals(NATIVE_MINT);

    if (PHASE === "shield") {
      const existingAccount = await baseConnection.getAccountInfo(
        depositPda,
        "confirmed"
      );
      expect(existingAccount).toBeNull();

      const reserveSnapshotBefore = await fetchKlendReserveSnapshot(
        baseConnection,
        tokenMint
      );
      const minimumExpectedShares = quoteSharesFromUnderlyingFloor(
        principalRaw,
        reserveSnapshotBefore
      );
      const minimumWarpSlots = estimateWarpSlotsForRequiredYield(
        reserveSnapshotBefore,
        minimumExpectedShares,
        MIN_REQUIRED_YIELD,
        MIN_WARP_SLOTS
      );
      const projectedUnderlyingAfterWarp = estimateUnderlyingFromSharesAtSlot(
        minimumExpectedShares,
        reserveSnapshotBefore,
        reserveSnapshotBefore.currentSlot + minimumWarpSlots
      );

      expect(reserveSnapshotBefore.borrowedAmountSf > 0n).toBe(true);
      expect(estimateSupplyApy(reserveSnapshotBefore)).toBeGreaterThan(0);
      expect(minimumExpectedShares > 0n).toBe(true);

      let createdWsolAta = false;
      if (isNativeSol) {
        const wrapped = await wrapSolToWSol({
          connection: baseConnection,
          payer: USER_KP,
          lamports: principalRaw,
        });
        createdWsolAta = wrapped.createdAta;
      }

      const reserveSupplyBefore = await getTokenAmount(
        baseConnection,
        reserveSnapshotBefore.reserveLiquiditySupply
      );

      const initializeSig = await client.initializeDeposit({
        user,
        tokenMint,
        payer: user,
      });
      expect(initializeSig.length > 0).toBe(true);

      const { signature, deposit } = await client.modifyBalance({
        user,
        tokenMint,
        amount: principalRaw,
        increase: true,
        payer: user,
        userTokenAccount,
      });

      if (isNativeSol && createdWsolAta) {
        await closeWsolAta({
          connection: baseConnection,
          payer: USER_KP,
          wsolAta: userTokenAccount,
        });
      }

      const reserveSnapshotAfter = await fetchKlendReserveSnapshot(
        baseConnection,
        tokenMint
      );
      const vault = await client.baseProgram.account.vault.fetch(vaultPda);
      const vaultCollateralAta = getAssociatedTokenAddressSync(
        reserveSnapshotAfter.reserveCollateralMint,
        vaultPda,
        true,
        TOKEN_PROGRAM_ID
      );
      const vaultTokenAta = getAssociatedTokenAddressSync(
        tokenMint,
        vaultPda,
        true,
        TOKEN_PROGRAM_ID
      );
      const reserveSupplyAfter = await getTokenAmount(
        baseConnection,
        reserveSnapshotAfter.reserveLiquiditySupply
      );
      const vaultCollateralAmount = await getTokenAmount(
        baseConnection,
        vaultCollateralAta
      );
      const vaultLiquidityAmount = await getTokenAmount(
        baseConnection,
        vaultTokenAta
      );
      const shieldDelta = await getModifyBalanceTokenDelta(signature, user);
      const quotedUnderlyingBefore = quoteUnderlyingFromSharesFloor(
        deposit.shareBalance,
        reserveSnapshotAfter
      );

      expect(shieldDelta).toBe(-principalRaw);
      expect(deposit.shareBalance >= minimumExpectedShares).toBe(true);
      expect(quotedUnderlyingBefore + 1n >= principalRaw).toBe(true);
      expect(BigInt(vault.totalShares.toString())).toBe(deposit.shareBalance);
      expect(vault.tokenMint.equals(tokenMint)).toBe(true);
      expect(vault.reserve.equals(reserveSnapshotAfter.reserve)).toBe(true);
      expect(
        vault.lendingMarket.equals(reserveSnapshotAfter.lendingMarket)
      ).toBe(true);
      expect(
        vault.reserveCollateralMint.equals(
          reserveSnapshotAfter.reserveCollateralMint
        )
      ).toBe(true);
      expect(vaultCollateralAmount).toBe(deposit.shareBalance);
      expect(vaultLiquidityAmount).toBe(0n);
      expect(reserveSupplyAfter - reserveSupplyBefore).toBe(principalRaw);

      await client.createPermission({
        user,
        tokenMint,
        payer: user,
      });
      const delegateSig = await client.delegateDeposit({
        user,
        tokenMint,
        payer: user,
        validator: client.getExpectedValidator(),
      });
      expect(delegateSig.length > 0).toBe(true);

      const delegatedInfo = await baseConnection.getAccountInfo(
        depositPda,
        "confirmed"
      );
      expect(delegatedInfo?.owner.equals(DELEGATION_PROGRAM_ID)).toBe(true);

      await writeCheckpoint({
        mintLabel,
        tokenMint: tokenMint.toBase58(),
        principalRaw: principalRaw.toString(),
        requiredYieldRaw: MIN_REQUIRED_YIELD.toString(),
        shieldSlot: reserveSnapshotAfter.currentSlot.toString(),
        warpSlots: minimumWarpSlots.toString(),
        warpToSlot: (
          reserveSnapshotAfter.currentSlot + minimumWarpSlots
        ).toString(),
        reserve: reserveSnapshotAfter.reserve.toBase58(),
        lendingMarket: reserveSnapshotAfter.lendingMarket.toBase58(),
        reserveLiquiditySupply:
          reserveSnapshotAfter.reserveLiquiditySupply.toBase58(),
        reserveCollateralMint:
          reserveSnapshotAfter.reserveCollateralMint.toBase58(),
        vault: vaultPda.toBase58(),
        vaultCollateralAta: vaultCollateralAta.toBase58(),
        depositPda: depositPda.toBase58(),
        shareBalance: deposit.shareBalance.toString(),
        quotedUnderlyingBefore: quotedUnderlyingBefore.toString(),
        projectedUnderlyingAfterWarp: projectedUnderlyingAfterWarp.toString(),
      });
      return;
    }

    const checkpoint = await readCheckpoint();
    expect(checkpoint.mintLabel).toBe(mintLabel);
    expect(checkpoint.tokenMint).toBe(tokenMint.toBase58());
    expect(checkpoint.depositPda).toBe(depositPda.toBase58());
    expect(checkpoint.vault).toBe(vaultPda.toBase58());

    const savedShareBalance = BigInt(checkpoint.shareBalance);
    const savedPrincipal = BigInt(checkpoint.principalRaw);
    const requiredYield = BigInt(checkpoint.requiredYieldRaw);
    const warpToSlot = BigInt(
      process.env.KAMINO_LOCAL_WARP_TO_SLOT ?? checkpoint.warpToSlot
    );
    const reserveSnapshotAfterWarp = await fetchKlendReserveSnapshot(
      baseConnection,
      tokenMint
    );
    const currentSlot = BigInt(await baseConnection.getSlot("confirmed"));
    const currentUnderlyingQuote = quoteUnderlyingFromSharesFloor(
      savedShareBalance,
      reserveSnapshotAfterWarp
    );
    const projectedUnderlyingAtWarp = estimateUnderlyingFromSharesAtSlot(
      savedShareBalance,
      reserveSnapshotAfterWarp,
      currentSlot
    );

    expect(currentSlot >= warpToSlot).toBe(true);
    expect(currentUnderlyingQuote >= savedPrincipal + requiredYield).toBe(true);
    expect(projectedUnderlyingAtWarp >= savedPrincipal + requiredYield).toBe(
      true
    );

    const undelegateSig = await client.undelegateDeposit({
      user,
      tokenMint,
      payer: user,
      magicProgram: MAGIC_PROGRAM_ID,
      magicContext: MAGIC_CONTEXT_ID,
    });
    expect(undelegateSig.length > 0).toBe(true);

    if (isNativeSol) {
      await wrapSolToWSol({
        connection: baseConnection,
        payer: USER_KP,
        lamports: 0n,
      });
    }

    const { signature: withdrawSig } = await client.modifyBalanceRaw({
      user,
      tokenMint,
      liquidityAmount: savedPrincipal + requiredYield,
      shareAmount: savedShareBalance,
      increase: false,
      payer: user,
      userTokenAccount,
    });

    if (isNativeSol) {
      await closeWsolAta({
        connection: baseConnection,
        payer: USER_KP,
        wsolAta: userTokenAccount,
      });
    }

    const withdrawDelta = await getModifyBalanceTokenDelta(withdrawSig, user);
    const finalDeposit = await client.getBaseDeposit(user, tokenMint);
    const finalVault = await client.baseProgram.account.vault.fetch(vaultPda);
    const finalVaultCollateralAta = getAssociatedTokenAddressSync(
      new PublicKey(checkpoint.reserveCollateralMint),
      vaultPda,
      true,
      TOKEN_PROGRAM_ID
    );
    const finalVaultCollateralAmount = await getTokenAmount(
      baseConnection,
      finalVaultCollateralAta
    );
    const finalDepositInfo = await baseConnection.getAccountInfo(
      depositPda,
      "confirmed"
    );

    expect(withdrawDelta > savedPrincipal).toBe(true);
    expect(finalDeposit?.shareBalance ?? 0n).toBe(0n);
    expect(finalDeposit?.amount ?? 0n).toBe(0n);
    expect(BigInt(finalVault.totalShares.toString())).toBe(0n);
    expect(finalVaultCollateralAmount).toBe(0n);
    expect(finalDepositInfo?.owner.equals(PROGRAM_ID)).toBe(true);

    await deleteCheckpoint();
  });
});
