/**
 * Streaming service for LLM responses to Telegram.
 * Coordinates between RedPill AI streaming and Telegram message delivery.
 */

import type { Bot } from "grammy";

import { chatCompletionStream, type ChatMessage } from "@/lib/redpill";
import { addMessage } from "@/lib/telegram/bot-thread-service";
import {
  editMessage,
  generateDraftId,
  sendDraft,
  sendMessage,
} from "@/lib/telegram/telegram-writer";

// ============================================================================
// TYPES
// ============================================================================

export interface StreamResponseParams {
  bot: Bot;
  chatId: number;
  threadId: string; // Database thread UUID
  telegramThreadId?: number; // Telegram's message_thread_id for forum topics
  context: ChatMessage[];
  systemPrompt: string;
  model?: string;
}

export interface StreamResponseResult {
  messageId: string; // Database message UUID
  fullText: string;
  telegramMessageId?: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

// Keep this aligned with the model used in RedPill summary generation.
const DEFAULT_MODEL = "phala/gpt-oss-120b";
const UPDATE_INTERVAL_MS = 500; // Update draft every 500ms
const MAX_MESSAGE_LENGTH = 4096; // Telegram limit
const CHUNK_BUFFER = 100; // Buffer before max length for safety

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Splits text at sentence boundaries to respect Telegram's character limit.
 */
export function splitAtSentenceBoundary(
  text: string,
  maxLength: number = MAX_MESSAGE_LENGTH - CHUNK_BUFFER
): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    const chunk = remaining.substring(0, maxLength);

    // Find the last sentence boundary
    const sentenceEndings = [
      chunk.lastIndexOf(". "),
      chunk.lastIndexOf("! "),
      chunk.lastIndexOf("? "),
      chunk.lastIndexOf(".\n"),
      chunk.lastIndexOf("!\n"),
      chunk.lastIndexOf("?\n"),
    ];

    const splitIndex = Math.max(...sentenceEndings);

    if (splitIndex > maxLength * 0.5) {
      // Good sentence boundary found (at least 50% into chunk)
      parts.push(remaining.substring(0, splitIndex + 1).trim());
      remaining = remaining.substring(splitIndex + 2).trim();
    } else {
      // Try word boundary
      const lastSpace = chunk.lastIndexOf(" ");
      if (lastSpace > maxLength * 0.8) {
        parts.push(remaining.substring(0, lastSpace).trim());
        remaining = remaining.substring(lastSpace + 1).trim();
      } else {
        // Hard split as last resort
        parts.push(chunk.trim());
        remaining = remaining.substring(maxLength).trim();
      }
    }
  }

  if (remaining.length > 0) {
    parts.push(remaining);
  }

  return parts;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Streams an LLM response to Telegram with real-time updates.
 *
 * Flow:
 * 1. Start LLM streaming
 * 2. Send draft updates every 500ms using sendMessageDraft
 * 3. When approaching 4096 char limit, finalize and start new message
 * 4. Store complete response encrypted in database
 *
 * @param params - Stream parameters
 * @returns Result with message ID and full text
 */
export async function streamResponse(
  params: StreamResponseParams
): Promise<StreamResponseResult> {
  const {
    bot,
    chatId,
    threadId,
    telegramThreadId,
    context,
    systemPrompt,
    model,
  } = params;

  let fullText = "";
  let currentChunkText = "";
  let lastUpdateTime = 0;
  let fallbackMessageId: number | undefined;
  let currentDraftId = generateDraftId(); // Generate unique draft ID for animated updates
  const sentMessageIds: number[] = [];

  // Build messages array with system prompt
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...context,
  ];

  // Start LLM streaming
  const stream = chatCompletionStream({
    model: model || DEFAULT_MODEL,
    messages,
    temperature: 0.7,
  });

  try {
    for await (const token of stream) {
      fullText += token;
      currentChunkText += token;

      const now = Date.now();
      const shouldUpdate = now - lastUpdateTime >= UPDATE_INTERVAL_MS;

      if (shouldUpdate && currentChunkText.length > 0) {
        // Check if we need to split (approaching limit)
        if (currentChunkText.length > MAX_MESSAGE_LENGTH - CHUNK_BUFFER) {
          // Use sentence-aware splitting for clean message breaks
          const splitChunks = splitAtSentenceBoundary(currentChunkText);
          const finalText = splitChunks[0];
          const remainingText = splitChunks.slice(1).join("");

          if (fallbackMessageId) {
            // Edit existing message with final content
            await editMessage(bot, chatId, fallbackMessageId, finalText);
            sentMessageIds.push(fallbackMessageId);
          } else {
            // Send as final message
            const msgId = await sendMessage(bot, {
              chatId,
              text: finalText,
              messageThreadId: telegramThreadId,
            });
            sentMessageIds.push(msgId);
          }

          // Reset for next chunk with new draft ID
          currentChunkText = remainingText;
          fallbackMessageId = undefined;
          currentDraftId = generateDraftId(); // New draft ID for next message
        } else {
          // Normal update - try sendMessageDraft first
          try {
            await sendDraft(bot, {
              chatId,
              draftId: currentDraftId,
              text: currentChunkText,
              messageThreadId: telegramThreadId,
            });
          } catch (draftError) {
            // sendMessageDraft failed - fallback to send/edit message pattern
            console.warn(
              "sendMessageDraft failed, using fallback:",
              draftError
            );

            if (fallbackMessageId) {
              try {
                await editMessage(
                  bot,
                  chatId,
                  fallbackMessageId,
                  currentChunkText
                );
              } catch (editError) {
                console.warn("Failed to edit fallback message:", editError);
              }
            } else {
              // Send initial message for editing
              try {
                fallbackMessageId = await sendMessage(bot, {
                  chatId,
                  text: currentChunkText,
                  messageThreadId: telegramThreadId,
                });
              } catch (sendError) {
                console.error("Failed to send fallback message:", sendError);
              }
            }
          }
        }

        lastUpdateTime = now;
      }
    }

    // Stream complete - finalize last chunk
    if (currentChunkText.length > 0) {
      // Split if needed
      const chunks = splitAtSentenceBoundary(currentChunkText);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const isFirst = i === 0;

        if (isFirst && fallbackMessageId) {
          // Edit existing message and track it
          await editMessage(bot, chatId, fallbackMessageId, chunk);
          sentMessageIds.push(fallbackMessageId);
        } else {
          // Send new message
          const msgId = await sendMessage(bot, {
            chatId,
            text: chunk,
            messageThreadId: telegramThreadId,
          });
          sentMessageIds.push(msgId);
        }
      }
    }

    // Store complete response in database (encrypted via addMessage)
    const messageId = await addMessage({
      threadId,
      senderType: "bot",
      content: fullText,
      telegramMessageId:
        sentMessageIds.length > 0 ? BigInt(sentMessageIds[0]) : undefined,
    });

    if (!messageId) {
      throw new Error("Failed to store bot response");
    }

    return {
      messageId,
      fullText,
      telegramMessageId: sentMessageIds[0],
    };
  } catch (error) {
    console.error("Stream error:", error);

    // Try to save partial response if we have any content
    if (fullText.length > 0) {
      try {
        await addMessage({
          threadId,
          senderType: "bot",
          content: fullText,
        });
      } catch (saveError) {
        console.error("Failed to save partial response:", saveError);
      }
    }

    // Re-throw to let caller handle user notification
    throw error;
  }
}
