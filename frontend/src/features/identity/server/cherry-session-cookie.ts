import "server-only";

export const CHERRY_EMBED_CONTEXT_COOKIE_NAME = "__Host-loyal_cherry_embed";
export const CHERRY_WALLET_SESSION_COOKIE_NAME = "__Host-loyal_cherry_session";

export type CherryPartitionedCookieOptions = {
  httpOnly: true;
  sameSite: "none";
  secure: true;
  partitioned: true;
  path: "/";
  maxAge: number;
};

function extractCookieValue(
  cookieHeader: string | null,
  name: string
): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name && rest.length > 0) {
      return rest.join("=");
    }
  }

  return undefined;
}

export function hasCherryEmbedContext(request: Request): boolean {
  return (
    extractCookieValue(
      request.headers.get("cookie"),
      CHERRY_EMBED_CONTEXT_COOKIE_NAME
    ) === "1"
  );
}

export function createCherryEmbedContextCookieHeader(): string {
  return `${CHERRY_EMBED_CONTEXT_COOKIE_NAME}=1; Path=/; Secure; HttpOnly; SameSite=None; Partitioned`;
}

export function createCherryPartitionedSessionCookieOptions(
  maxAge: number
): CherryPartitionedCookieOptions {
  return {
    httpOnly: true,
    sameSite: "none",
    secure: true,
    partitioned: true,
    path: "/",
    maxAge,
  };
}
