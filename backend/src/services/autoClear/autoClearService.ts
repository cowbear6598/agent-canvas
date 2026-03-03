import {connectionStore} from '../connectionStore.js';
import {podStore} from '../podStore.js';
import {workflowClearService} from '../workflowClearService.js';
import {socketService} from '../socketService.js';
import {terminalPodTracker} from './terminalPodTracker.js';
import {workflowEventEmitter} from '../workflow/workflowEventEmitter.js';
import {WebSocketResponseEvents} from '../../schemas';
import {logger} from '../../utils/logger.js';

function getAutoTriggerTargets(canvasId: string, podId: string): string[] {
    const connections = connectionStore.findBySourcePodId(canvasId, podId);
    const triggerableConnections = connections.filter((conn) => conn.triggerMode === 'auto');
    return triggerableConnections.map((conn) => conn.targetPodId);
}

function isTerminalPod(podId: string, sourcePodId: string, hasAutoTriggerTargets: boolean): boolean {
    return podId !== sourcePodId && !hasAutoTriggerTargets;
}

type BfsVisitor = (podId: string, isTerminal: boolean, autoTriggerTargets: string[]) => void;

class AutoClearService {
    private buildPropagatedCounts(canvasId: string, sourcePodId: string): Map<string, number> {
        const visitedPodIds = new Set<string>();
        const pendingPodIds: string[] = [sourcePodId];
        const propagatedCounts = new Map<string, number>();

        visitedPodIds.add(sourcePodId);
        propagatedCounts.set(sourcePodId, 1);

        while (pendingPodIds.length > 0) {
            const currentPodId = pendingPodIds.shift()!;
            const currentCount = propagatedCounts.get(currentPodId) ?? 1;

            this.accumulateDirectBonus(canvasId, currentPodId, sourcePodId, currentCount, propagatedCounts);

            const updatedCount = propagatedCounts.get(currentPodId) ?? 1;
            const autoTriggerTargets = getAutoTriggerTargets(canvasId, currentPodId);
            this.enqueueAutoTriggerTargets(autoTriggerTargets, visitedPodIds, pendingPodIds, propagatedCounts, updatedCount);
        }

        return propagatedCounts;
    }

    findTerminalPods(canvasId: string, sourcePodId: string): Map<string, number> {
        const propagatedCounts = this.buildPropagatedCounts(canvasId, sourcePodId);
        const terminalPods = new Map<string, number>();

        for (const [podId, count] of propagatedCounts) {
            const autoTriggerTargets = getAutoTriggerTargets(canvasId, podId);
            if (isTerminalPod(podId, sourcePodId, autoTriggerTargets.length > 0)) {
                terminalPods.set(podId, count);
            }
        }

        return terminalPods;
    }

    hasOutgoingAutoTrigger(canvasId: string, podId: string): boolean {
        const autoTriggerTargets = getAutoTriggerTargets(canvasId, podId);
        return autoTriggerTargets.length > 0;
    }

    private async handleWorkflowComplete(canvasId: string, sourcePodId: string): Promise<void> {
        // 先同步清除追蹤，避免 await 期間重入
        terminalPodTracker.clearTracking(sourcePodId);
        await this.executeAutoClear(canvasId, sourcePodId);
    }

    private async handleStandaloneAutoClear(canvasId: string, podId: string): Promise<void> {
        if (this.hasOutgoingAutoTrigger(canvasId, podId)) {
            return;
        }

        logger.log('AutoClear', 'Complete', `執行獨立 Pod 的自動清除：${podId}`);
        await this.executeAutoClear(canvasId, podId);
    }

    async onPodComplete(canvasId: string, podId: string): Promise<void> {
        const pod = podStore.getById(canvasId, podId);
        if (!pod) {
            return;
        }

        const {allComplete, sourcePodId} = terminalPodTracker.recordCompletion(podId);

        if (allComplete && sourcePodId) {
            await this.handleWorkflowComplete(canvasId, sourcePodId);
            return;
        }

        if (!pod.autoClear) {
            return;
        }

        await this.handleStandaloneAutoClear(canvasId, podId);
    }

    async onGroupNotTriggered(canvasId: string, targetPodId: string): Promise<void> {
        logger.log('AutoClear', 'Update', `群組未觸發，目標 ${targetPodId}，正在尋找受影響的 terminal Pod`);

        const affectedPodIds = this.findAffectedTerminalPods(canvasId, targetPodId);

        logger.log('AutoClear', 'Update', `群組未觸發，目標 ${targetPodId}，受影響的 terminal Pod：${affectedPodIds.join(', ')}`);

        for (const podId of affectedPodIds) {
            const { allComplete, sourcePodId } = terminalPodTracker.decrementExpectedCount(podId);
            if (allComplete && sourcePodId) {
                logger.log('AutoClear', 'Complete', `遞減後所有 terminal Pod 已完成，來源 ${sourcePodId}，執行自動清除`);
                // 先同步清除追蹤，避免 await 期間重入；找到第一個完成即 break
                terminalPodTracker.clearTracking(sourcePodId);
                await this.executeAutoClear(canvasId, sourcePodId);
                break;
            }
        }
    }

    initializeWorkflowTracking(canvasId: string, sourcePodId: string): void {
        const pod = podStore.getById(canvasId, sourcePodId);
        if (!pod || !pod.autoClear) {
            return;
        }

        if (!this.hasOutgoingAutoTrigger(canvasId, sourcePodId)) {
            logger.log('AutoClear', 'Update', `來源 Pod ${sourcePodId} 沒有 auto-trigger 連線，略過 workflow 追蹤`);
            return;
        }

        const terminalPods = this.findTerminalPods(canvasId, sourcePodId);

        if (terminalPods.size === 0) {
            logger.log('AutoClear', 'Update', `未找到來源 ${sourcePodId} 的 terminal Pod，略過 workflow 追蹤`);
            return;
        }

        terminalPodTracker.initializeTracking(sourcePodId, terminalPods);
    }

    async executeAutoClear(canvasId: string, sourcePodId: string): Promise<void> {
        const result = await workflowClearService.clearWorkflow(canvasId, sourcePodId);

        if (!result.success) {
            logger.error('AutoClear', 'Error', `執行自動清除失敗：${result.error}`);
            return;
        }

        const payload = {
            canvasId,
            sourcePodId,
            clearedPodIds: result.clearedPodIds,
            clearedPodNames: result.clearedPodNames,
        };

        socketService.emitToCanvas(canvasId, WebSocketResponseEvents.WORKFLOW_AUTO_CLEARED, payload);

        if (result.clearedConnectionIds.length > 0) {
            workflowEventEmitter.emitAiDecideClear(canvasId, result.clearedConnectionIds);
        }

        logger.log('AutoClear', 'Complete', `成功清除 ${result.clearedPodIds.length} 個 Pod：${result.clearedPodNames.join(', ')}`);
    }

    private bfsAutoTriggerGraph(canvasId: string, startPodId: string, visitor: BfsVisitor): void {
        const visitedPodIds = new Set<string>();
        const pendingPodIds = [startPodId];

        visitedPodIds.add(startPodId);

        while (pendingPodIds.length > 0) {
            const currentPodId = pendingPodIds.shift()!;
            const autoTriggerTargets = getAutoTriggerTargets(canvasId, currentPodId);
            const hasAutoTriggerTargets = autoTriggerTargets.length > 0;
            const isTerminal = isTerminalPod(currentPodId, startPodId, hasAutoTriggerTargets);

            visitor(currentPodId, isTerminal, autoTriggerTargets);

            for (const nextPodId of autoTriggerTargets) {
                if (!visitedPodIds.has(nextPodId)) {
                    visitedPodIds.add(nextPodId);
                    pendingPodIds.push(nextPodId);
                }
            }
        }
    }

    private accumulateDirectBonus(
        canvasId: string,
        podId: string,
        sourcePodId: string,
        currentCount: number,
        propagatedCounts: Map<string, number>
    ): void {
        if (podId === sourcePodId) {
            return;
        }

        const incomingConnections = connectionStore.findByTargetPodId(canvasId, podId);
        const hasDirectIncoming = incomingConnections.some(conn => conn.triggerMode === 'direct');
        if (hasDirectIncoming) {
            propagatedCounts.set(podId, currentCount + 1);
        }
    }

    private enqueueAutoTriggerTargets(
        targets: string[],
        visitedPodIds: Set<string>,
        pendingPodIds: string[],
        propagatedCounts: Map<string, number>,
        parentCount: number
    ): void {
        for (const targetPodId of targets) {
            if (!visitedPodIds.has(targetPodId)) {
                visitedPodIds.add(targetPodId);
                propagatedCounts.set(targetPodId, (propagatedCounts.get(targetPodId) ?? 0) + parentCount);
                pendingPodIds.push(targetPodId);
            }
        }
    }

    private findAffectedTerminalPods(canvasId: string, targetPodId: string): string[] {
        const affectedPodIds: string[] = [];

        this.bfsAutoTriggerGraph(canvasId, targetPodId, (podId, isTerminal, autoTriggerTargets) => {
            if (isTerminal || (podId === targetPodId && autoTriggerTargets.length === 0)) {
                affectedPodIds.push(podId);
            }
        });

        return affectedPodIds;
    }
}

export const autoClearService = new AutoClearService();
