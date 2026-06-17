import { f } from "@ax-llm/ax";

import examplesV1 from "./assets/examples/v1.json";
import rulesV1 from "./assets/rules/v1.json";
import type { SummaryGenerationResponse, SummaryProgramSpec } from "./types";
import { validateSummaryOneliner, validateSummaryTopics } from "./validation";

const topicExtractionSignature = f()
  .input("chatTitle", f.string("Telegram group chat title"))
  .input("dayKeyUtc", f.string("Target UTC day key in YYYY-MM-DD format"))
  .input(
    "participants",
    f
      .string("Participant display names present in transcript")
      .array("Known participant display names")
  )
  .input(
    "messageTranscript",
    f.string("Chat transcript in 'Name: message' lines ordered chronologically")
  )
  .input(
    "qualityRules",
    f.string("Quality rubric for topic and source selection")
  )
  .output(
    "topics",
    f.json("JSON array of 1-5 topics: [{title, content, sources[]}]")
  )
  .description(
    "Generate a factual, concise daily summary of meaningful chat topics. Ignore greetings, spam, and repetitive chatter. Return 1-5 topics with contributor names in sources."
  )
  .build();

const onelinerSignature = f()
  .input("chatTitle", f.string("Telegram group chat title"))
  .input("dayKeyUtc", f.string("Target UTC day key in YYYY-MM-DD format"))
  .input(
    "topics",
    f.json("JSON array of structured topics: [{title, content, sources[]}]")
  )
  .output(
    "oneliner",
    f.string("Single plain sentence that captures the day, max 110 chars")
  )
  .description(
    "Write one concise non-hype sentence that captures the day across the provided topics."
  )
  .build();

const RULES_TEXT = rulesV1.rules.join(" ");

const topicExamples = examplesV1.examples.map((example) => ({
  chatTitle: example.input.chatTitle,
  dayKeyUtc: example.input.dayKeyUtc,
  messageTranscript: example.input.transcript,
  participants: example.input.participants,
  qualityRules: RULES_TEXT,
  topics: example.expectedOutput.topics,
}));

const onelinerExamples = examplesV1.examples.map((example) => ({
  chatTitle: example.input.chatTitle,
  dayKeyUtc: example.input.dayKeyUtc,
  oneliner: example.expectedOutput.oneliner,
  topics: example.expectedOutput.topics,
}));

const topicAssertions: SummaryProgramSpec["topicExtraction"]["assertions"] = [
  (values) => {
    const result = validateSummaryTopics(values.topics);
    return result.ok || result.reason;
  },
];

const onelinerAssertions: SummaryProgramSpec["oneliner"]["assertions"] = [
  (values) => {
    const result = validateSummaryOneliner(values.oneliner);
    return result.ok || result.reason;
  },
];

const SUMMARY_PROGRAM_SPECS: Record<string, SummaryProgramSpec> = {
  v1: {
    defaults: {
      onelinerTemperature: 0.5,
      topicTemperature: 0.3,
    },
    id: examplesV1.id,
    metric: (response: SummaryGenerationResponse) => {
      return response.topics.length > 0 && response.oneliner.length > 0 ? 1 : 0;
    },
    oneliner: {
      assertions: onelinerAssertions,
      examples: onelinerExamples,
      signature: onelinerSignature,
    },
    qualityRules: RULES_TEXT,
    topicExtraction: {
      assertions: topicAssertions,
      examples: topicExamples,
      signature: topicExtractionSignature,
    },
    version: examplesV1.version,
  },
};

export function getSummaryProgramSpec(version: string): SummaryProgramSpec {
  const spec = SUMMARY_PROGRAM_SPECS[version];
  if (!spec) {
    throw new Error(`Unsupported summary program spec version: ${version}`);
  }

  return spec;
}

export const DEFAULT_SUMMARY_PROGRAM_SPEC = SUMMARY_PROGRAM_SPECS.v1;
