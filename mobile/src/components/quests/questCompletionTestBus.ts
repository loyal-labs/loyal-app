// TEMPORARY test bus — lets the Settings screen fire the quest-completion
// notification on demand, without completing real quests. Remove together with
// the matching "Test: …" rows in app/(tabs)/profile.tsx and the subscription in
// QuestCompletionWatcher.tsx.

import type { QuestCompleteVariant } from "./QuestCompleteNotification";

type Listener = (variant: QuestCompleteVariant) => void;

const listeners = new Set<Listener>();

export function emitQuestCompleteTest(variant: QuestCompleteVariant): void {
  for (const listener of listeners) listener(variant);
}

export function subscribeQuestCompleteTest(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
