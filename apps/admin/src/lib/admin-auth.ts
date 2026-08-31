const textEncoder = new TextEncoder();
const SESSION_HEADER = {
  alg: "HS256",
  typ: "JWT",
} as const;

export const ADMIN_SESSION_COOKIE = "loyal_admin_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 3;

export type SessionPayload = {
  sub: string;
  iat: number;
  exp: number;
};

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function encodeBase64Url(bytes: Uint8Array) {
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (padded.length % 4)) % 4;

  return base64ToBytes(`${padded}${"=".repeat(padLength)}`);
}

function encodeJson(data: unknown) {
  const json = JSON.stringify(data);
  return encodeBase64Url(textEncoder.encode(json));
}

function decodeJson<T>(value: string) {
  try {
    const bytes = decodeBase64Url(value);
    const decoded = new TextDecoder().decode(bytes);
    return JSON.parse(decoded) as T;
  } catch {
    return null;
  }
}

function encodeText(value: string) {
  return Uint8Array.from(textEncoder.encode(value));
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function getSigningKey() {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) {
    return null;
  }

  return crypto.subtle.importKey(
    "raw",
    encodeText(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export function validateAdminCredentials(user: string, password: string) {
  const expectedUser = process.env.ADMIN_USER;
  const expectedPassword = process.env.ADMIN_PASSWORD;

  if (!expectedUser || !expectedPassword) {
    return false;
  }

  return (
    constantTimeEqual(user, expectedUser) &&
    constantTimeEqual(password, expectedPassword)
  );
}

export function createSessionPayload(user: string): SessionPayload {
  const issuedAt = Math.floor(Date.now() / 1000);
  return {
    sub: user,
    iat: issuedAt,
    exp: issuedAt + SESSION_TTL_SECONDS,
  };
}

export async function signSessionToken(payload: SessionPayload) {
  const key = await getSigningKey();
  if (!key) {
    return null;
  }

  const encodedHeader = encodeJson(SESSION_HEADER);
  const encodedPayload = encodeJson(payload);
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encodeText(unsignedToken)
  );
  const encodedSignature = encodeBase64Url(new Uint8Array(signature));

  return `${unsignedToken}.${encodedSignature}`;
}

export async function verifySessionToken(token: string | undefined | null) {
  if (!token) {
    return null;
  }

  const segments = token.split(".");
  if (segments.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  const header = decodeJson<{ alg?: string; typ?: string }>(encodedHeader);

  if (
    header?.alg !== SESSION_HEADER.alg ||
    header?.typ !== SESSION_HEADER.typ
  ) {
    return null;
  }

  const key = await getSigningKey();
  if (!key) {
    return null;
  }

  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const expectedSignatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encodeText(unsignedToken)
  );
  const expectedSignature = encodeBase64Url(
    new Uint8Array(expectedSignatureBuffer)
  );

  if (!constantTimeEqual(encodedSignature, expectedSignature)) {
    return null;
  }

  const payload = decodeJson<Partial<SessionPayload>>(encodedPayload);
  if (!payload || typeof payload.sub !== "string") {
    return null;
  }

  if (typeof payload.exp !== "number" || typeof payload.iat !== "number") {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    return null;
  }

  return payload as SessionPayload;
}

export class AdminAuthenticationError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "AdminAuthenticationError";
  }
}

export async function requireValidAdminSessionToken(
  token: string | undefined | null
): Promise<SessionPayload> {
  const session = await verifySessionToken(token);
  if (!session) {
    throw new AdminAuthenticationError();
  }

  return session;
}

export function getSafeNextPath(
  value: string | undefined | null,
  baseUrl: string | URL
): string | null {
  if (!value || !value.startsWith("/")) {
    return null;
  }

  let base: URL;
  let target: URL;
  try {
    base = typeof baseUrl === "string" ? new URL(baseUrl) : baseUrl;
    target = new URL(value, base);
  } catch {
    return null;
  }

  if (target.origin !== base.origin) {
    return null;
  }

  return `${target.pathname}${target.search}${target.hash}`;
}

export function isSafeNextPath(
  value: string | undefined | null,
  baseUrl: string | URL
) {
  return getSafeNextPath(value, baseUrl) !== null;
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
