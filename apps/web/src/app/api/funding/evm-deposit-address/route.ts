import { z } from "zod";

import {
  EVM_DEPOSIT_ASSETS,
  EVM_DEPOSIT_CHAINS,
  EVM_DEPOSIT_MIN_USD_ETHEREUM,
  getOrCreateEvmDepositAddress,
} from "@/features/funding/server/evm-deposit";
import { getOrCreateCurrentUser } from "@/features/chat/server/app-user";
import {
  isAuthGatewayError,
  resolveAuthenticatedPrincipalFromRequest,
} from "@/features/identity/server/auth-session";

const bodySchema = z.object({ privyAccessToken: z.string().min(1) });

// Returns (creating on first call) the user's cross-chain deposit address.
export async function POST(request: Request) {
  try {
    const principal = await resolveAuthenticatedPrincipalFromRequest(request);
    if (!principal) {
      return Response.json(
        { error: { code: "unauthenticated", message: "Sign in first." } },
        { status: 401 }
      );
    }
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        {
          error: {
            code: "invalid_body",
            message: "privyAccessToken required.",
          },
        },
        { status: 400 }
      );
    }
    const user = await getOrCreateCurrentUser(principal);
    const address = await getOrCreateEvmDepositAddress({
      userId: user.id,
      walletAddress: principal.walletAddress,
      privyAccessToken: parsed.data.privyAccessToken,
    });
    return Response.json({
      address,
      chains: EVM_DEPOSIT_CHAINS,
      assets: EVM_DEPOSIT_ASSETS,
      minimums: { ethereum: EVM_DEPOSIT_MIN_USD_ETHEREUM },
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
