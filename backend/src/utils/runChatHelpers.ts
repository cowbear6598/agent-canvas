import { v4 as uuidv4 } from "uuid";
import type { RunContext } from "../types/run.js";
import type { ContentBlock } from "../types/index.js";
import { WebSocketResponseEvents } from "../schemas/index.js";
import { runStore } from "../services/runStore.js";
import { socketService } from "../services/socketService.js";
import { extractDisplayContent } from "./chatHelpers.js";
import { runExecutionService } from "../services/workflow/runExecutionService.js";
import { executeStreamingChat } from "../services/claude/streamingChatExecutor.js";
import { RunModeExecutionStrategy } from "../services/executionStrategy.js";
import { podStore } from "../services/podStore.js";
import { tryExpandCommandMessage } from "../services/commandExpander.js";
import { logger } from "./logger.js";

export interface LaunchMultiInstanceRunParams {
  canvasId: string;
  podId: string;
  message: string | ContentBlock[];
  displayMessage?: string;
  abortable: boolean;
  onComplete: (runContext: RunContext) => void;
  onAborted?: (canvasId: string, podId: string, messageId: string) => void;
  onRunContextCreated?: (runContext: RunContext) => void;
  /**
   * Pod 綁定的 Command 已不存在時觸發。
   * 未提供時：記錄 warn 並繼續以原始訊息執行。
   */
  onCommandNotFound?: (commandId: string) => void;
}

export async function launchMultiInstanceRun(
  params: LaunchMultiInstanceRunParams,
): Promise<RunContext> {
  const {
    canvasId,
    podId,
    message,
    displayMessage,
    abortable,
    onComplete,
    onAborted,
    onRunContextCreated,
    onCommandNotFound,
  } = params;

  // 在注入歷史記錄前先展開 Command，確保歷史與送給 Claude 的訊息一致
  let resolvedMessage: string | ContentBlock[] = message;

  const podResult = podStore.getByIdGlobal(podId);
  if (podResult) {
    const expandResult = await tryExpandCommandMessage(
      podResult.pod,
      message,
      "launchMultiInstanceRun",
    );
    if (!expandResult.ok) {
      if (onCommandNotFound) {
        // 提供了 callback 表示呼叫端（例如 chat handler）要攔截此情況並自行結束流程
        // 建立 Run 骨架並注入原始訊息後提早結束，不呼叫 Claude
        const triggerMsg = displayMessage ?? extractDisplayContent(message);
        const rc = await runExecutionService.createRun(
          canvasId,
          podId,
          triggerMsg,
        );
        runExecutionService.startPodInstance(rc, podId);
        await injectRunUserMessage(rc, podId, displayMessage ?? message);
        onRunContextCreated?.(rc);
        onCommandNotFound(expandResult.commandId);
        return rc;
      }
      logger.warn(
        "Run",
        "Check",
        `[launchMultiInstanceRun] Command 不存在（commandId=${expandResult.commandId}, podId=${podId}），以原始訊息繼續執行`,
      );
      // 未提供 callback：繼續以原始訊息執行
    } else {
      resolvedMessage = expandResult.message;
    }
  }

  // triggerMessage 僅用於 Run 標題顯示，固定使用純文字（displayMessage 或從 ContentBlock[] 提取文字）
  const triggerMessage = displayMessage ?? extractDisplayContent(message);
  const runContext = await runExecutionService.createRun(
    canvasId,
    podId,
    triggerMessage,
  );
  runExecutionService.startPodInstance(runContext, podId);
  // 注入歷史記錄使用展開版（或原始版，若 Command 不存在）
  await injectRunUserMessage(
    runContext,
    podId,
    displayMessage ?? resolvedMessage,
  );

  onRunContextCreated?.(runContext);

  const strategy = new RunModeExecutionStrategy(canvasId, runContext);

  await executeStreamingChat(
    {
      canvasId,
      podId,
      message: resolvedMessage,
      abortable,
      strategy,
    },
    {
      onComplete: () => onComplete(runContext),
      onError: (_canvasId, _podId, error) => {
        // 原始 error.message 可能含內部技術細節（SDK 錯誤、API 路徑等），
        // 僅記錄到 server log，不直接送往前端以避免資訊洩漏
        logger.error("Run", "Error", `Pod ${podId} 執行失敗: ${error.message}`);
        runExecutionService.errorPodInstance(runContext, podId, "執行發生錯誤");
      },
      ...(onAborted ? { onAborted } : {}),
    },
  );

  return runContext;
}

export async function injectRunUserMessage(
  runContext: RunContext,
  podId: string,
  content: string | ContentBlock[],
): Promise<void> {
  const displayContent = extractDisplayContent(content);

  // 不呼叫 podStore.setStatus（pod 全域狀態不變）
  await runStore.addRunMessage(runContext.runId, podId, "user", displayContent);

  socketService.emitToCanvas(
    runContext.canvasId,
    WebSocketResponseEvents.RUN_MESSAGE,
    {
      runId: runContext.runId,
      canvasId: runContext.canvasId,
      podId,
      messageId: uuidv4(),
      content: displayContent,
      isPartial: false,
      role: "user",
    },
  );
}
