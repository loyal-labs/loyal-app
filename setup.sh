#!/usr/bin/env bash
set -euo pipefail

MARKETPLACE="vladzima/claude-telegram-enhanced"
PLUGIN="telegram-enhanced@claude-telegram-enhanced"
CHANNEL="plugin:telegram-enhanced@claude-telegram-enhanced"
TOKEN_FILE="$HOME/.claude/channels/telegram/.env"
TOKEN_VAR="TELEGRAM_BOT_TOKEN"

# 1. Register marketplace and install plugin (idempotent — safe to re-run)
echo "Ensuring enhanced Telegram plugin is installed..."
claude plugin marketplace add "$MARKETPLACE" 2>/dev/null || true
# Pull latest from marketplace repo (marketplace add skips if already on disk)
MARKETPLACE_DIR="$HOME/.claude/plugins/marketplaces/claude-telegram-enhanced"
if [ -d "$MARKETPLACE_DIR/.git" ]; then
  git -C "$MARKETPLACE_DIR" pull --ff-only origin main 2>/dev/null || true
fi
claude plugin install "$PLUGIN" 2>/dev/null || true
# Neutralize official telegram plugin — Claude auto-installs it on startup, and it
# competes for bot updates via the same token. Replace its entry point with a no-op
# so even when re-installed, it can't poll.
# Run unconditionally after install (Claude may have regenerated the cache).
OFFICIAL_PLUGIN="$HOME/.claude/plugins/cache/claude-plugins-official/telegram"
find "$OFFICIAL_PLUGIN" -name "server.ts" -exec sh -c 'echo "process.exit(0)" > "$1"' _ {} \; 2>/dev/null || true

# 2. Ensure the bot token is configured
if [ -f "$TOKEN_FILE" ] && grep -q "^${TOKEN_VAR}=" "$TOKEN_FILE" 2>/dev/null; then
  echo "Telegram bot token already configured."
else
  if [ ! -t 0 ]; then
    echo "ERROR: No bot token configured and running non-interactively."
    echo "  Run ./setup.sh manually first to set the token."
    exit 1
  fi

  echo ""
  echo "No Telegram bot token found."
  echo "Create a bot via @BotFather on Telegram (enable Threaded Mode for topics),"
  echo "then paste the token below."
  echo ""
  printf "Bot token: "
  read -r TOKEN

  if [ -z "$TOKEN" ]; then
    echo "No token provided, skipping Telegram setup."
    exit 1
  fi

  mkdir -p "$(dirname "$TOKEN_FILE")"
  echo "${TOKEN_VAR}=${TOKEN}" > "$TOKEN_FILE"
  echo "Token saved."
fi

# 3. Resolve chat ID for topic creation
#    On first run, prompt for the chat ID. Saved for future sessions.
if [ -f "$TOKEN_FILE" ] && grep -q "^TELEGRAM_CHAT_ID=" "$TOKEN_FILE" 2>/dev/null; then
  CHAT_ID=$(grep "^TELEGRAM_CHAT_ID=" "$TOKEN_FILE" | sed 's/^TELEGRAM_CHAT_ID=//')
else
  echo ""
  echo "To create per-worktree topics, we need your Telegram chat ID."
  echo "DM @userinfobot on Telegram to get it, then paste below."
  echo "(Leave empty to skip topic routing.)"
  echo ""
  printf "Chat ID: "
  read -r CHAT_ID

  if [ -n "$CHAT_ID" ]; then
    echo "TELEGRAM_CHAT_ID=${CHAT_ID}" >> "$TOKEN_FILE"
    echo "Chat ID saved."
  fi
fi

# 4. Derive topic name: Superset display name > git branch > directory name
BRANCH="$(git branch --show-current 2>/dev/null)" || true
TOPIC_NAME="${SUPERSET_WORKSPACE_NAME:-${BRANCH:-$(basename "$(pwd)")}}"

# 5. Launch Claude Code with Telegram channel + topic routing
echo "Starting Claude Code with Telegram (topic: ${TOPIC_NAME})..."
export TELEGRAM_TOPIC_NAME="$TOPIC_NAME"
if [ -n "${CHAT_ID:-}" ]; then
  export TELEGRAM_TOPIC_CHAT_ID="$CHAT_ID"
fi
exec claude --dangerously-skip-permissions \
  --dangerously-load-development-channels "$CHANNEL"
