export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatCompletionResponse {
  id: string;
  choices: { message: ChatMessage; finish_reason: string }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface AttestationReport {
  model: string;
  signing_address: string;
  signing_algo: "ecdsa" | "ed25519";
  nonce: string;
  intel_quote: string;
  nvidia_payload: string;
  verified: boolean;
  info?: { tcb_info?: { app_compose?: string } };
}

export interface SignatureResponse {
  request_id: string;
  model: string;
  signature: {
    algorithm: string;
    curve: string;
    value: string;
    public_key: string;
  };
  payload: {
    request_hash: string;
    response_hash: string;
    timestamp: string;
  };
}

export interface VerificationResult {
  valid: boolean;
  attestation?: AttestationReport;
  signerAddress?: string;
  error?: string;
}
