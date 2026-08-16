import { getConnection } from "@/lib/solana/rpc/connection";
import type { Signer } from "@/lib/wallet/signer";

import { prepareEarnRefund, type EarnRefundPrepareRequest } from "./earn-api";
import { signEarnAuth, withEarnAuth } from "./earn-auth";
import { signAndSendPreparedOperations } from "./send-prepared";
import { hydratePreparedOperation } from "./wire";

export type EarnRefundResult = {
  signature: string;
};

// Execute one rent refund (a dead policy, a revoked recurring delegation, or
// the closed vault's leftover SOL + token-account rents). The backend
// re-verifies that the target is not in active use before preparing; the
// device wallet is the fee payer and the refund destination, so it signs and
// sends. Nothing is recorded server-side — the refund lands as plain SOL in
// the wallet, and the caller rescans to drop the row.
export async function executeEarnRefund(args: {
  signer: Signer;
  request: EarnRefundPrepareRequest;
}): Promise<EarnRefundResult> {
  const prepareAuth = await signEarnAuth(args.signer, "earn-refund-prepare");
  const response = await withEarnAuth(
    args.signer,
    prepareAuth,
    "earn-refund-prepare",
    (auth) => prepareEarnRefund({ auth, request: args.request }),
  );
  const wire =
    response.preparedVaultRefund ??
    response.preparedRefund ??
    response.preparedRecurringDelegationRefund;
  if (!wire) {
    throw new Error("Refund preparation returned no transaction.");
  }

  const [sent] = await signAndSendPreparedOperations({
    connection: getConnection(),
    signer: args.signer,
    operations: [hydratePreparedOperation(wire.prepared)],
  });
  return { signature: sent.signature };
}
