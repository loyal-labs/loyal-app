import { serverEnv } from "../core/config/server";
import { fetchJson, fetchStream } from "../core/http";
import { REDPILL_BASE_URL } from "./constants";
import type { ChatCompletionRequest, ChatCompletionResponse } from "./types";

const getHeaders = () => {
  const apiKey = serverEnv.redpillApiKey;
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
};

export async function chatCompletion(
  request: ChatCompletionRequest
): Promise<ChatCompletionResponse> {
  return fetchJson<ChatCompletionResponse>(
    `${REDPILL_BASE_URL}/chat/completions`,
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(request),
    }
  );
}

export async function* chatCompletionStream(
  request: ChatCompletionRequest
): AsyncGenerator<string> {
  const stream = fetchStream(`${REDPILL_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ ...request, stream: true }),
  });

  for await (const chunk of stream) {
    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      try {
        const data = JSON.parse(line.slice(6));
        const content = data.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch {
        // Skip malformed JSON
      }
    }
  }
}
