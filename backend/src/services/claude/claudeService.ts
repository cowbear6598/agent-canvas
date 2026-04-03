import path from "path";
import { v4 as uuidv4 } from "uuid";
import {
  type Options,
  type Query,
  type SdkPluginConfig,
  query,
  tool,
  createSdkMcpServer,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  SDKMessage,
  SDKSystemMessage,
  SDKAssistantMessage,
  SDKResultMessage,
  SDKUserMessage as SDKUserMessageType,
  SDKToolProgressMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { podStore } from "../podStore.js";
import { mcpServerStore } from "../mcpServerStore.js";
import {
  isAbortError,
  getErrorMessage,
  isProgrammingError,
} from "../../utils/errorHelpers.js";
import { outputStyleService } from "../outputStyleService.js";
import { Message, ToolUseInfo, ContentBlock, Pod } from "../../types";
import { getResultErrorString } from "../../types/result.js";
import { config } from "../../config";
import { logger } from "../../utils/logger.js";
import { getClaudeCodePath } from "./claudePathResolver.js";
import { isPathWithinDirectory } from "../../utils/pathValidator.js";
import {
  buildClaudeContentBlocks,
  createUserMessageStream,
  type SDKUserMessage,
} from "./messageBuilder.js";
import type { StreamCallback } from "./types.js";
import { z } from "zod";
import { integrationRegistry } from "../integration/index.js";
import {
  replyContextStore,
  buildReplyContextKey,
} from "../integration/replyContextStore.js";
import type { RunContext } from "../../types/run.js";
import { runStore } from "../runStore.js";
import { scanInstalledPlugins } from "../pluginScanner.js";

export type { StreamEvent, StreamCallback } from "./types.js";

// SDK 的 SDKToolProgressMessage 不含 output/result 欄位，此為實際接收到的訊息結構（runtime 額外夾帶）
type SDKToolProgressWithOutput = SDKToolProgressMessage & {
  output?: string;
  result?: string;
};

type AssistantTextBlock = { type: "text"; text: string };
type AssistantToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
type AssistantContentBlock = AssistantTextBlock | AssistantToolUseBlock;

interface ActiveToolEntry {
  toolName: string;
  input: Record<string, unknown>;
}

interface QueryState {
  sessionId: string | null;
  fullContent: string;
  toolUseInfo: ToolUseInfo | null;
  activeTools: Map<string, ActiveToolEntry>;
}

type UserToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content?: string;
};

interface RunQueryOptions {
  /** 覆蓋 pod 全域的 claudeSessionId（來自 run_pod_instances） */
  sessionId?: string;
  /** activeQueries 的 key，預設為 podId。Run 模式使用 `${runId}:${podId}` */
  queryKey?: string;
  /** Run 模式的執行上下文，用於 integration tool 查詢 replyContextStore */
  runContext?: RunContext;
}

interface ExecutionContext {
  canvasId: string;
  pod: Pod;
  queryOptions: Options & { abortController: AbortController };
  queryKey: string;
  runOptions?: RunQueryOptions;
}

export interface DisposableChatOptions {
  systemPrompt: string;
  userMessage: string;
  workspacePath: string;
  model?: string;
}

export interface DisposableChatResult {
  content: string;
  success: boolean;
  error?: string;
}

export interface McpChatOptions {
  prompt: string;
  systemPrompt?: string;
  mcpServers?: Options["mcpServers"];
  allowedTools?: string[];
  model?: string;
  cwd: string;
}

const SESSION_RESUME_ERROR_KEYWORDS = ["session", "resume"] as const;

function isSessionResumeError(errorMessage: string): boolean {
  return SESSION_RESUME_ERROR_KEYWORDS.some((keyword) =>
    errorMessage.includes(keyword),
  );
}

export class ClaudeService {
  private activeQueries = new Map<
    string,
    {
      queryStream: Query;
      abortController: AbortController;
    }
  >();

  private readonly sdkMessageHandlers: Record<
    string,
    (
      sdkMessage: SDKMessage,
      state: QueryState,
      onStream: StreamCallback,
    ) => void
  > = {
    assistant: (sdkMessage, state, onStream) =>
      this.handleAssistantMessage(
        sdkMessage as SDKAssistantMessage,
        state,
        onStream,
      ),
    user: (sdkMessage, state, onStream) =>
      this.handleUserMessage(sdkMessage as SDKUserMessageType, state, onStream),
    tool_progress: (sdkMessage, state, onStream) =>
      this.handleToolProgressMessage(
        sdkMessage as SDKToolProgressWithOutput,
        state,
        onStream,
      ),
    result: (sdkMessage, state, onStream) =>
      this.handleResultMessage(sdkMessage as SDKResultMessage, state, onStream),
  };

  private buildBaseOptions(cwd: string): Partial<Options> {
    return {
      cwd,
      settingSources: ["project"],
      permissionMode: "bypassPermissions",
      includePartialMessages: true,
      pathToClaudeCodeExecutable: getClaudeCodePath(),
    };
  }

  private createQueryState(): QueryState {
    return {
      sessionId: null,
      fullContent: "",
      toolUseInfo: null,
      activeTools: new Map(),
    };
  }

  private handleSystemInitMessage(
    sdkMessage: SDKSystemMessage,
    state: QueryState,
  ): void {
    state.sessionId = sdkMessage.session_id;
  }

  private processTextBlock(
    contentBlock: AssistantTextBlock,
    state: QueryState,
    onStream: StreamCallback,
  ): void {
    state.fullContent += contentBlock.text;
    onStream({ type: "text", content: contentBlock.text });
  }

  private processToolUseBlock(
    contentBlock: AssistantToolUseBlock,
    state: QueryState,
    onStream: StreamCallback,
  ): void {
    state.activeTools.set(contentBlock.id, {
      toolName: contentBlock.name,
      input: contentBlock.input,
    });

    state.toolUseInfo = {
      toolUseId: contentBlock.id,
      toolName: contentBlock.name,
      input: contentBlock.input,
      output: null,
    };

    onStream({
      type: "tool_use",
      toolUseId: contentBlock.id,
      toolName: contentBlock.name,
      input: contentBlock.input,
    });
  }

  private processContentBlock(
    block: AssistantContentBlock,
    state: QueryState,
    onStream: StreamCallback,
  ): void {
    if (block.type === "text" && block.text) {
      this.processTextBlock(block, state, onStream);
      return;
    }

    if (block.type === "tool_use") {
      this.processToolUseBlock(block, state, onStream);
    }
  }

  private handleAssistantMessage(
    sdkMessage: SDKAssistantMessage,
    state: QueryState,
    onStream: StreamCallback,
  ): void {
    const assistantMessage = sdkMessage.message;
    if (!assistantMessage.content) return;

    for (const block of assistantMessage.content as AssistantContentBlock[]) {
      this.processContentBlock(block, state, onStream);
    }
  }

  private isToolResultBlock(block: unknown): block is UserToolResultBlock {
    if (typeof block !== "object" || block === null) return false;
    const record = block as Record<string, unknown>;
    return record.type === "tool_result" && "tool_use_id" in record;
  }

  private handleToolResultBlock(
    block: unknown,
    state: QueryState,
    onStream: StreamCallback,
  ): void {
    if (!this.isToolResultBlock(block)) return;

    const toolUseId = block.tool_use_id;
    const content = block.content ?? "";
    const toolInfo = state.activeTools.get(toolUseId);

    if (!toolInfo) return;

    if (state.toolUseInfo?.toolUseId === toolUseId) {
      state.toolUseInfo.output = content;
    }

    onStream({
      type: "tool_result",
      toolUseId,
      toolName: toolInfo.toolName,
      output: content,
    });
  }

  private handleUserMessage(
    sdkMessage: SDKUserMessageType,
    state: QueryState,
    onStream: StreamCallback,
  ): void {
    const userMessage = sdkMessage.message;
    if (!userMessage.content || !Array.isArray(userMessage.content)) return;

    for (const block of userMessage.content) {
      this.handleToolResultBlock(block, state, onStream);
    }
  }

  private processToolProgress(
    toolUseId: string,
    toolName: string,
    outputText: string,
    state: QueryState,
    onStream: StreamCallback,
  ): void {
    if (state.toolUseInfo?.toolUseId === toolUseId) {
      state.toolUseInfo.output = outputText;
    }

    onStream({
      type: "tool_result",
      toolUseId,
      toolName,
      output: outputText,
    });
  }

  private handleToolProgressMessage(
    sdkMessage: SDKToolProgressWithOutput,
    state: QueryState,
    onStream: StreamCallback,
  ): void {
    const outputText = sdkMessage.output ?? sdkMessage.result;
    if (!outputText) return;

    const toolUseId = sdkMessage.tool_use_id;

    if (toolUseId && state.activeTools.has(toolUseId)) {
      const toolInfo = state.activeTools.get(toolUseId)!;
      this.processToolProgress(
        toolUseId,
        toolInfo.toolName,
        outputText,
        state,
        onStream,
      );
      return;
    }

    if (!state.toolUseInfo) return;
    this.processToolProgress(
      state.toolUseInfo.toolUseId,
      state.toolUseInfo.toolName,
      outputText,
      state,
      onStream,
    );
  }

  private handleResultMessage(
    sdkMessage: SDKResultMessage,
    state: QueryState,
    onStream: StreamCallback,
  ): void {
    if (sdkMessage.subtype === "success") {
      if (!state.fullContent && sdkMessage.result) {
        state.fullContent = sdkMessage.result;
      }

      onStream({ type: "complete" });
      return;
    }

    const errorMessage =
      sdkMessage.errors.length > 0
        ? sdkMessage.errors.join(", ")
        : "Unknown error";

    onStream({ type: "error", error: "與 Claude 通訊時發生錯誤，請稍後再試" });
    throw new Error(errorMessage);
  }

  private processSDKMessage(
    sdkMessage: SDKMessage,
    state: QueryState,
    onStream: StreamCallback,
  ): void {
    if (sdkMessage.type === "system" && sdkMessage.subtype === "init") {
      this.handleSystemInitMessage(sdkMessage, state);
      return;
    }

    this.sdkMessageHandlers[sdkMessage.type]?.(sdkMessage, state, onStream);
  }

  private shouldRetrySession(
    error: unknown,
    pod: Pod,
    isRetry: boolean,
  ): boolean {
    if (isRetry) return false;
    if (!pod.claudeSessionId) return false;
    const errorMessage = getErrorMessage(error);
    return isSessionResumeError(errorMessage);
  }

  private async handleSendMessageError(
    context: ExecutionContext,
    error: unknown,
    onStream: StreamCallback,
    isRetry: boolean,
    retryFn: () => Promise<Message>,
  ): Promise<Message> {
    const { pod, canvasId, runOptions } = context;

    if (isAbortError(error)) {
      throw error;
    }

    if (this.shouldRetrySession(error, pod, isRetry)) {
      logger.log(
        "Chat",
        "Update",
        `[ClaudeService] Pod ${pod.name} Session 恢復失敗，清除 Session ID 並重試`,
      );
      // Run 模式不 reset pod 全域 session
      if (!runOptions?.queryKey) {
        podStore.resetClaudeSession(canvasId, pod.id);
      }
      return retryFn();
    }

    const errorMessage = getErrorMessage(error);
    const prefix = isRetry ? "重試查詢仍然" : "查詢";
    logger.error(
      "Chat",
      "Error",
      `Pod ${pod.name} ${prefix}失敗: ${errorMessage}`,
    );

    onStream({ type: "error", error: "與 Claude 通訊時發生錯誤，請稍後再試" });
    throw error;
  }

  private buildPrompt(
    message: string | ContentBlock[],
    commandId: string | null,
    resumeSessionId: string | null,
  ): string | AsyncIterable<SDKUserMessage> {
    if (typeof message === "string") {
      let prompt = commandId ? `/${commandId} ${message}` : message;
      if (prompt.trim().length === 0) {
        prompt = "請開始執行";
      }
      return prompt;
    }

    const contentArray = buildClaudeContentBlocks(message, commandId);
    const sessionId = resumeSessionId ?? "";
    return createUserMessageStream(contentArray, sessionId);
  }

  private buildIntegrationTool(
    binding: NonNullable<Pod["integrationBindings"]>[number],
    provider: NonNullable<ReturnType<typeof integrationRegistry.get>>,
    podId: string,
    runContext?: RunContext,
  ): {
    mcpServer: ReturnType<typeof createSdkMcpServer>;
    serverName: string;
    toolName: string;
  } {
    const serverName = `${binding.provider}-reply`;
    const toolName = `${binding.provider}_reply`;

    const replyTool = tool(
      toolName,
      `回覆 ${provider.displayName} 訊息。當需要在 ${provider.displayName} 中回覆用戶時使用此工具。`,
      {
        text: z.string().min(1).describe("要發送的訊息內容"),
      },
      async (params: { text: string }) => {
        const replyContext = replyContextStore.get(
          buildReplyContextKey(runContext, podId),
        );
        const mergedExtra = { ...binding.extra, ...replyContext };
        const result = await provider.sendMessage!(
          binding.appId,
          binding.resourceId,
          params.text,
          mergedExtra,
        );
        if (!result.success) {
          return {
            content: [
              {
                type: "text" as const,
                text: `錯誤: ${getResultErrorString(result.error)}`,
              },
            ],
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text: "success" }] };
      },
    );

    const mcpServer = createSdkMcpServer({
      name: serverName,
      tools: [replyTool],
    });

    return { mcpServer, serverName, toolName };
  }

  /**
   * 套用 Integration Tool 設定，回傳包含 mcpServers 與 allowedTools 的 partial options
   */
  private applyIntegrationToolOptions(
    pod: Pod,
    base: Pick<Options, "mcpServers" | "allowedTools">,
    runContext?: RunContext,
  ): Pick<Options, "mcpServers" | "allowedTools"> {
    if (!pod.integrationBindings?.length) return base;

    const builtTools = pod.integrationBindings
      .map((binding) => {
        const provider = integrationRegistry.get(binding.provider);
        if (!provider?.sendMessage) return null;
        return this.buildIntegrationTool(binding, provider, pod.id, runContext);
      })
      .filter((t) => t !== null);

    const mcpServers: NonNullable<Options["mcpServers"]> = {
      ...base.mcpServers,
    };
    const allowedTools: string[] = [...(base.allowedTools ?? [])];

    for (const { mcpServer, serverName, toolName } of builtTools) {
      mcpServers[serverName] = mcpServer;
      allowedTools.push(`mcp__${serverName}__${toolName}`);
    }

    return {
      mcpServers: mcpServers as Options["mcpServers"],
      allowedTools,
    };
  }

  /**
   * 套用輸出風格設定，回傳包含 systemPrompt 的 partial options（若無設定則回傳空物件）
   */
  private async applyOutputStyle(
    pod: Pod,
  ): Promise<Pick<Options, "systemPrompt">> {
    if (!pod.outputStyleId) return {};

    const styleContent = await outputStyleService.getContent(pod.outputStyleId);
    if (styleContent) {
      return { systemPrompt: styleContent };
    }
    return {};
  }

  /**
   * 套用 MCP Server 設定，回傳包含 mcpServers 的 partial options（若無設定則回傳空物件）
   */
  private applyMcpServers(pod: Pod): Pick<Options, "mcpServers"> {
    if (!pod.mcpServerIds?.length) return {};

    const servers = mcpServerStore.getByIds(pod.mcpServerIds);
    const mcpServers: NonNullable<Options["mcpServers"]> = {};
    for (const server of servers) {
      mcpServers[server.name] = server.config;
    }
    return { mcpServers };
  }

  /**
   * 套用 Plugin 設定，回傳包含 plugins 的 partial options（若無設定則回傳空物件）
   */
  private applyPlugins(pod: Pod): Pick<Options, "plugins"> {
    if (!pod.pluginIds?.length) return {};

    const enabledSet = new Set(pod.pluginIds);
    const plugins = scanInstalledPlugins()
      .filter((plugin) => enabledSet.has(plugin.id))
      .map(
        (plugin): SdkPluginConfig => ({
          type: "local",
          path: plugin.installPath,
        }),
      );

    if (plugins.length > 0) {
      return { plugins };
    }
    return {};
  }

  /**
   * 建構 Claude 查詢所需的完整 Options，以不可變（immutable）方式合併各項設定
   */
  private async buildQueryOptions(
    pod: Pod,
    cwd: string,
    runOptions?: RunQueryOptions,
  ): Promise<Options & { abortController: AbortController }> {
    const abortController = new AbortController();

    const baseAllowedTools: string[] = [
      "Read",
      "Write",
      "Edit",
      "Bash",
      "Glob",
      "Grep",
      "Skill",
      "WebSearch",
    ];

    const outputStyleOptions = await this.applyOutputStyle(pod);
    const mcpServerOptions = this.applyMcpServers(pod);
    const integrationOptions = this.applyIntegrationToolOptions(
      pod,
      {
        mcpServers: mcpServerOptions.mcpServers,
        allowedTools: baseAllowedTools,
      },
      runOptions?.runContext,
    );
    const pluginOptions = this.applyPlugins(pod);

    const resumeSessionId = runOptions?.sessionId ?? pod.claudeSessionId;

    return {
      ...this.buildBaseOptions(cwd),
      ...outputStyleOptions,
      ...mcpServerOptions,
      ...integrationOptions,
      ...pluginOptions,
      ...(resumeSessionId ? { resume: resumeSessionId } : {}),
      model: pod.model,
      abortController,
    };
  }

  public abortQuery(key: string): boolean {
    const entry = this.activeQueries.get(key);
    if (!entry) {
      return false;
    }

    // close() 會直接殺掉底層 CLI 進程，導致 for await 靜默結束而非拋出 AbortError
    // 這會使 catch 區塊無法被觸發，前端收不到 POD_CHAT_ABORTED 事件
    entry.abortController.abort();
    this.activeQueries.delete(key);

    return true;
  }

  public abortAllQueries(): number {
    const count = this.activeQueries.size;
    for (const entry of this.activeQueries.values()) {
      entry.abortController.abort();
    }
    this.activeQueries.clear();
    return count;
  }

  public async sendMessage(
    podId: string,
    message: string | ContentBlock[],
    onStream: StreamCallback,
    runOptions?: RunQueryOptions,
  ): Promise<Message> {
    return this.sendMessageInternal(
      podId,
      message,
      onStream,
      false,
      runOptions,
    );
  }

  private async runQueryStream(
    queryStream: Query,
    abortController: AbortController,
    state: QueryState,
    onStream: StreamCallback,
  ): Promise<void> {
    for await (const sdkMessage of queryStream) {
      this.processSDKMessage(sdkMessage, state, onStream);
    }

    // 防禦性檢查：若 abort signal 已觸發但未拋出 AbortError，手動拋出
    // 這是為了處理 for await 迴圈靜默結束的邊緣情況
    if (abortController.signal.aborted) {
      const abortError = new Error("查詢已被中斷");
      abortError.name = "AbortError";
      throw abortError;
    }
  }

  private finalizeSession(context: ExecutionContext, state: QueryState): void {
    const { canvasId, pod, runOptions } = context;

    if (!state.sessionId) return;
    if (state.sessionId === pod.claudeSessionId) return;

    // Run 模式：不寫入 pod 全域 session（由呼叫方從回傳值自行處理）
    if (runOptions?.queryKey) return;

    podStore.setClaudeSessionId(canvasId, pod.id, state.sessionId);
  }

  private async executeWithSessionRetry(
    context: ExecutionContext,
    prompt: string | AsyncIterable<SDKUserMessage>,
    state: QueryState,
    onStream: StreamCallback,
    isRetry: boolean,
    retryFn: () => Promise<Message>,
  ): Promise<Message | null> {
    const { queryKey, queryOptions } = context;
    const { abortController } = queryOptions;
    const queryStream = query({ prompt, options: queryOptions });
    this.activeQueries.set(queryKey, { queryStream, abortController });

    try {
      await this.runQueryStream(queryStream, abortController, state, onStream);
      this.finalizeSession(context, state);
      return null;
    } catch (error) {
      return this.handleSendMessageError(
        context,
        error,
        onStream,
        isRetry,
        retryFn,
      );
    } finally {
      // 確保所有情況都清理 activeQueries entry，防止 Memory Leak
      this.activeQueries.delete(queryKey);
    }
  }

  /**
   * 解析最終的 cwd 路徑：Run 模式下若 Instance 有 worktreePath 則優先使用，
   * 否則 fallback 到 Pod 原始路徑（由 resolveCwd 負責）
   */
  private resolveCwdWithRunContext(
    pod: Pod,
    runOptions?: RunQueryOptions,
  ): string {
    const baseCwd = this.resolveCwd(pod);

    if (!runOptions?.runContext) return baseCwd;

    const instance = runStore.getPodInstance(
      runOptions.runContext.runId,
      pod.id,
    );
    if (!instance?.worktreePath) return baseCwd;

    if (
      !isPathWithinDirectory(instance.worktreePath, config.repositoriesRoot)
    ) {
      logger.error(
        "Chat",
        "Check",
        `worktreePath 不在合法範圍內：${instance.worktreePath}`,
      );
      throw new Error("Run Instance 的工作目錄路徑不合法");
    }

    return instance.worktreePath;
  }

  private async sendMessageInternal(
    podId: string,
    message: string | ContentBlock[],
    onStream: StreamCallback,
    isRetry: boolean,
    runOptions?: RunQueryOptions,
  ): Promise<Message> {
    const result = podStore.getByIdGlobal(podId);
    if (!result) {
      throw new Error(`找不到 Pod ${podId}`);
    }

    const { canvasId, pod } = result;
    const messageId = uuidv4();
    const state = this.createQueryState();
    const resolvedKey = runOptions?.queryKey ?? podId;

    const cwd = this.resolveCwdWithRunContext(pod, runOptions);
    const queryOptions = await this.buildQueryOptions(pod, cwd, runOptions);
    const resumeSessionId = runOptions?.sessionId ?? pod.claudeSessionId;
    const prompt = this.buildPrompt(message, pod.commandId, resumeSessionId);

    const context: ExecutionContext = {
      canvasId,
      pod,
      queryOptions,
      queryKey: resolvedKey,
      runOptions,
    };

    const retryResult = await this.executeWithSessionRetry(
      context,
      prompt,
      state,
      onStream,
      isRetry,
      () =>
        this.sendMessageInternal(podId, message, onStream, true, runOptions),
    );

    if (retryResult !== null) {
      return retryResult;
    }

    return {
      id: messageId,
      podId,
      role: "assistant",
      content: state.fullContent,
      toolUse: state.toolUseInfo,
      createdAt: new Date(),
      sessionId: state.sessionId ?? undefined,
    };
  }

  private extractTextFromAssistantMessage(
    sdkMessage: SDKAssistantMessage,
  ): string {
    if (!sdkMessage.message) return "";
    return (sdkMessage.message.content as AssistantContentBlock[])
      .filter(
        (block): block is AssistantTextBlock =>
          block.type === "text" && Boolean(block.text),
      )
      .map((block) => block.text)
      .join("");
  }

  private processResultMessage(sdkMessage: SDKResultMessage): {
    success: boolean;
    content: string;
    error?: string;
  } {
    if (sdkMessage.subtype === "success") {
      return { success: true, content: sdkMessage.result ?? "" };
    }
    const errorMsg =
      "errors" in sdkMessage && sdkMessage.errors
        ? sdkMessage.errors.join(", ")
        : "未知錯誤";
    return { success: false, content: "", error: errorMsg };
  }

  private processCollectStreamMessage(
    sdkMessage: SDKMessage,
    fullContent: string,
  ):
    | { done: false; content: string }
    | {
        done: true;
        result: { success: boolean; content: string; error?: string };
      } {
    if (sdkMessage.type === "assistant") {
      return {
        done: false,
        content:
          fullContent +
          this.extractTextFromAssistantMessage(
            sdkMessage as SDKAssistantMessage,
          ),
      };
    }
    if (sdkMessage.type !== "result") {
      return { done: false, content: fullContent };
    }
    const result = this.processResultMessage(sdkMessage as SDKResultMessage);
    if (!result.success) {
      return { done: true, result };
    }
    return {
      done: true,
      result: { success: true, content: result.content || fullContent },
    };
  }

  private async collectTextFromStream(
    stream: Query,
  ): Promise<{ success: boolean; content: string; error?: string }> {
    let fullContent = "";
    for await (const sdkMessage of stream) {
      const outcome = this.processCollectStreamMessage(sdkMessage, fullContent);
      if (outcome.done) {
        return outcome.result;
      }
      fullContent = outcome.content;
    }
    return { success: true, content: fullContent };
  }

  private resolveCwd(pod: Pod): string {
    if (pod.repositoryId) {
      const resolvedCwd = path.resolve(
        path.join(config.repositoriesRoot, pod.repositoryId),
      );
      if (
        !isPathWithinDirectory(
          resolvedCwd,
          path.resolve(config.repositoriesRoot),
        )
      ) {
        throw new Error(`非法的工作目錄路徑：${pod.repositoryId}`);
      }
      return resolvedCwd;
    }

    const resolvedCwd = path.resolve(pod.workspacePath);
    if (!isPathWithinDirectory(resolvedCwd, path.resolve(config.canvasRoot))) {
      throw new Error(`非法的工作目錄路徑：${pod.workspacePath}`);
    }
    return resolvedCwd;
  }

  public async executeDisposableChat(
    options: DisposableChatOptions,
  ): Promise<DisposableChatResult> {
    const { systemPrompt, userMessage, workspacePath, model } = options;

    try {
      const queryOptions: Options = {
        ...this.buildBaseOptions(workspacePath),
        allowedTools: [],
        systemPrompt,
      };

      if (model) {
        queryOptions.model = model;
      }

      const queryStream = query({
        prompt: userMessage,
        options: queryOptions,
      });

      const result = await this.collectTextFromStream(queryStream);
      return result.success
        ? { content: result.content, success: true }
        : { content: "", success: false, error: result.error ?? "" };
    } catch (error) {
      // 程式 bug（TypeError、ReferenceError 等）應向上拋出，讓開發者能發現問題
      // 只捕捉 Claude SDK 的外部錯誤（網路錯誤、API 錯誤、AbortError 等）
      if (isProgrammingError(error)) {
        throw error;
      }

      const errorMessage = getErrorMessage(error);
      logger.error(
        "Chat",
        "Error",
        `[ClaudeService] executeDisposableChat 失敗`,
        error,
      );

      return {
        content: "",
        success: false,
        error: errorMessage,
      };
    }
  }

  public executeMcpChat(options: McpChatOptions): Query {
    const baseOptions = this.buildBaseOptions(options.cwd);
    return query({
      prompt: options.prompt,
      options: {
        ...baseOptions,
        systemPrompt: options.systemPrompt,
        mcpServers: options.mcpServers,
        allowedTools: options.allowedTools,
        model: options.model,
      },
    });
  }
}

export const claudeService = new ClaudeService();
