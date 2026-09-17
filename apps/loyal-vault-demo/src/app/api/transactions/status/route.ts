import { NextResponse } from "next/server";

import { TransactionReadRpc } from "@/features/vault/server/transaction-rpc";
import { parseWalletParam, rejectForeignParams } from "@/features/vault/server/config";
import { reconcileTransaction } from "@/features/vault/server/transaction-status";

export const dynamic = "force-dynamic";

/**
 * GET /api/transactions/status?signature=&wallet= — read-only, signature-scoped
 * reconciliation of one finalized transaction against the action it claims to
 * be. No state is written and no other RPC method is reachable.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const foreign = rejectForeignParams(url.searchParams, ["signature", "wallet"]);
  if (foreign) {
    return NextResponse.json({ unavailable: true, reason: foreign, kind: "invalid-input" }, { status: 400 });
  }

  const signature = url.searchParams.get("signature");
  if (!signature || !TransactionReadRpc.isWellFormedSignature(signature)) {
    return NextResponse.json(
      { unavailable: true, reason: "signature is required and must be a 64-byte base58 transaction signature", kind: "invalid-input" },
      { status: 400 },
    );
  }
  const wallet = parseWalletParam(url.searchParams.get("wallet"));
  if (!wallet.ok) {
    return NextResponse.json({ unavailable: true, reason: wallet.reason, kind: "invalid-input" }, { status: 400 });
  }

  const outcome = await reconcileTransaction(signature, wallet.wallet);
  if (!outcome.ok) {
    return NextResponse.json(outcome.body, { status: outcome.httpStatus, headers: { "cache-control": "no-store" } });
  }
  return NextResponse.json(outcome.response, { status: outcome.httpStatus, headers: { "cache-control": "no-store" } });
}
