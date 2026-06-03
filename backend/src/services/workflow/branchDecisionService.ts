/**
 * branchDecisionService.ts
 *
 * Branch Connection 模式的決策服務。
 * 接收來自同一 sourcePod 出去的所有 branch connections，
 * 呼叫 branchDecider 讓 AI 從中選出一條，
 * 回傳 selectedConnectionId 與 rejectedConnectionIds。
 *
 * 此 service 不再使用 claudeService.executeMcpChat / MCP tool；
 * 改由 branchDecider（內部使用 executeDisposableChat）處理模型呼叫。
 */

import { podStore } from "../podStore.js";
import { configStore } from "../configStore.js";
import { branchDecider } from "../branch/index.js";
import { resolveExecutionPaths } from "../runtime/executionPaths.js";
import { getRunTranscriptWindow } from "./runTranscriptWindow.js";
import { logger } from "../../utils/logger.js";
import { getErrorMessage, isAbortError } from "../../utils/errorHelpers.js";
import type { Connection } from "../../types/index.js";
import type { RunContext } from "../../types/run.js";
import type { BranchDecisionFailure } from "../branch/branchDecider.js";

// 每次決策讀取的最近訊息段數
const RECENT_MESSAGES_COUNT = 4;

class BranchDecisionService {
  /**
   * 讓 AI 從 branchConnections 中選出一條連線。
   *
   * @param canvasId       - 所屬 Canvas ID
   * @param sourcePodId    - 發出 branch 的 Pod ID
   * @param branchConnections - 所有從該 sourcePod 出去、triggerMode === "branch" 的連線
   * @param runContext     - 若在 Run 流程中，帶入 RunContext 以使用 run 專屬訊息
   * @param abortSignal    - 可選的 AbortSignal，透傳給 branchDecider
   * @returns
   *   - selectedConnectionId：AI 選中的連線 ID；決策失敗時為 null
   *   - rejectedConnectionIds：其餘未被選中的連線 ID 陣列
   */
  async decideBranch(
    canvasId: string,
    sourcePodId: string,
    branchConnections: Connection[],
    runContext: RunContext,
    abortSignal?: AbortSignal,
  ): Promise<
    | {
        outcome: "selected";
        selectedConnectionId: string;
        rejectedConnectionIds: string[];
      }
    | {
        outcome: "failed";
        selectedConnectionId: null;
        rejectedConnectionIds: string[];
        failure?: BranchDecisionFailure;
      }
  > {
    // 防呆：branchConnections 不應由外層傳入空陣列，但若發生，提早回傳
    if (branchConnections.length === 0) {
      return {
        outcome: "failed",
        selectedConnectionId: null,
        rejectedConnectionIds: [],
        failure: {
          kind: "parse_error",
          message: "找不到可選擇的 branch connection",
          attempts: [],
        },
      };
    }

    const sourcePod = podStore.getById(canvasId, sourcePodId);
    if (!sourcePod) {
      throw new Error(
        `[BranchDecisionService] 找不到來源 Pod（podId=${sourcePodId}）`,
      );
    }

    const transcriptWindow = getRunTranscriptWindow(
      runContext.runId,
      sourcePodId,
      RECENT_MESSAGES_COUNT,
    );

    const executionPaths = resolveExecutionPaths(sourcePod, runContext);

    const {
      connectionLineProvider: provider,
      connectionLineModel: model,
      connectionLineThinkingLevel: thinkingLevel,
    } = configStore.getConnectionLineModelConfig();

    // targetPodName：從 podStore 查詢，若查不到則 fallback 為 targetPodId
    const branches = branchConnections.map((conn) => {
      const targetPod = podStore.getById(canvasId, conn.targetPodId);
      return {
        label: conn.label,
        description: conn.description,
        targetPodName: targetPod?.name ?? conn.targetPodId,
      };
    });

    let selectedLabel: string;
    let failure: BranchDecisionFailure | undefined;
    try {
      const result = await branchDecider.decide({
        canvasId,
        sourcePodId,
        sourcePodName: sourcePod.name,
        sourcePod,
        branches,
        persistedSummary: transcriptWindow.persistedSummary,
        recentMessages: transcriptWindow.recentMessages,
        provider,
        model,
        thinkingLevel,
        workspacePath: executionPaths.workspacePath,
        runContext,
        abortSignal,
      });
      if (result.kind === "failed") {
        failure = result.failure;
        logger.error(
          "Workflow",
          "Error",
          `[BranchDecisionService] branch 決策失敗：${failure.message}`,
          failure,
        );
        return {
          outcome: "failed",
          selectedConnectionId: null,
          rejectedConnectionIds: branchConnections.map((c) => c.id),
          failure,
        };
      }
      selectedLabel = result.selectedLabel;
    } catch (error) {
      // AbortError：中止訊號觸發，直接向上拋出，由 workflowBranchTriggerService 統一處理
      if (isAbortError(error)) {
        throw error;
      }
      logger.error(
        "Workflow",
        "Error",
        `[BranchDecisionService] branchDecider.decide 發生例外：${getErrorMessage(error)}`,
        error,
      );
      // 非 abort 例外情況：全部 reject
      return {
        outcome: "failed",
        selectedConnectionId: null,
        rejectedConnectionIds: branchConnections.map((c) => c.id),
      };
    }

    const matched = branchConnections.find((c) => c.label === selectedLabel);
    if (!matched) {
      const failure: BranchDecisionFailure = {
        kind: "parse_error",
        message: `selectedLabel "${selectedLabel}" 無法對應任何 branch connection`,
        attempts: [],
      };
      logger.error(
        "Workflow",
        "Error",
        `[BranchDecisionService] ${failure.message}`,
        failure,
      );
      return {
        outcome: "failed",
        selectedConnectionId: null,
        rejectedConnectionIds: branchConnections.map((c) => c.id),
        failure,
      };
    }

    const rejectedConnectionIds = branchConnections
      .filter((c) => c.id !== matched.id)
      .map((c) => c.id);

    return {
      outcome: "selected",
      selectedConnectionId: matched.id,
      rejectedConnectionIds,
    };
  }
}

export const branchDecisionService = new BranchDecisionService();
