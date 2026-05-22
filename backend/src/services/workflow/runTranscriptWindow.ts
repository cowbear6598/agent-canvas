import type { PersistedMessage } from "../../types/index.js";
import { runStore } from "../runStore.js";

export interface RunTranscriptWindow {
  persistedSummary: string | null;
  recentMessages: PersistedMessage[];
}

export function getRunTranscriptWindow(
  runId: string,
  podId: string,
  limit: number,
): RunTranscriptWindow {
  const instance = runStore.getPodInstance(runId, podId);
  const page = runStore.getRunMessagesPage(runId, podId, { limit });

  return {
    persistedSummary: instance?.lastResponseSummary ?? null,
    recentMessages: page.messages,
  };
}
