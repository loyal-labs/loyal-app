import { type Resolvable, resolve } from "@ai-sdk/provider-utils";
import { create } from "@bufbuild/protobuf";
import {
  createClient,
  type Interceptor,
  type Transport,
} from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";

import {
  type DialogEntry,
  DialogEntrySchema,
  QueryRequestSchema,
  type QueryResponse,
  QueryService,
  Role_Type,
  RoleSchema,
} from "@/lib/generated/query_schemas_pb";

export type PrepareGrpcSendMessagesRequest<UI_MESSAGE extends UIMessage> = (
  options: {
    id: string;
    messages: UI_MESSAGE[];
    requestMetadata: unknown;
    body: Record<string, unknown> | undefined;
    headers: Record<string, string> | Headers | undefined;
    baseUrl: string;
  } & {
    trigger: "submit-message" | "regenerate-message";
    messageId: string | undefined;
  }
) =>
  | {
      body?: object;
      headers?: Record<string, string> | Headers;
      baseUrl?: string;
    }
  | PromiseLike<{
      body?: object;
      headers?: Record<string, string> | Headers;
      baseUrl?: string;
    }>;

export type PrepareGrpcReconnectToStreamRequest = (options: {
  id: string;
  requestMetadata: unknown;
  body: Record<string, unknown> | undefined;
  headers: Record<string, string> | Headers | undefined;
  baseUrl: string;
}) =>
  | {
      headers?: Record<string, string> | Headers;
      baseUrl?: string;
    }
  | PromiseLike<{
      headers?: Record<string, string> | Headers;
      baseUrl?: string;
    }>;

/**
 * Options for the `GrpcChatTransport` class.
 *
 * @param UI_MESSAGE - The type of message to be used in the chat.
 */
export type GrpcChatTransportInitOptions<UI_MESSAGE extends UIMessage> = {
  /**
   * The gRPC server base URL.
   * @example "https://your-grpc-server.com"
   */
  baseUrl: string;

  /**
   * gRPC headers to be sent with the request.
   */
  headers?: Resolvable<Record<string, string> | Headers>;

  /**
   * Extra body object to be sent with the gRPC request.
   * This will be merged with the dialog and query in the protobuf request.
   */
  body?: Resolvable<object>;

  /**
   * Connect transport options
   */
  transportOptions?: {
    useBinaryFormat?: boolean;
    interceptors?: Interceptor[];
    defaultTimeoutMs?: number;
  };

  /**
   * When a function is provided, it will be used
   * to prepare the gRPC request. This can be useful for
   * customizing the request based on the messages and data in the chat.
   */
  prepareSendMessagesRequest?: PrepareGrpcSendMessagesRequest<UI_MESSAGE>;

  /**
   * When a function is provided, it will be used
   * to prepare the reconnect request.
   */
  prepareReconnectToStreamRequest?: PrepareGrpcReconnectToStreamRequest;
};

export class GrpcChatTransport<UI_MESSAGE extends UIMessage>
  implements ChatTransport<UI_MESSAGE>
{
  protected baseUrl: string;
  protected headers: GrpcChatTransportInitOptions<UI_MESSAGE>["headers"];
  protected body: GrpcChatTransportInitOptions<UI_MESSAGE>["body"];
  protected transportOptions: GrpcChatTransportInitOptions<UI_MESSAGE>["transportOptions"];
  protected prepareSendMessagesRequest?: PrepareGrpcSendMessagesRequest<UI_MESSAGE>;
  protected prepareReconnectToStreamRequest?: PrepareGrpcReconnectToStreamRequest;

  constructor({
    baseUrl,
    headers,
    body,
    transportOptions,
    prepareSendMessagesRequest,
    prepareReconnectToStreamRequest,
  }: GrpcChatTransportInitOptions<UI_MESSAGE>) {
    this.baseUrl = baseUrl;
    this.headers = headers;
    this.body = body;
    this.transportOptions = transportOptions;
    this.prepareSendMessagesRequest = prepareSendMessagesRequest;
    this.prepareReconnectToStreamRequest = prepareReconnectToStreamRequest;
  }

  private createClient(baseUrl: string, headers?: Record<string, string>) {
    const transport: Transport = createConnectTransport({
      baseUrl,
      useBinaryFormat: true,
      interceptors: this.transportOptions?.interceptors ?? [],
      ...(headers && { defaultHeaders: headers }),
    });

    return createClient(QueryService, transport);
  }

  async sendMessages({
    abortSignal,
    ...options
  }: Parameters<ChatTransport<UI_MESSAGE>["sendMessages"]>[0]): Promise<
    ReadableStream<UIMessageChunk>
  > {
    const resolvedBody = await resolve(this.body);
    const resolvedHeaders = await resolve(this.headers);

    const preparedRequest = await this.prepareSendMessagesRequest?.({
      baseUrl: this.baseUrl,
      id: options.chatId,
      messages: options.messages,
      body: { ...resolvedBody, ...options.body },
      headers: { ...resolvedHeaders, ...options.headers },
      requestMetadata: options.metadata,
      trigger: options.trigger,
      messageId: options.messageId,
    });

    // Helper function to normalize headers
    const normalizeHeaders = (
      headers: Record<string, string> | Headers | undefined
    ): Record<string, string> | undefined => {
      if (!headers) return;
      if (headers instanceof Headers) {
        const normalized: Record<string, string> = {};
        headers.forEach((value, key) => {
          normalized[key] = value;
        });
        return normalized;
      }
      return headers;
    };

    const baseUrl = preparedRequest?.baseUrl ?? this.baseUrl;
    const headers = normalizeHeaders(
      preparedRequest?.headers !== undefined
        ? preparedRequest.headers
        : { ...resolvedHeaders, ...options.headers }
    );

    const client = this.createClient(baseUrl, headers);

    // Convert UI messages to protobuf DialogEntry format
    const dialogEntries: DialogEntry[] = options.messages.map((msg) =>
      create(DialogEntrySchema, {
        role: create(RoleSchema, {
          type: msg.role === "user" ? Role_Type.USER : Role_Type.ASSISTANT,
        }),
        content: msg.parts.find((p) => p.type === "text")?.text ?? "",
        date: BigInt(Date.now()),
      })
    );

    // Get the latest user message as the query
    const lastUserMessage = options.messages
      .slice()
      .reverse()
      .find((msg) => msg.role === "user");

    if (!lastUserMessage) {
      throw new Error("No user message found to send as query");
    }

    // Create the gRPC request
    const request = create(QueryRequestSchema, {
      dialog: dialogEntries,
      query: lastUserMessage.parts.find((p) => p.type === "text")?.text ?? "",
    });

    try {
      const response: QueryResponse = await client.query(request, {
        signal: abortSignal,
      });

      // Convert the gRPC response to the expected ReadableStream format
      return this.processGrpcResponse(response, options.chatId);
    } catch (error) {
      throw new Error(
        `gRPC call failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    console.warn("reconnectToStream not implemented for gRPC transport");
    return null;
  }

  protected processGrpcResponse(
    response: QueryResponse,
    chatId: string
  ): ReadableStream<UIMessageChunk> {
    return new ReadableStream<UIMessageChunk>({
      start(controller) {
        controller.enqueue({
          type: "text-start",
          id: `${chatId}-response-${Date.now()}`,
        });
        try {
          // Create a single chunk with the complete response
          const chunk: UIMessageChunk = {
            type: "text-delta",
            delta: response.response,
            id: `${chatId}-response-${Date.now()}`,
          };
          controller.enqueue(chunk);
          controller.enqueue({
            type: "text-end",
            id: `${chatId}-response-${Date.now()}`,
          });
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });
  }
}
