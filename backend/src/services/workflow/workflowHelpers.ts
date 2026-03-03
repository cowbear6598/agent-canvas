import type {Pod, Command, Connection} from '../../types/index.js';

const WORKFLOW_SOURCE_HEADING = '## Source:';
const WORKFLOW_SECTION_SEPARATOR = '---';
import type {WorkflowQueuedPayload} from '../../types/responses/workflow.js';
import {connectionStore} from '../connectionStore.js';
import {workflowEventEmitter} from './workflowEventEmitter.js';
import {logger} from '../../utils/logger.js';
import type {CompletionContext, QueuedContext} from './types.js';

export function getMultiInputGroupConnections(
    canvasId: string,
    targetPodId: string
): Connection[] {
    const allIncomingConnections = connectionStore.findByTargetPodId(canvasId, targetPodId);
    return allIncomingConnections.filter(conn =>
        conn.triggerMode === 'auto' || conn.triggerMode === 'ai-decide'
    );
}

export function forEachMultiInputGroupConnection(
    canvasId: string,
    targetPodId: string,
    callback: (conn: Connection) => void
): void {
    const connections = getMultiInputGroupConnections(canvasId, targetPodId);
    if (connections.length === 0) {
        logger.warn('Workflow', 'Warn', `[forEachMultiInputGroupConnection] 未找到 targetPod ${targetPodId} 的 auto/ai-decide 連線`);
        return;
    }
    for (const conn of connections) {
        callback(conn);
    }
}

export function formatMergedSummaries(
    summaries: Map<string, string>,
    podLookup: (podId: string) => Pod | undefined
): string {
    const formatted: string[] = [];

    for (const [sourcePodId, content] of summaries.entries()) {
        const sourcePod = podLookup(sourcePodId);
        const podName = sourcePod?.name || sourcePodId;

        formatted.push(`${WORKFLOW_SOURCE_HEADING} ${podName}\n${content}\n\n${WORKFLOW_SECTION_SEPARATOR}`);
    }

    let result = formatted.join('\n\n');
    result = result.replace(/\n\n---$/, '');

    return result;
}

function escapeXmlTags(content: string): string {
    return content.replace(/<\/?source-summary>/gi, '&lt;source-summary&gt;');
}

export function buildTransferMessage(content: string): string {
    const isolatedContent = `<source-summary>\n${escapeXmlTags(content)}\n</source-summary>`;
    return `以下是從另一個 POD 傳遞過來的內容,請根據這些資訊繼續處理:

${isolatedContent}`;
}

export interface ConnectionLogInfo {
    connId: string;
    sourceName: string | undefined;
    sourcePodId: string;
    targetName: string | undefined;
    targetPodId: string;
}

export function formatConnLog(info: ConnectionLogInfo): string {
    const {connId, sourceName, sourcePodId, targetName, targetPodId} = info;
    return `連線 ${connId}（「${sourceName ?? sourcePodId}」→「${targetName ?? targetPodId}」）`;
}

export function completeMultiInputConnections(
    context: CompletionContext,
    success: boolean,
    error?: string
): void {
    forEachMultiInputGroupConnection(context.canvasId, context.targetPodId, (conn) => {
        workflowEventEmitter.emitWorkflowComplete({
            canvasId: context.canvasId,
            connectionId: conn.id,
            sourcePodId: conn.sourcePodId,
            targetPodId: context.targetPodId,
            success,
            error,
            triggerMode: context.triggerMode,
        });
        connectionStore.updateConnectionStatus(context.canvasId, conn.id, 'idle');
    });
}

export function buildQueuedPayload(
    context: QueuedContext,
    connectionId: string,
    sourcePodId: string
): WorkflowQueuedPayload {
    return {
        canvasId: context.canvasId,
        targetPodId: context.targetPodId,
        connectionId,
        sourcePodId,
        position: context.position,
        queueSize: context.queueSize,
        triggerMode: context.triggerMode,
    };
}

export function buildMessageWithCommand(
    baseMessage: string,
    targetPod: Pod | undefined,
    commands: Command[]
): string {
    if (!targetPod?.commandId) {
        return baseMessage;
    }

    const command = commands.find((cmd) => cmd.id === targetPod.commandId);
    if (!command) {
        return baseMessage;
    }

    return `/${command.name} ${baseMessage}`;
}
