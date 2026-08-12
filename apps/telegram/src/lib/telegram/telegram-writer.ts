/**
 * Telegram message writer abstraction.
 * Handles sendMessageDraft for streaming, with fallback to regular messages.
 */

import type { Bot } from "grammy";

// ============================================================================
// TYPES
// ============================================================================

export interface SendDraftParams {
  chatId: number;
  draftId: number; // Must be non-zero; same ID = animated updates
  text: string;
  messageThreadId?: number;
  parseMode?: "Markdown" | "MarkdownV2" | "HTML";
}

export interface SendMessageParams {
  chatId: number;
  text: string;
  messageThreadId?: number;
  parseMode?: "Markdown" | "MarkdownV2" | "HTML";
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1000;

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Retry wrapper with exponential backoff.
 * Handles Telegram rate limits (429) and transient errors.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number = MAX_RETRIES
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Check for rate limiting
      const apiError = error as {
        error_code?: number;
        parameters?: { retry_after?: number };
      };
      if (apiError.error_code === 429) {
        const waitTime = (apiError.parameters?.retry_after || 1) * 1000;
        console.warn(`Rate limited, waiting ${waitTime}ms before retry`);
        await sleep(waitTime);
        continue;
      }

      // Check for user blocked bot (403)
      if (apiError.error_code === 403) {
        throw new Error("User blocked the bot");
      }

      // Exponential backoff for other errors
      if (attempt < retries - 1) {
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
        console.warn(`Telegram API error, retrying in ${delay}ms:`, error);
        await sleep(delay);
      }
    }
  }

  throw lastError || new Error("Retry failed");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Sends a message draft for streaming display.
 * Uses Telegram Bot API 9.3+ sendMessageDraft method via Grammy.
 * Same draft_id produces animated updates for smooth streaming.
 *
 * @param bot - Grammy bot instance
 * @param params - Draft parameters including draftId for tracking
 * @returns true on success
 */
export async function sendDraft(
  bot: Bot,
  params: SendDraftParams
): Promise<boolean> {
  return withRetry(async () => {
    const result = await bot.api.sendMessageDraft(
      params.chatId,
      params.draftId,
      params.text,
      {
        message_thread_id: params.messageThreadId,
        parse_mode: params.parseMode,
      }
    );

    return result === true;
  });
}

/**
 * Generates a unique draft ID for a streaming session.
 * Uses timestamp + random to ensure uniqueness.
 */
export function generateDraftId(): number {
  // Use lower 31 bits of timestamp + random to stay in safe integer range
  return (
    (Date.now() & 0x7fffffff) ^ Math.floor(Math.random() * 0x7fffffff) || 1
  );
}

/**
 * Sends a final message (after streaming is complete).
 *
 * @param bot - Grammy bot instance
 * @param params - Message parameters
 * @returns Message ID of the sent message
 */
export async function sendMessage(
  bot: Bot,
  params: SendMessageParams
): Promise<number> {
  return withRetry(async () => {
    const result = await bot.api.sendMessage(params.chatId, params.text, {
      message_thread_id: params.messageThreadId,
      parse_mode: params.parseMode,
    });

    return result.message_id;
  });
}

/**
 * Edits an existing message text.
 * Used as fallback when sendMessageDraft is not available.
 *
 * @param bot - Grammy bot instance
 * @param chatId - Chat ID
 * @param messageId - Message ID to edit
 * @param text - New text content
 * @param parseMode - Optional parse mode
 */
export async function editMessage(
  bot: Bot,
  chatId: number,
  messageId: number,
  text: string,
  parseMode?: "Markdown" | "MarkdownV2" | "HTML"
): Promise<void> {
  return withRetry(async () => {
    await bot.api.editMessageText(chatId, messageId, text, {
      parse_mode: parseMode,
    });
  });
}
