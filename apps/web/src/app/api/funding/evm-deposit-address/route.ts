import { z } from "zod";

import { getOrCreateCurrentUser } from "@/features/chat/server/app-user";
import {
  buildEvmDepositRequest,
  createEvmDepositAddress,
  EVM_DEPOSIT_ASSETS,
  EVM_DEPOSIT_CHAINS,
  EVM_DEPOSIT_MIN_USD_ETHEREUM,
  EVM_DEPOSIT_SIGN_WINDOW_MS,
  findEvmDepositAddress,
  resolveEmbeddedWalletId,
} from "@/features/funding/server/evm-deposit";
import {
  isAuthGatewayError,
  resolveAuthenticatedPrincipalFromRequest,
} from "@/features/identity/server/auth-session";
import { getServerEnv } from "@/lib/core/config/server";

// Two-step: GET returns the stored address, or the Privy request the user must
// sign; POST takes that signature and creates the address.
const bodySchema = z.object({
  signature: z.string().min(1),
  requestExpiry: z.number().int().positive(),
});

function meta() {
  return {
    chains: EVM_DEPOSIT_CHAINS,
    assets: EVM_DEPOSIT_ASSETS,
    minimums: { ethereum: EVM_DEPOSIT_MIN_USD_ETHEREUM },
  };
}

async function withPrincipal(
  request: Request,
  fn: (p: { userId: string; walletAddress: string }) => Promise<Response>
) {
  try {
    const principal = await resolveAuthenticatedPrincipalFromRequest(request);
    if (!principal) {
      return Response.json(
        { error: { code: "unauthenticated", message: "Sign in first." } },
        { status: 401 }
      );
    }
    const user = await getOrCreateCurrentUser(principal);
    return await fn({
      userId: user.id,
      walletAddress: principal.walletAddress,
    });
  } catch (error) {
    if (isAuthGatewayError(error)) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status }
      );
    }
    throw error;
  }
}

export function GET(request: Request) {
  return withPrincipal(request, async (p) => {
    const row = await findEvmDepositAddress(p);
    if (row.evmDepositAddress) {
      return Response.json({ address: row.evmDepositAddress, ...meta() });
    }
    const walletId = await resolveEmbeddedWalletId(p.walletAddress);
    const { privyAppId } = getServerEnv();
    const requestExpiry = Date.now() + EVM_DEPOSIT_SIGN_WINDOW_MS;
    return Response.json({
      address: null,
      toSign: buildEvmDepositRequest(walletId, privyAppId ?? "", requestExpiry),
      requestExpiry,
      ...meta(),
    });
  });
}

export function POST(request: Request) {
  return withPrincipal(request, async (p) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: { code: "invalid_body", message: "signature required." } },
        { status: 400 }
      );
    }
    const row = await findEvmDepositAddress(p);
    if (row.evmDepositAddress) {
      return Response.json({ address: row.evmDepositAddress, ...meta() });
    }
    const walletId = await resolveEmbeddedWalletId(p.walletAddress);
    const { privyAppId } = getServerEnv();
    const address = await createEvmDepositAddress({
      rowId: row.id,
      walletId,
      appId: privyAppId ?? "",
      signature: parsed.data.signature,
      requestExpiry: parsed.data.requestExpiry,
    });
    return Response.json({ address, ...meta() });
  });
}
