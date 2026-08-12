import type { UIMessage } from "ai";

import { GrpcChatTransport } from "../src/lib/query/transport";

async function main() {
  console.log("Initializing gRPC transport...");
  const transport = new GrpcChatTransport({
    baseUrl: "http://0.0.0.0:8000",
    transportOptions: {
      useBinaryFormat: true,
    },
  });

  console.log("Creating test message...");
  const messages: UIMessage[] = [
    {
      id: "1",
      role: "user",
      parts: [{ type: "text", text: "test" }],
      // @ts-expect-error - createdAt is not a valid property of UIMessage
      createdAt: new Date(),
    },
  ];

  console.log("Sending message to Envoy...");
  try {
    const stream = await transport.sendMessages({
      chatId: "test-chat",
      messages,
      // The following properties are not used by our transport, but are required by the interface
      headers: {},
      body: {},
      metadata: {},
      trigger: "submit-message",
      messageId: undefined,
      abortSignal: new AbortController().signal,
    });

    console.log("Response from server:");
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      console.log(value);
    }
    console.log("Stream finished.");
  } catch (error) {
    console.error("An error occurred:", error);
  }
}

main();
