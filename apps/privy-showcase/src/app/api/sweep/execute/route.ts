import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import bs58 from "bs58";
import { NextResponse } from "next/server";
import { authenticatePrivyWallet } from "@/lib/server/auth";
import { getPolicySigner } from "@/lib/server/config";
import { compileDeterministicPolicyTransaction } from "@/lib/server/deterministic-transaction";
import { readValidatedSweepContext } from "@/lib/server/sweep-chain";
import {
  assertSweepSnapshot,
  sweepIntentSchema,
  verifySweepIntentSignature,
} from "@/lib/sweep-intent";
import { DEMO_CLUSTER, SQUADS_PROGRAM_ID } from "@/lib/constants";
import {
  assertMainnetConnection,
  createMainnetConnection,
  waitForFinalized,
} from "@/lib/rpc";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      intent?: unknown;
      signature?: unknown;
    };
    const intent = sweepIntentSchema.parse(body.intent);
    if (
      typeof body.signature !== "string" ||
      !verifySweepIntentSignature({ intent, signature: body.signature })
    ) {
      throw new Error("Invalid Privy wallet signature.");
    }
    if (intent.expiresAt < Date.now()) throw new Error("Sweep intent expired.");
    await authenticatePrivyWallet(request, intent.wallet);

    const connection = createMainnetConnection();
    await assertMainnetConnection(connection);
    const policySigner = getPolicySigner();
    const currentBlockHeight = await connection.getBlockHeight("finalized");
    if (currentBlockHeight > intent.lastValidBlockHeight)
      throw new Error("Sweep intent blockhash expired.");

    const context = await readValidatedSweepContext({
      connection,
      request: intent,
      policySigner: policySigner.publicKey,
    });
    assertSweepSnapshot({
      intent,
      walletBalanceRaw: context.walletBalance,
      vaultBalanceRaw: context.vaultBalance,
      amountPulledRaw: context.amountPulled,
      amountPerPeriodRaw: context.amountPerPeriod,
    });
    const amountRaw = BigInt(intent.authorizedAmountRaw);

    const vaults = createSmartAccountVaultsClient({
      connection,
      programId: SQUADS_PROGRAM_ID,
    });
    const pull = await vaults.prepareEarnUsdcAutodepositPull({
      policy: context.policy,
      walletAddress: context.wallet,
      feePayer: policySigner.publicKey,
      policySigner: policySigner.publicKey,
      recurringDelegation: context.recurringDelegation,
      amountRaw,
      cluster: DEMO_CLUSTER,
      memo: `Privy showcase sweep ${intent.nonce}`,
    });
    // The signed intent fixes the finalized state, exact amount, memo nonce,
    // fee payer, and recent blockhash. Every server instance therefore builds
    // byte-identical transactions with the same Ed25519 signature. Concurrent
    // replay can only rebroadcast that one Solana transaction, never execute a
    // second transfer.
    const transaction = compileDeterministicPolicyTransaction({
      prepared: pull.prepared,
      blockhash: intent.blockhash,
      policySigner,
    });
    const expectedSignature = bs58.encode(transaction.signatures[0]!);
    const simulation = await connection.simulateTransaction(transaction, {
      commitment: "finalized",
      sigVerify: true,
    });
    if (simulation.value.err) {
      throw new Error(
        `Sweep simulation failed: ${JSON.stringify(simulation.value.err)}`
      );
    }
    const submittedSignature = await connection.sendRawTransaction(
      transaction.serialize(),
      { maxRetries: 3, skipPreflight: false }
    );
    if (submittedSignature !== expectedSignature)
      throw new Error(
        "RPC returned a signature different from the signed sweep transaction."
      );
    await waitForFinalized(connection, expectedSignature);

    const afterContext = await readValidatedSweepContext({
      connection,
      request: intent,
      policySigner: policySigner.publicKey,
    });
    if (
      context.walletBalance - afterContext.walletBalance !== amountRaw ||
      afterContext.vaultBalance - context.vaultBalance !== amountRaw
    ) {
      throw new Error(
        "Finalized sweep balances did not reconcile to the exact executed amount."
      );
    }

    return NextResponse.json({
      signature: expectedSignature,
      amountRaw: amountRaw.toString(),
      wallet: {
        beforeRaw: context.walletBalance.toString(),
        afterRaw: afterContext.walletBalance.toString(),
      },
      vault: {
        beforeRaw: context.vaultBalance.toString(),
        afterRaw: afterContext.vaultBalance.toString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Sweep execution failed.",
      },
      { status: 400 }
    );
  }
}
