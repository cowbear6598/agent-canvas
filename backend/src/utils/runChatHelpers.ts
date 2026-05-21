import { v4 as uuidv4 } from "uuid";
import type { RunContext } from "../types/run.js";
import type { ContentBlock } from "../types/index.js";
import { WebSocketResponseEvents } from "../schemas/index.js";
import { runStore } from "../services/runStore.js";
import { runExecutionService } from "../services/workflow/runExecutionService.js";
import { socketService } from "../services/socketService.js";
import { executeStreamingChat } from "../services/claude/streamingChatExecutor.js";
import { ChatExecutionStrategy } from "../services/executionStrategy.js";
import { logger } from "./logger.js";

export function extractDisplayContent(
  message: string | ContentBlock[],
): string {
  if (typeof message === "string") return message;

  return message
    .map((block) => (block.type === "text" ? block.text : "[image]"))
    .join("");
}

export interface LaunchRunParams {
  canvasId: string;
  podId: string;
  message: string | ContentBlock[];
  displayMessage?: string;
  abortable: boolean;
  onComplete: (runContext: RunContext) => void;
  onAborted?: (canvasId: string, podId: string, messageId: string) => void;
  onRunContextCreated?: (runContext: RunContext) => void;
  /**
   * 可選的外部 user message id，用於對齊附件目錄與 DB run message id。
   * 傳入時會作為 injectRunUserMessage 的 id，確保兩者一致。
   */
  userMessageId?: string;
}

export async function launchRun(params: LaunchRunParams): Promise<RunContext> {
  const {
    canvasId,
    podId,
    message,
    displayMessage,
    abortable,
    onComplete,
    onAborted,
    onRunContextCreated,
    userMessageId,
  } = params;

  const resolvedMessage: string | ContentBlock[] = message;

  // triggerMessage 僅用於 Run 標題顯示，固定使用純文字（displayMessage 或從 ContentBlock[] 提取文字）
  const triggerMessage = displayMessage ?? extractDisplayContent(message);
  const runContext = await runExecutionService.createRun(
    canvasId,
    podId,
    triggerMessage,
  );
  const sourceInstance = runStore.getPodInstance(runContext.runId, podId);
  if (
    sourceInstance?.status === "error" ||
    sourceInstance?.status === "skipped"
  ) {
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

  const strategy = new ChatExecutionStrategy(canvasId, runContext);

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
  // deleteRun race guard — see runExecutionService.deleteRun
  const run = runStore.getRun(runContext.runId);
  if (!run || run.status === "cancelled") {
    return;
  }

  const displayContent = extractDisplayContent(content);

  // 不呼叫 podStore.setStatus（pod 全域狀態不變）
  // 帶入外部 id（可選）以確保附件目錄與 DB run message id 一致
  await runStore.addRunMessage(
    runContext.runId,
    podId,
    "user",
    displayContent,
    undefined,
    id ?? undefined,
  );

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
