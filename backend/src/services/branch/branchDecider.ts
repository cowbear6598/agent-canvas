/**
 * branchDecider
 *
 * BranchDecider 介面定義與相關 input/output 型別。
 * 三家 provider（claude / codex / gemini）共用此介面。
 */

import type { PersistedMessage } from "../../types/persistence.js";
import type { Pod } from "../../types/pod.js";
import type { RunContext } from "../../types/run.js";
import type { ProviderName } from "../provider/index.js";

// ─── Input / Output ───────────────────────────────────────────────────────────

export interface BranchDecisionInput {
  canvasId: string;
  sourcePodId: string;
  sourcePodName: string;
  sourcePod?: Pod;
  branches: Array<{
    label: string;
    description?: string;
    targetPodName: string;
  }>;
  persistedSummary?: string | null;
  recentMessages: PersistedMessage[];
  provider: ProviderName;
  model: string;
  workspacePath: string;
  runContext?: RunContext;
  abortSignal?: AbortSignal;
}

/** "None" 為合法值，代表 AI 判斷無任何 branch 符合條件 */
export interface BranchDecisionOutput {
  selectedLabel: string;
}

// ─── 介面定義 ─────────────────────────────────────────────────────────────────

export interface BranchDecider {
  decide(input: BranchDecisionInput): Promise<BranchDecisionOutput>;
}
