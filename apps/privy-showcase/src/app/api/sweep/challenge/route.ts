import { NextResponse } from "next/server";
import { authenticatePrivyWallet } from "@/lib/server/auth";
import { getPolicySigner } from "@/lib/server/config";
import { readValidatedSweepContext } from "@/lib/server/sweep-chain";
import { assertMainnetConnection, createMainnetConnection } from "@/lib/rpc";
import {
  calculateSweepAmount,
  sweepIntentSchema,
  sweepRequestSchema,
} from "@/lib/sweep-intent";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = sweepRequestSchema.parse(await request.json());
    await authenticatePrivyWallet(request, body.wallet);
    const connection = createMainnetConnection();
    await assertMainnetConnection(connection);
    const policySigner = getPolicySigner();
    const context = await readValidatedSweepContext({
      connection,
      request: body,
      policySigner: policySigner.publicKey,
    });
    const authorizedAmountRaw = calculateSweepAmount({
      requested: BigInt(body.requestedAmountRaw),
      walletBalance: context.walletBalance,
      minimumBalance: BigInt(body.minimumBalanceRaw),
      amountPerPeriod: context.amountPerPeriod,
      amountPulled: context.amountPulled,
    });
    const latest = await connection.getLatestBlockhash("finalized");
    const intent = sweepIntentSchema.parse({
      ...body,
      nonce: crypto.randomUUID(),
      expiresAt: Date.now() + 60_000,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
      expectedWalletBalanceRaw: context.walletBalance.toString(),
      expectedVaultBalanceRaw: context.vaultBalance.toString(),
      expectedAmountPulledRaw: context.amountPulled.toString(),
      amountPerPeriodRaw: context.amountPerPeriod.toString(),
      authorizedAmountRaw: authorizedAmountRaw.toString(),
    });
    return NextResponse.json({ intent });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not issue sweep intent.",
      },
      { status: 400 }
    );
  }
}
