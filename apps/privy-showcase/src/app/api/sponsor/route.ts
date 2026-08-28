import { NextResponse } from "next/server";
import { createMainnetConnection } from "@/lib/rpc";
import {
  authenticatePrivyWallet,
  createWalletChallenge,
  DEMO_SESSION_COOKIE,
  enforceRateLimit,
  enforceSameOrigin,
  getPolicySignerKeypair,
  getSponsorKeypair,
  handleSponsorRequest,
  verifyWalletChallenge,
} from "@/lib/server/sponsor";
import {
  parseSponsorBody,
  parsePublicKey,
  SponsorRequestError,
} from "@/lib/sponsor-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function responseForError(error: unknown) {
  if (error instanceof SponsorRequestError) {
    return NextResponse.json(
      { error: error.message, ...(error.signature ? { signature: error.signature } : {}) },
      { status: error.status }
    );
  }
  console.error("[privy-showcase] sponsor request failed", {
    message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : typeof error,
  });
  return NextResponse.json({ error: "Sponsorship failed safely." }, { status: 500 });
}

export async function GET() {
  let sponsor: string | undefined;
  let policySigner: string | undefined;
  const configurationErrors: string[] = [];
  try {
    sponsor = getSponsorKeypair().publicKey.toBase58();
  } catch (error) {
    configurationErrors.push(
      error instanceof Error ? error.message : "Account sponsor is unavailable."
    );
  }
  try {
    policySigner = getPolicySignerKeypair().publicKey.toBase58();
  } catch (error) {
    configurationErrors.push(
      error instanceof Error ? error.message : "Policy signer is unavailable."
    );
  }
  return NextResponse.json(
    {
      ...(sponsor ? { sponsor } : {}),
      ...(policySigner ? { policySigner } : {}),
      ...(configurationErrors.length > 0
        ? { configurationError: configurationErrors.join(" ") }
        : {}),
    },
    { status: sponsor ? 200 : 503 }
  );
}

export async function POST(request: Request) {
  try {
    enforceSameOrigin(request);
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      throw new SponsorRequestError(415, "Content-Type must be application/json.");
    }
    const text = await request.text();
    let untrusted: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        untrusted = parsed as Record<string, unknown>;
      }
    } catch {
      // The canonical parser below returns the bounded JSON error.
    }
    if (untrusted?.kind === "session-status") {
      const wallet = parsePublicKey(untrusted.wallet, "Wallet");
      authenticatePrivyWallet({
        cookieHeader: request.headers.get("cookie"),
        wallet,
      });
      return NextResponse.json({ authenticated: true });
    }
    if (untrusted?.kind === "challenge") {
      const wallet = parsePublicKey(untrusted.wallet, "Wallet");
      enforceRateLimit(`challenge:${wallet.toBase58()}`);
      const result = await createWalletChallenge({
        accessToken: request.headers.get("privy-access-token"),
        origin: new URL(request.url).origin,
        wallet,
      });
      return NextResponse.json(result);
    }
    if (untrusted?.kind === "verify") {
      const wallet = parsePublicKey(untrusted.wallet, "Wallet");
      if (
        typeof untrusted.challengeId !== "string" ||
        untrusted.challengeId.length > 64 ||
        typeof untrusted.signature !== "string" ||
        untrusted.signature.length > 128
      ) {
        throw new SponsorRequestError(400, "Wallet challenge response is invalid.");
      }
      enforceRateLimit(`verify:${wallet.toBase58()}`);
      const verified = await verifyWalletChallenge({
        accessToken: request.headers.get("privy-access-token"),
        challengeId: untrusted.challengeId,
        signature: untrusted.signature,
        wallet,
      });
      const response = NextResponse.json({ authenticated: true });
      response.cookies.set(DEMO_SESSION_COOKIE, verified.sessionToken, {
        httpOnly: true,
        maxAge: Math.floor((verified.expiresAt - Date.now()) / 1_000),
        path: "/",
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
      });
      return response;
    }
    const body = parseSponsorBody(text);
    const wallet = parsePublicKey(body.wallet, "Wallet");
    const userId = authenticatePrivyWallet({
      cookieHeader: request.headers.get("cookie"),
      wallet,
    });
    enforceRateLimit(`${userId}:${wallet.toBase58()}`);
    const accountSponsor = getSponsorKeypair();
    const policySigner =
      body.kind === "setup" && body.stage === "settings"
        ? accountSponsor
        : getPolicySignerKeypair();
    const sponsor = accountSponsor;
    const result = await handleSponsorRequest({
      body,
      connection: createMainnetConnection(),
      policySigner,
      sponsor,
      wallet,
    });
    return NextResponse.json(result);
  } catch (error) {
    return responseForError(error);
  }
}
