import type {PersistedSubMessage, PersistedToolUseInfo, PersistedMessage} from '../../types';

export interface SubMessageState {
    subMessages: PersistedSubMessage[];
    currentSubContent: string;
    currentSubToolUse: PersistedToolUseInfo[];
    subMessageCounter: number;
}

export function createSubMessageState(): SubMessageState {
    return {
        subMessages: [],
        currentSubContent: '',
        currentSubToolUse: [],
        subMessageCounter: 0,
    };
}

export function createSubMessageAccumulator(messageId: string, state: SubMessageState): () => void {
    return (): void => {
        if (state.currentSubContent || state.currentSubToolUse.length > 0) {
            state.subMessages.push({
                id: `${messageId}-sub-${state.subMessageCounter++}`,
                content: state.currentSubContent,
                toolUse: state.currentSubToolUse.length > 0 ? [...state.currentSubToolUse] : undefined,
            });
            state.currentSubContent = '';
            state.currentSubToolUse = [];
        }
    };
}

export function processTextEvent(
    content: string,
    accumulatedContent: string,
    state: SubMessageState
): string {
    state.currentSubContent += content;
    return accumulatedContent + content;
}

export function processToolUseEvent(
    toolUseId: string,
    toolName: string,
    input: Record<string, unknown>,
    state: SubMessageState,
    flushFn: () => void
): void {
    // 只有在有已累積的文字內容時才先 flush，避免產生空 content 的 subMessage
    if (state.currentSubContent.trim().length > 0) {
        flushFn();
    }

    state.currentSubToolUse.push({
        toolUseId,
        toolName,
        input,
        status: 'completed',
    });
}

function findToolInSubMessages(subMessages: PersistedSubMessage[], toolUseId: string): PersistedToolUseInfo | undefined {
    for (const sub of subMessages) {
        const tool = sub.toolUse?.find(t => t.toolUseId === toolUseId);
        if (tool) return tool;
    }
    return undefined;
}

export function processToolResultEvent(
    toolUseId: string,
    output: string,
    state: SubMessageState
): void {
    const persistedTool = findToolInSubMessages(state.subMessages, toolUseId);
    if (persistedTool) {
        persistedTool.output = output;
    }

    const currentTool = state.currentSubToolUse.find(t => t.toolUseId === toolUseId);
    if (currentTool) {
        currentTool.output = output;
    }
}

/**
 * 使用 structuredClone 深拷貝 subMessages，因為 enqueueWrite 的 fire-and-forget 設計
 * 導致佇列中的寫入可能在後續 event 到達時才執行，必須保留呼叫當下的狀態快照
 */
export function buildPersistedMessage(
    messageId: string,
    accumulatedContent: string,
    state: SubMessageState
): PersistedMessage {
    const subMessages: PersistedSubMessage[] = structuredClone(state.subMessages);

    if (state.currentSubContent || state.currentSubToolUse.length > 0) {
        subMessages.push({
            id: `${messageId}-sub-${state.subMessageCounter}`,
            content: state.currentSubContent,
            toolUse: state.currentSubToolUse.length > 0
                ? structuredClone(state.currentSubToolUse)
                : undefined,
        });
    }

    return {
        id: messageId,
        role: 'assistant',
        content: accumulatedContent,
        timestamp: new Date().toISOString(),
        ...(subMessages.length > 0 && { subMessages }),
    };
}
