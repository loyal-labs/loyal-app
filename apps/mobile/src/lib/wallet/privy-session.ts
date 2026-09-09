import { env } from "@/config/env";

export class PrivySessionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PrivySessionError";
  }
}

// Exchanges the Privy identity token for a Loyal session on the Earn backend
// (same route web uses). Keeps the Loyal user keyed by wallet address.
export async function exchangePrivySession(
  identityToken: string,
  walletAddress: string,
): Promise<void> {
  const res = await fetch(`${env.earnApiBaseUrl}/api/auth/privy/complete`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "privy-id-token": identityToken,
      ...(env.vercelProtectionBypass
        ? { "x-vercel-protection-bypass": env.vercelProtectionBypass }
        : {}),
    },
    body: JSON.stringify({ walletAddress }),
  });
  if (res.ok) return;
  const body = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  throw new PrivySessionError(
    body?.error?.code ?? `http_${res.status}`,
    body?.error?.message ?? "Sign-in failed.",
  );
}
