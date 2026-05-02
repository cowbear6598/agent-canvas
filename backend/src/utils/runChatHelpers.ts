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
   * Command 不存在時的處理策略：
   * - "skip"：建立 Run 骨架 + 注入原始訊息後提早結束，不呼叫 Claude（需同時提供 onCommandNotFound callback）
   * - "fallback"：warn + 以原始訊息繼續執行（預設，適用於已在上游完成展開的路徑）
   */
  commandNotFoundBehavior?: "skip" | "fallback";
  /**
   * "skip" 模式下 Command 不存在時觸發，用於向前端推送錯誤提示。
   * commandNotFoundBehavior 為 "fallback" 時忽略此 callback。
   */
  onCommandNotFound?: (commandId: string) => void;
  /**
   * 可選的外部 user message id，用於對齊附件目錄與 DB run message id。
   * 傳入時會作為 injectRunUserMessage 的 id，確保兩者一致。
   */
  userMessageId?: string;
}

/**
 * skip 策略：Command 不存在時，建立 Run 骨架並注入原始訊息後提早結束。
 * 由 caller 透過 onCommandNotFound callback 負責向前端推送錯誤提示，不呼叫 Claude。
 */
async function handleCommandNotFound(params: {
  canvasId: string;
  podId: string;
  message: string | ContentBlock[];
  displayMessage?: string;
  onRunContextCreated?: (runContext: RunContext) => void;
  onCommandNotFound?: (commandId: string) => void;
  commandId: string;
}): Promise<RunContext> {
  const {
    canvasId,
    podId,
    message,
    displayMessage,
    onRunContextCreated,
    onCommandNotFound,
    commandId,
  } = params;
  const triggerMsg = displayMessage ?? extractDisplayContent(message);
  const rc = await runExecutionService.createRun(canvasId, podId, triggerMsg);
  const sourceInstance = runStore.getPodInstance(rc.runId, podId);
  if (sourceInstance?.status === "error" || sourceInstance?.status === "skipped") {
    onRunContextCreated?.(rc);
    return rc;
  }
  runExecutionService.startPodInstance(rc, podId);
  await injectRunUserMessage(rc, podId, displayMessage ?? message);
  onRunContextCreated?.(rc);
  onCommandNotFound?.(commandId);
  return rc;
}

/**
 * fallback 策略：Command 不存在時，僅記錄 warn 並以原始訊息繼續執行。
 * 適用於上游（如 scheduleService）已完成展開的路徑。
 */
function handleCommandFallback(commandId: string, podId: string): void {
  logger.warn(
    "Run",
    "Check",
    `[launchMultiInstanceRun] Command 不存在（commandId=${commandId}, podId=${podId}），以原始訊息繼續執行`,
  );
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
    commandNotFoundBehavior = "fallback",
    onCommandNotFound,
    userMessageId,
  } = params;

  let resolvedMessage: string | ContentBlock[] = message;

  const podResult = podStore.getByIdGlobal(podId);
  if (podResult) {
    const expandResult = await tryExpandCommandMessage(
      podResult.pod,
      message,
      "launchMultiInstanceRun",
    );
    if (!expandResult.ok) {
      if (commandNotFoundBehavior === "skip") {
        return await handleCommandNotFound({
          canvasId,
          podId,
          message,
          displayMessage,
          onRunContextCreated,
          onCommandNotFound,
          commandId: expandResult.commandId,
        });
      }
      handleCommandFallback(expandResult.commandId, podId);
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
  const sourceInstance = runStore.getPodInstance(runContext.runId, podId);
  if (sourceInstance?.status === "error" || sourceInstance?.status === "skipped") {
    onRunContextCreated?.(runContext);
    return runContext;
  }
  runExecutionService.startPodInstance(runContext, podId);
  await injectRunUserMessage(
    runContext,
    podId,
    displayMessage ?? resolvedMessage,
    userMessageId,
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
  /** 可選的外部 id，用於對齊附件目錄與 DB run message id */
  id?: string,
): Promise<void> {
  const displayContent = extractDisplayContent(content);

  // 不呼叫 podStore.setStatus（pod 全域狀態不變）
  if (id) {
    // 帶入外部 id，確保附件目錄與 DB run message id 一致
    await runStore.addRunMessage(
      runContext.runId,
      podId,
      "user",
      displayContent,
      undefined,
      id,
    );
  } else {
    await runStore.addRunMessage(
      runContext.runId,
      podId,
      "user",
      displayContent,
    );
  }

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
