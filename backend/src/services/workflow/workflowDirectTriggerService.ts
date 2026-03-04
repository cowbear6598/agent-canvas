import type {
    WorkflowDirectWaitingPayload,
    Connection,
} from '../../types/index.js';
import type {
    TriggerStrategy,
    TriggerDecideContext,
    TriggerDecideResult,
    CollectSourcesContext,
    CollectSourcesResult,
    TriggerLifecycleContext,
    CompletionContext,
    QueuedContext,
    QueueProcessedContext,
} from './types.js';
import {podStore} from '../podStore.js';
import {directTriggerStore} from '../directTriggerStore.js';
import {workflowStateService} from './workflowStateService.js';
import {workflowEventEmitter} from './workflowEventEmitter.js';
import {logger} from '../../utils/logger.js';
import {formatMergedSummaries, buildQueuedPayload} from './workflowHelpers.js';
import {connectionStore} from '../connectionStore.js';
import {MERGED_CONTENT_PREVIEW_MAX_LENGTH} from './constants.js';

// 等待 10 秒讓多個 direct 輸入合併為一次觸發，避免重複執行
const MULTI_DIRECT_MERGE_WINDOW_MS = 10000;

class WorkflowDirectTriggerService implements TriggerStrategy {
    readonly mode = 'direct' as const;

    private pendingResolvers: Map<string, (result: CollectSourcesResult) => void> = new Map();

    async decide(context: TriggerDecideContext): Promise<TriggerDecideResult[]> {
        return context.connections.map((connection) => ({
            connectionId: connection.id,
            approved: true,
            reason: null,
            isError: false,
        }));
    }

    async collectSources(context: CollectSourcesContext): Promise<CollectSourcesResult> {
        const {canvasId, sourcePodId, connection, summary} = context;
        const targetPodId = connection.targetPodId;

        const directCount = workflowStateService.getDirectConnectionCount(canvasId, targetPodId);

        if (directCount === 1) {
            return this.handleSingleDirectTrigger(connection.id);
        }

        return this.handleMultiDirectTrigger(canvasId, sourcePodId, targetPodId, connection, summary);
    }

    private handleSingleDirectTrigger(connectionId: string): CollectSourcesResult {
        return {ready: true, participatingConnectionIds: [connectionId]};
    }

    private handleMultiDirectTrigger(
        canvasId: string,
        sourcePodId: string,
        targetPodId: string,
        connection: Connection,
        summary: string
    ): Promise<CollectSourcesResult> {
        if (!directTriggerStore.hasDirectPending(targetPodId)) {
            directTriggerStore.initializeDirectPending(targetPodId);
        }

        directTriggerStore.recordDirectReady(targetPodId, sourcePodId, summary);

        connectionStore.updateConnectionStatus(canvasId, connection.id, 'waiting');

        const directWaitingPayload: WorkflowDirectWaitingPayload = {
            canvasId,
            connectionId: connection.id,
            sourcePodId,
            targetPodId,
        };
        workflowEventEmitter.emitDirectWaiting(canvasId, directWaitingPayload);

        if (this.pendingResolvers.has(targetPodId)) {
            this.startCountdownTimer(canvasId, targetPodId);
            return Promise.resolve({ready: false});
        }

        return new Promise<CollectSourcesResult>((resolve) => {
            this.pendingResolvers.set(targetPodId, resolve);
            this.startCountdownTimer(canvasId, targetPodId);
        });
    }

    private startCountdownTimer(canvasId: string, targetPodId: string): void {
        if (directTriggerStore.hasActiveTimer(targetPodId)) {
            directTriggerStore.clearTimer(targetPodId);
        }

        const timer = setTimeout(() => {
            this.onTimerExpired(canvasId, targetPodId);
        }, MULTI_DIRECT_MERGE_WINDOW_MS);

        directTriggerStore.setTimer(targetPodId, timer);
    }

    cancelPendingResolver(targetPodId: string): void {
        const resolver = this.pendingResolvers.get(targetPodId);
        if (!resolver) {
            return;
        }

        resolver({ready: false});
        this.pendingResolvers.delete(targetPodId);
        logger.log('Workflow', 'Delete', `已取消目標 ${targetPodId} 的 pending resolver - 連線已刪除`);
    }

    private onTimerExpired(canvasId: string, targetPodId: string): void {
        const resolver = this.pendingResolvers.get(targetPodId);
        if (!resolver) {
            return;
        }

        const result = this.processTimerResult(canvasId, targetPodId);
        resolver(result);

        this.pendingResolvers.delete(targetPodId);
        directTriggerStore.clearDirectPending(targetPodId);
    }

    private findConnectionIdsBySourcePodIds(canvasId: string, targetPodId: string, sourcePodIds: string[]): string[] {
        const allConnections = connectionStore.findByTargetPodId(canvasId, targetPodId);
        return allConnections
            .filter(conn => conn.triggerMode === 'direct' && sourcePodIds.includes(conn.sourcePodId))
            .map(conn => conn.id);
    }

    private processTimerResult(canvasId: string, targetPodId: string): CollectSourcesResult {
        const readySummaries = directTriggerStore.getReadySummaries(targetPodId);
        if (!readySummaries || readySummaries.size === 0) {
            return {ready: false};
        }

        const sourcePodIds = Array.from(readySummaries.keys());
        const participatingConnectionIds = this.findConnectionIdsBySourcePodIds(canvasId, targetPodId, sourcePodIds);

        if (sourcePodIds.length === 1) {
            return {ready: true, participatingConnectionIds};
        }

        const mergedContent = formatMergedSummaries(
            readySummaries,
            (podId) => podStore.getById(canvasId, podId)
        );

        const mergedPayload = {
            canvasId,
            targetPodId,
            sourcePodIds,
            mergedContentPreview: mergedContent.substring(0, MERGED_CONTENT_PREVIEW_MAX_LENGTH),
            countdownSeconds: 0,
        };

        workflowEventEmitter.emitDirectMerged(canvasId, mergedPayload);

        return {ready: true, mergedContent, isSummarized: true, participatingConnectionIds};
    }

    private getConnectionsToIterate(canvasId: string, participatingConnectionIds: string[]): Connection[] {
        return participatingConnectionIds
            .map(id => connectionStore.getById(canvasId, id))
            .filter((conn): conn is Connection => conn !== undefined);
    }

    onTrigger(context: TriggerLifecycleContext): void {
        const connections = this.getConnectionsToIterate(
            context.canvasId,
            context.participatingConnectionIds
        );

        for (const conn of connections) {
            workflowEventEmitter.emitDirectTriggered(context.canvasId, {
                canvasId: context.canvasId,
                connectionId: conn.id,
                sourcePodId: conn.sourcePodId,
                targetPodId: context.targetPodId,
                transferredContent: context.summary,
                isSummarized: context.isSummarized,
            });
        }
    }

    onComplete(context: CompletionContext, success: boolean, error?: string): void {
        const connections = this.getConnectionsToIterate(
            context.canvasId,
            context.participatingConnectionIds
        );

        for (const conn of connections) {
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
        }
    }

    onError(context: CompletionContext, errorMessage: string): void {
        this.onComplete(context, false, errorMessage);
    }

    onQueued(context: QueuedContext): void {
        const connections = this.getConnectionsToIterate(
            context.canvasId,
            context.participatingConnectionIds
        );

        for (const conn of connections) {
            connectionStore.updateConnectionStatus(context.canvasId, conn.id, 'queued');
            workflowEventEmitter.emitWorkflowQueued(
                context.canvasId,
                buildQueuedPayload(context, conn.id, conn.sourcePodId)
            );
        }
    }

    /**
     * 僅發送 WORKFLOW_QUEUE_PROCESSED 事件，不設定 connection 為 active。
     * active 狀態由 triggerWorkflowWithSummary 統一設定。
     */
    onQueueProcessed(context: QueueProcessedContext): void {
        const connections = this.getConnectionsToIterate(
            context.canvasId,
            context.participatingConnectionIds
        );

        for (const conn of connections) {
            workflowEventEmitter.emitWorkflowQueueProcessed(context.canvasId, {
                canvasId: context.canvasId,
                targetPodId: context.targetPodId,
                connectionId: conn.id,
                sourcePodId: conn.sourcePodId,
                remainingQueueSize: context.remainingQueueSize,
                triggerMode: context.triggerMode,
            });
        }
    }
}

export const workflowDirectTriggerService = new WorkflowDirectTriggerService();
