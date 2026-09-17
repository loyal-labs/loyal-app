import { NextResponse } from "next/server";

import { prepareTransaction } from "@/features/vault/server/transaction-prepare";

export const dynamic = "force-dynamic";

/**
 * POST /api/transactions/prepare — one unsigned, wallet-bound transaction for
 * deposit, request-withdraw or claim, with its preview and quote identity.
 * No account, mint, program, recipient or fee payer is ever taken from the
 * request, and nothing here signs or broadcasts.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { kind: "invalid-input", reason: "body must be valid JSON" } },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  const outcome = await prepareTransaction(body);
  if (!outcome.ok) {
    return NextResponse.json(outcome.failure, { status: outcome.httpStatus, headers: { "cache-control": "no-store" } });
  }
  return NextResponse.json(outcome.response, { status: outcome.httpStatus, headers: { "cache-control": "no-store" } });
}
