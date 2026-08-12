const DEFAULT_INLINE_BOT_USERNAME = "askloyal_tgbot";
const TELEGRAM_SUMMARY_INLINE_BOT_USERNAME =
  "TELEGRAM_SUMMARY_INLINE_BOT_USERNAME";
const TELEGRAM_SUMMARY_PEER_OVERRIDE_FROM =
  "TELEGRAM_SUMMARY_PEER_OVERRIDE_FROM";
const TELEGRAM_SUMMARY_PEER_OVERRIDE_TO = "TELEGRAM_SUMMARY_PEER_OVERRIDE_TO";

type EnvRecord = Record<string, string | undefined>;

export type SummaryPeerOverride = {
  fromPeerId: bigint;
  toPeerId: bigint;
};

export type SummaryPublishEnvOptions = {
  inlineBotUsername: string;
  peerOverride: SummaryPeerOverride | null;
};

function normalizeOptionalValue(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseTelegramPeerId(value: string, envName: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new Error(`${envName} must be a valid integer peer ID`);
  }
}

export function loadSummaryPublishEnvOptions(
  env: EnvRecord = process.env
): SummaryPublishEnvOptions {
  const inlineBotUsernameRaw = normalizeOptionalValue(
    env[TELEGRAM_SUMMARY_INLINE_BOT_USERNAME]
  );
  const strippedInlineBotUsername =
    inlineBotUsernameRaw && inlineBotUsernameRaw.startsWith("@")
      ? inlineBotUsernameRaw.slice(1)
      : inlineBotUsernameRaw;

  if (
    strippedInlineBotUsername !== undefined &&
    strippedInlineBotUsername.length === 0
  ) {
    throw new Error(
      `${TELEGRAM_SUMMARY_INLINE_BOT_USERNAME} must not be empty`
    );
  }

  const inlineBotUsername =
    strippedInlineBotUsername ?? DEFAULT_INLINE_BOT_USERNAME;

  const fromValue = normalizeOptionalValue(
    env[TELEGRAM_SUMMARY_PEER_OVERRIDE_FROM]
  );
  const toValue = normalizeOptionalValue(
    env[TELEGRAM_SUMMARY_PEER_OVERRIDE_TO]
  );

  if (!fromValue && !toValue) {
    return {
      inlineBotUsername,
      peerOverride: null,
    };
  }

  if (!fromValue || !toValue) {
    throw new Error(
      `${TELEGRAM_SUMMARY_PEER_OVERRIDE_FROM} and ${TELEGRAM_SUMMARY_PEER_OVERRIDE_TO} must both be set`
    );
  }

  return {
    inlineBotUsername,
    peerOverride: {
      fromPeerId: parseTelegramPeerId(
        fromValue,
        TELEGRAM_SUMMARY_PEER_OVERRIDE_FROM
      ),
      toPeerId: parseTelegramPeerId(toValue, TELEGRAM_SUMMARY_PEER_OVERRIDE_TO),
    },
  };
}

export function resolveSummarySourceChatId(
  requestChatId: bigint,
  peerOverride: SummaryPeerOverride | null
): bigint {
  if (!peerOverride) {
    return requestChatId;
  }

  if (requestChatId === peerOverride.fromPeerId) {
    return peerOverride.toPeerId;
  }

  return requestChatId;
}
