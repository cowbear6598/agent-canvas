import path from 'path';
import {v4 as uuidv4} from 'uuid';
import {type Options, type Query, query, tool, createSdkMcpServer} from '@anthropic-ai/claude-agent-sdk';
import type {SDKMessage, SDKSystemMessage, SDKAssistantMessage, SDKResultMessage, SDKUserMessage as SDKUserMessageType, SDKToolProgressMessage} from '@anthropic-ai/claude-agent-sdk';
import {podStore} from '../podStore.js';
import {mcpServerStore} from '../mcpServerStore.js';
import {isAbortError, getErrorMessage} from '../../utils/errorHelpers.js';
import {outputStyleService} from '../outputStyleService.js';
import {Message, ToolUseInfo, ContentBlock, Pod} from '../../types';
import {config} from '../../config';
import {logger} from '../../utils/logger.js';
import {getClaudeCodePath} from './claudePathResolver.js';
import {isPathWithinDirectory} from '../../utils/pathValidator.js';
import {
    buildClaudeContentBlocks,
    createUserMessageStream,
    type SDKUserMessage,
} from './messageBuilder.js';
import type {StreamCallback} from './types.js';
import {z} from 'zod';
import {integrationRegistry} from '../integration/index.js';

export type {StreamEvent, StreamCallback} from './types.js';

// SDK 的 SDKToolProgressMessage 不含 output/result 欄位，此為實際接收到的訊息結構（runtime 額外夾帶）
type SDKToolProgressWithOutput = SDKToolProgressMessage & {
    output?: string;
    result?: string;
};

type AssistantTextBlock = {type: 'text'; text: string};
type AssistantToolUseBlock = {type: 'tool_use'; id: string; name: string; input: Record<string, unknown>};
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
    type: 'tool_result';
    tool_use_id: string;
    content?: string;
};

interface HandleSendMessageErrorParams {
    error: unknown;
    pod: Pod;
    canvasId: string;
    podId: string;
    onStream: StreamCallback;
    isRetry: boolean;
    retryFn: () => Promise<Message>;
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
    mcpServers?: Options['mcpServers'];
    allowedTools?: string[];
    model?: string;
    cwd: string;
}

export class ClaudeService {
    private activeQueries = new Map<string, {
        queryStream: Query;
        abortController: AbortController;
    }>();

    private readonly sdkMessageHandlers: Record<string, (sdkMessage: SDKMessage, state: QueryState, onStream: StreamCallback) => void> = {
        assistant: (sdkMessage, state, onStream) => this.handleAssistantMessage(sdkMessage as SDKAssistantMessage, state, onStream),
        user: (sdkMessage, state, onStream) => this.handleUserMessage(sdkMessage as SDKUserMessageType, state, onStream),
        tool_progress: (sdkMessage, state, onStream) => this.handleToolProgressMessage(sdkMessage as SDKToolProgressWithOutput, state, onStream),
        result: (sdkMessage, state, onStream) => this.handleResultMessage(sdkMessage as SDKResultMessage, state, onStream),
    };

    private buildBaseOptions(cwd: string): Partial<Options> {
        return {
            cwd,
            settingSources: ['project'],
            permissionMode: 'bypassPermissions',
            includePartialMessages: true,
            pathToClaudeCodeExecutable: getClaudeCodePath(),
        };
    }

    private createQueryState(): QueryState {
        return {
            sessionId: null,
            fullContent: '',
            toolUseInfo: null,
            activeTools: new Map(),
        };
    }

    private handleSystemInitMessage(sdkMessage: SDKSystemMessage, state: QueryState): void {
        state.sessionId = sdkMessage.session_id;
    }

    private processTextBlock(
        contentBlock: AssistantTextBlock,
        state: QueryState,
        onStream: StreamCallback
    ): void {
        state.fullContent += contentBlock.text;
        onStream({type: 'text', content: contentBlock.text});
    }

    private processToolUseBlock(
        contentBlock: AssistantToolUseBlock,
        state: QueryState,
        onStream: StreamCallback
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
            type: 'tool_use',
            toolUseId: contentBlock.id,
            toolName: contentBlock.name,
            input: contentBlock.input,
        });
    }

    private processContentBlock(
        block: AssistantContentBlock,
        state: QueryState,
        onStream: StreamCallback
    ): void {
        if (block.type === 'text' && block.text) {
            this.processTextBlock(block, state, onStream);
            return;
        }

        if (block.type === 'tool_use') {
            this.processToolUseBlock(block, state, onStream);
        }
    }

    private handleAssistantMessage(
        sdkMessage: SDKAssistantMessage,
        state: QueryState,
        onStream: StreamCallback
    ): void {
        const assistantMessage = sdkMessage.message;
        if (!assistantMessage.content) return;

        for (const block of assistantMessage.content as AssistantContentBlock[]) {
            this.processContentBlock(block, state, onStream);
        }
    }

    private isToolResultBlock(block: unknown): block is UserToolResultBlock {
        if (typeof block !== 'object' || block === null) return false;
        const record = block as Record<string, unknown>;
        return record.type === 'tool_result' && 'tool_use_id' in record;
    }

    private handleToolResultBlock(
        block: unknown,
        state: QueryState,
        onStream: StreamCallback
    ): void {
        if (!this.isToolResultBlock(block)) return;

        const toolUseId = block.tool_use_id;
        const content = block.content ?? '';
        const toolInfo = state.activeTools.get(toolUseId);

        if (!toolInfo) return;

        if (state.toolUseInfo?.toolUseId === toolUseId) {
            state.toolUseInfo.output = content;
        }

        onStream({
            type: 'tool_result',
            toolUseId,
            toolName: toolInfo.toolName,
            output: content,
        });
    }

    private handleUserMessage(
        sdkMessage: SDKUserMessageType,
        state: QueryState,
        onStream: StreamCallback
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
        onStream: StreamCallback
    ): void {
        if (state.toolUseInfo?.toolUseId === toolUseId) {
            state.toolUseInfo.output = outputText;
        }

        onStream({
            type: 'tool_result',
            toolUseId,
            toolName,
            output: outputText,
        });
    }

    private handleToolProgressMessage(
        sdkMessage: SDKToolProgressWithOutput,
        state: QueryState,
        onStream: StreamCallback
    ): void {
        const outputText = sdkMessage.output ?? sdkMessage.result;
        if (!outputText) return;

        const toolUseId = sdkMessage.tool_use_id;

        if (toolUseId && state.activeTools.has(toolUseId)) {
            const toolInfo = state.activeTools.get(toolUseId)!;
            this.processToolProgress(toolUseId, toolInfo.toolName, outputText, state, onStream);
            return;
        }

        if (!state.toolUseInfo) return;
        this.processToolProgress(state.toolUseInfo.toolUseId, state.toolUseInfo.toolName, outputText, state, onStream);
    }

    private handleResultMessage(
        sdkMessage: SDKResultMessage,
        state: QueryState,
        onStream: StreamCallback
    ): void {
        if (sdkMessage.subtype === 'success') {
            if (!state.fullContent && sdkMessage.result) {
                state.fullContent = sdkMessage.result;
            }

            onStream({type: 'complete'});
            return;
        }

        const errorMessage = sdkMessage.errors.length > 0 ? sdkMessage.errors.join(', ') : 'Unknown error';

        onStream({type: 'error', error: '與 Claude 通訊時發生錯誤，請稍後再試'});
        throw new Error(errorMessage);
    }

    private processSDKMessage(
        sdkMessage: SDKMessage,
        state: QueryState,
        onStream: StreamCallback
    ): void {
        if (sdkMessage.type === 'system' && sdkMessage.subtype === 'init') {
            this.handleSystemInitMessage(sdkMessage, state);
            return;
        }

        this.sdkMessageHandlers[sdkMessage.type]?.(sdkMessage, state, onStream);
    }

    private shouldRetrySession(error: unknown, pod: Pod, isRetry: boolean): boolean {
        if (isRetry) return false;
        if (!pod.claudeSessionId) return false;
        const errorMessage = getErrorMessage(error);
        return errorMessage.includes('session') || errorMessage.includes('resume');
    }

    private async handleSendMessageError(params: HandleSendMessageErrorParams): Promise<Message> {
        const {error, pod, canvasId, podId, onStream, isRetry, retryFn} = params;

        if (isAbortError(error)) {
            throw error;
        }

        if (this.shouldRetrySession(error, pod, isRetry)) {
            logger.log(
                'Chat',
                'Update',
                `[ClaudeService] Pod ${pod.name} Session 恢復失敗，清除 Session ID 並重試`
            );
            podStore.resetClaudeSession(canvasId, podId);
            return retryFn();
        }

        const errorMessage = getErrorMessage(error);
        const prefix = isRetry ? '重試查詢仍然' : '查詢';
        logger.error('Chat', 'Error', `Pod ${pod.name} ${prefix}失敗: ${errorMessage}`);

        onStream({type: 'error', error: '與 Claude 通訊時發生錯誤，請稍後再試'});
        throw error;
    }

    private buildPrompt(
        message: string | ContentBlock[],
        commandId: string | null,
        resumeSessionId: string | null
    ): string | AsyncIterable<SDKUserMessage> {
        if (typeof message === 'string') {
            let prompt = commandId ? `/${commandId} ${message}` : message;
            if (prompt.trim().length === 0) {
                prompt = '請開始執行';
            }
            return prompt;
        }

        const contentArray = buildClaudeContentBlocks(message, commandId);
        const sessionId = resumeSessionId ?? '';
        return createUserMessageStream(contentArray, sessionId);
    }

    private applyIntegrationToolOptions(pod: Pod, queryOptions: Options): void {
        if (!pod.integrationBindings?.length) return;

        for (const binding of pod.integrationBindings) {
            const provider = integrationRegistry.get(binding.provider);
            if (!provider?.sendMessage) continue;

            const serverName = `${binding.provider}-reply`;
            const toolName = `${binding.provider}_reply`;

            const replyTool = tool(
                toolName,
                `回覆 ${provider.displayName} 訊息。當需要在 ${provider.displayName} 中回覆用戶時使用此工具。`,
                {
                    text: z.string().min(1).describe('要發送的訊息內容'),
                },
                async (params: {text: string}) => {
                    const result = await provider.sendMessage!(binding.appId, binding.resourceId, params.text, binding.extra);
                    if (!result.success) {
                        return {success: false, error: result.error};
                    }
                    return {success: true};
                }
            );

            const mcpServer = createSdkMcpServer({
                name: serverName,
                tools: [replyTool],
            });

            queryOptions.mcpServers = {
                ...queryOptions.mcpServers,
                [serverName]: mcpServer,
            } as Options['mcpServers'];

            queryOptions.allowedTools = [
                ...(queryOptions.allowedTools ?? []),
                `mcp__${serverName}__${toolName}`,
            ];
        }
    }

    private async applyOutputStyle(pod: Pod, queryOptions: Options): Promise<void> {
        if (!pod.outputStyleId) return;

        const styleContent = await outputStyleService.getContent(pod.outputStyleId);
        if (styleContent) {
            queryOptions.systemPrompt = styleContent;
        }
    }

    private applyMcpServers(pod: Pod, queryOptions: Options): void {
        if (!pod.mcpServerIds?.length) return;

        const servers = mcpServerStore.getByIds(pod.mcpServerIds);
        const mcpServers: NonNullable<Options['mcpServers']> = {};
        for (const server of servers) {
            mcpServers[server.name] = server.config;
        }
        queryOptions.mcpServers = mcpServers;
    }

    private async buildQueryOptions(
        pod: Pod,
        cwd: string
    ): Promise<Options & {abortController: AbortController}> {
        const abortController = new AbortController();

        const queryOptions: Options & {abortController: AbortController} = {
            ...this.buildBaseOptions(cwd),
            allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Skill', 'WebSearch'],
            abortController,
        };

        await this.applyOutputStyle(pod, queryOptions);
        this.applyMcpServers(pod, queryOptions);
        this.applyIntegrationToolOptions(pod, queryOptions);

        if (pod.claudeSessionId) {
            queryOptions.resume = pod.claudeSessionId;
        }

        queryOptions.model = pod.model;

        return queryOptions;
    }

    public abortQuery(podId: string): boolean {
        const entry = this.activeQueries.get(podId);
        if (!entry) {
            return false;
        }

        // close() 會直接殺掉底層 CLI 進程，導致 for await 靜默結束而非拋出 AbortError
        // 這會使 catch 區塊無法被觸發，前端收不到 POD_CHAT_ABORTED 事件
        entry.abortController.abort();
        this.activeQueries.delete(podId);

        return true;
    }

    public async sendMessage(
        podId: string,
        message: string | ContentBlock[],
        onStream: StreamCallback
    ): Promise<Message> {
        return this.sendMessageInternal(podId, message, onStream, false);
    }

    private async runQueryStream(
        queryStream: Query,
        abortController: AbortController,
        state: QueryState,
        onStream: StreamCallback
    ): Promise<void> {
        for await (const sdkMessage of queryStream) {
            this.processSDKMessage(sdkMessage, state, onStream);
        }

        // 防禦性檢查：若 abort signal 已觸發但未拋出 AbortError，手動拋出
        // 這是為了處理 for await 迴圈靜默結束的邊緣情況
        if (abortController.signal.aborted) {
            const abortError = new Error('查詢已被中斷');
            abortError.name = 'AbortError';
            throw abortError;
        }
    }

    private finalizeSession(canvasId: string, podId: string, state: QueryState, pod: Pod): void {
        if (state.sessionId && state.sessionId !== pod.claudeSessionId) {
            podStore.setClaudeSessionId(canvasId, podId, state.sessionId);
        }
    }

    private async executeWithSessionRetry(
        podId: string,
        canvasId: string,
        pod: Pod,
        queryOptions: Options & {abortController: AbortController},
        prompt: string | AsyncIterable<SDKUserMessage>,
        state: QueryState,
        onStream: StreamCallback,
        isRetry: boolean,
        retryFn: () => Promise<Message>
    ): Promise<Message | null> {
        const {abortController} = queryOptions;
        const queryStream = query({prompt, options: queryOptions});
        this.activeQueries.set(podId, {queryStream, abortController});

        try {
            await this.runQueryStream(queryStream, abortController, state, onStream);
            this.finalizeSession(canvasId, podId, state, pod);
            return null;
        } catch (error) {
            return this.handleSendMessageError({error, pod, canvasId, podId, onStream, isRetry, retryFn});
        } finally {
            // 確保所有情況都清理 activeQueries entry，防止 Memory Leak
            this.activeQueries.delete(podId);
        }
    }

    private async sendMessageInternal(
        podId: string,
        message: string | ContentBlock[],
        onStream: StreamCallback,
        isRetry: boolean
    ): Promise<Message> {
        const result = podStore.getByIdGlobal(podId);
        if (!result) {
            throw new Error(`找不到 Pod ${podId}`);
        }

        const {canvasId, pod} = result;
        const messageId = uuidv4();
        const state = this.createQueryState();

        const cwd = this.resolveCwd(pod);
        const queryOptions = await this.buildQueryOptions(pod, cwd);
        const prompt = this.buildPrompt(message, pod.commandId, pod.claudeSessionId);

        const retryResult = await this.executeWithSessionRetry(
            podId, canvasId, pod, queryOptions, prompt, state, onStream, isRetry,
            () => this.sendMessageInternal(podId, message, onStream, true)
        );

        if (retryResult !== null) {
            return retryResult;
        }

        return {
            id: messageId,
            podId,
            role: 'assistant',
            content: state.fullContent,
            toolUse: state.toolUseInfo,
            createdAt: new Date(),
        };
    }

    private extractTextFromAssistantMessage(sdkMessage: SDKAssistantMessage): string {
        if (!sdkMessage.message) return '';
        return (sdkMessage.message.content as AssistantContentBlock[])
            .filter((block): block is AssistantTextBlock => block.type === 'text' && Boolean(block.text))
            .map(block => block.text)
            .join('');
    }

    private processResultMessage(sdkMessage: SDKResultMessage): {success: boolean; content: string; error?: string} {
        if (sdkMessage.subtype === 'success') {
            return {success: true, content: sdkMessage.result ?? ''};
        }
        const errorMsg =
            'errors' in sdkMessage && sdkMessage.errors
                ? sdkMessage.errors.join(', ')
                : '未知錯誤';
        return {success: false, content: '', error: errorMsg};
    }

    private processCollectStreamMessage(
        sdkMessage: SDKMessage,
        fullContent: string,
    ): {done: false; content: string} | {done: true; result: {success: boolean; content: string; error?: string}} {
        if (sdkMessage.type === 'assistant') {
            return {done: false, content: fullContent + this.extractTextFromAssistantMessage(sdkMessage as SDKAssistantMessage)};
        }
        if (sdkMessage.type !== 'result') {
            return {done: false, content: fullContent};
        }
        const result = this.processResultMessage(sdkMessage as SDKResultMessage);
        if (!result.success) {
            return {done: true, result};
        }
        return {done: true, result: {success: true, content: result.content || fullContent}};

    }

    private async collectTextFromStream(stream: Query): Promise<{success: boolean; content: string; error?: string}> {
        let fullContent = '';
        for await (const sdkMessage of stream) {
            const outcome = this.processCollectStreamMessage(sdkMessage, fullContent);
            if (outcome.done) {
                return outcome.result;
            }
            fullContent = outcome.content;
        }
        return {success: true, content: fullContent};
    }

    private resolveCwd(pod: Pod): string {
        if (pod.repositoryId) {
            const resolvedCwd = path.resolve(path.join(config.repositoriesRoot, pod.repositoryId));
            if (!isPathWithinDirectory(resolvedCwd, path.resolve(config.repositoriesRoot))) {
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

    public async executeDisposableChat(options: DisposableChatOptions): Promise<DisposableChatResult> {
        const {systemPrompt, userMessage, workspacePath, model} = options;

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
                ? {content: result.content, success: true}
                : {content: '', success: false, error: result.error};
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            logger.error('Chat', 'Error', `[ClaudeService] executeDisposableChat 失敗`, error);

            return {
                content: '',
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
