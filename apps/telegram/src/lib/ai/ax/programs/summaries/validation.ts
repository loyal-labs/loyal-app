import {
  normalizeWhitespace,
  validationFailure,
  type ValidationResult,
  validationSuccess,
} from "@loyal-labs/llm-core";

import type { SummaryTopic } from "./types";

const MAX_ONELINER_CHARS = 110;
const MAX_TOPICS = 5;
const MIN_TOPICS = 1;

export type ValidateSummaryTopicsOptions = {
  participants?: string[];
};

export function normalizeParticipantName(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

export function dedupeParticipants(participants: string[]): string[] {
  const uniqueParticipants: string[] = [];
  const seen = new Set<string>();

  for (const participant of participants) {
    const displayName = normalizeWhitespace(participant);
    const normalized = normalizeParticipantName(displayName);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    uniqueParticipants.push(displayName);
    seen.add(normalized);
  }

  return uniqueParticipants;
}

export function trimOneliner(oneliner: string): string {
  return normalizeWhitespace(oneliner).slice(0, MAX_ONELINER_CHARS);
}

export function validateSummaryOneliner(
  oneliner: unknown
): ValidationResult<string> {
  if (typeof oneliner !== "string") {
    return validationFailure("oneliner must be a string");
  }

  const normalized = normalizeWhitespace(oneliner);
  if (!normalized) {
    return validationFailure("oneliner must not be empty");
  }

  if (normalized.length > MAX_ONELINER_CHARS) {
    return validationFailure(
      `oneliner must be <= ${MAX_ONELINER_CHARS} characters`
    );
  }

  return validationSuccess(normalized);
}

export function validateSummaryTopics(
  topics: unknown,
  options?: ValidateSummaryTopicsOptions
): ValidationResult<SummaryTopic[]> {
  if (!Array.isArray(topics)) {
    return validationFailure("topics must be an array");
  }

  if (topics.length < MIN_TOPICS || topics.length > MAX_TOPICS) {
    return validationFailure(
      `topics must contain ${MIN_TOPICS}-${MAX_TOPICS} items`
    );
  }

  const participantSet = new Set(
    (options?.participants ?? [])
      .map(normalizeParticipantName)
      .filter((name) => name.length > 0)
  );

  const normalizedTopics: SummaryTopic[] = [];

  for (const [index, topic] of topics.entries()) {
    if (typeof topic !== "object" || topic === null) {
      return validationFailure(`topic ${index + 1} must be an object`);
    }

    const record = topic as Record<string, unknown>;
    const title =
      typeof record.title === "string" ? normalizeWhitespace(record.title) : "";
    const content =
      typeof record.content === "string"
        ? normalizeWhitespace(record.content)
        : "";

    if (!title) {
      return validationFailure(`topic ${index + 1} title is required`);
    }

    if (!content) {
      return validationFailure(`topic ${index + 1} content is required`);
    }

    const sourcesRaw = Array.isArray(record.sources) ? record.sources : [];
    if (sourcesRaw.length === 0) {
      return validationFailure(
        `topic ${index + 1} requires at least one source`
      );
    }

    const sources = sourcesRaw
      .filter((source): source is string => typeof source === "string")
      .map(normalizeWhitespace)
      .filter((source) => source.length > 0);

    if (sources.length === 0) {
      return validationFailure(
        `topic ${index + 1} requires non-empty source names`
      );
    }

    if (participantSet.size > 0) {
      for (const source of sources) {
        if (!participantSet.has(normalizeParticipantName(source))) {
          return validationFailure(
            `topic ${index + 1} source '${source}' is not in participant list`
          );
        }
      }
    }

    normalizedTopics.push({
      content,
      sources,
      title,
    });
  }

  return validationSuccess(normalizedTopics);
}
