import { verifyMessage } from "ethers";

import { serverEnv } from "../core/config/server";
import { fetchJson } from "../core/http";
import { REDPILL_BASE_URL } from "./constants";
import type {
  AttestationReport,
  ChatCompletionRequest,
  ChatCompletionResponse,
  SignatureResponse,
  VerificationResult,
} from "./types";

const getHeaders = () => {
  const apiKey = serverEnv.redpillApiKey;
  return { Authorization: `Bearer ${apiKey}` };
};

function encodeText(value: string) {
  return Uint8Array.from(new TextEncoder().encode(value));
}

export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function fetchAttestation(
  model: string,
  nonce?: string
): Promise<AttestationReport> {
  const params = new URLSearchParams({ model });
  if (nonce) params.set("nonce", nonce);
  return fetchJson<AttestationReport>(
    `${REDPILL_BASE_URL}/attestation/report?${params}`,
    { method: "GET" }
  );
}

export async function fetchSignature(
  requestId: string,
  model: string
): Promise<SignatureResponse> {
  const params = new URLSearchParams({ model });
  return fetchJson<SignatureResponse>(
    `${REDPILL_BASE_URL}/signature/${requestId}?${params}`,
    { method: "GET", headers: getHeaders() }
  );
}

async function sha256Hex(data: string): Promise<string> {
  const encoded = encodeText(data);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifySignature(
  signature: SignatureResponse,
  expectedRequestHash: string,
  expectedResponseHash: string
): Promise<VerificationResult> {
  try {
    const { payload, signature: sig } = signature;

    if (
      payload.request_hash !== expectedRequestHash ||
      payload.response_hash !== expectedResponseHash
    ) {
      return { valid: false, error: "Hash mismatch" };
    }

    const message = `${payload.request_hash}:${payload.response_hash}`;
    const recovered = verifyMessage(message, sig.value);

    return {
      valid: recovered.toLowerCase() === sig.public_key.toLowerCase(),
      signerAddress: recovered,
    };
  } catch (error) {
    return { valid: false, error: String(error) };
  }
}

export async function verifyResponse(
  request: ChatCompletionRequest,
  response: ChatCompletionResponse,
  model: string
): Promise<VerificationResult> {
  try {
    const [requestHash, responseHash, signature, attestation] =
      await Promise.all([
        sha256Hex(JSON.stringify(request)),
        sha256Hex(JSON.stringify(response)),
        fetchSignature(response.id, model),
        fetchAttestation(model, generateNonce()),
      ]);

    const sigResult = await verifySignature(
      signature,
      requestHash,
      responseHash
    );

    if (!sigResult.valid) return sigResult;

    const addressMatch =
      sigResult.signerAddress?.toLowerCase() ===
      attestation.signing_address.toLowerCase();

    return {
      valid: addressMatch && attestation.verified,
      attestation,
      signerAddress: sigResult.signerAddress,
      error: !addressMatch
        ? "Signer address mismatch with attestation"
        : undefined,
    };
  } catch (error) {
    return { valid: false, error: String(error) };
  }
}
