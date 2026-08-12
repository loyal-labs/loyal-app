/**
 * Telegram utility functions for common operations.
 */

/** Summary generation interval in milliseconds (24 hours) */
export const SUMMARY_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Constructs a display name from Telegram user data.
 */
export function getTelegramDisplayName(user: {
  first_name: string;
  last_name?: string;
}): string {
  return user.first_name + (user.last_name ? ` ${user.last_name}` : "");
}

/**
 * Checks if a chat type is a group chat (group or supergroup).
 */
export function isGroupChat(chatType: string): boolean {
  return chatType === "group" || chatType === "supergroup";
}

/**
 * Checks if a chat type is a community chat (group, supergroup, or channel).
 */
export function isCommunityChat(chatType: string): boolean {
  return (
    chatType === "group" || chatType === "supergroup" || chatType === "channel"
  );
}

/**
 * Checks if a chat type is a private DM.
 */
export function isPrivateChat(chatType: string): boolean {
  return chatType === "private";
}
