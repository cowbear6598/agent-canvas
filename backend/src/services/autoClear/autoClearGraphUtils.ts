import {connectionStore} from '../connectionStore.js';

export function getAutoTriggerTargets(canvasId: string, podId: string): string[] {
    const connections = connectionStore.findBySourcePodId(canvasId, podId);
    const triggerableConnections = connections.filter((connection) => connection.triggerMode === 'auto');
    return triggerableConnections.map((connection) => connection.targetPodId);
}

export function isTerminalPod(podId: string, sourcePodId: string, hasAutoTriggerTargets: boolean): boolean {
    return podId !== sourcePodId && !hasAutoTriggerTargets;
}

export function traverseAutoTriggerGraph(
    canvasId: string,
    startPodIds: string[],
    visitor: (podId: string, autoTriggerTargets: string[]) => void,
): void {
    const visitedPodIds = new Set<string>();
    const pendingPodIds: string[] = [];

    for (const podId of startPodIds) {
        visitedPodIds.add(podId);
        pendingPodIds.push(podId);
    }

    while (pendingPodIds.length > 0) {
        const currentPodId = pendingPodIds.shift()!;
        const autoTriggerTargets = getAutoTriggerTargets(canvasId, currentPodId);

        visitor(currentPodId, autoTriggerTargets);

        for (const nextPodId of autoTriggerTargets) {
            if (!visitedPodIds.has(nextPodId)) {
                visitedPodIds.add(nextPodId);
                pendingPodIds.push(nextPodId);
            }
        }
    }
}

export function incrementCountForDirectIncoming(
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
    const hasDirectIncoming = incomingConnections.some(connection => connection.triggerMode === 'direct');
    if (hasDirectIncoming) {
        propagatedCounts.set(podId, currentCount + 1);
    }
}

export function buildPropagatedCounts(canvasId: string, sourcePodId: string): Map<string, number> {
    const propagatedCounts = new Map<string, number>();
    propagatedCounts.set(sourcePodId, 1);

    traverseAutoTriggerGraph(canvasId, [sourcePodId], (podId, autoTriggerTargets) => {
        const currentCount = propagatedCounts.get(podId) ?? 1;
        incrementCountForDirectIncoming(canvasId, podId, sourcePodId, currentCount, propagatedCounts);

        const updatedCount = propagatedCounts.get(podId) ?? 1;
        for (const targetPodId of autoTriggerTargets) {
            propagatedCounts.set(targetPodId, (propagatedCounts.get(targetPodId) ?? 0) + updatedCount);
        }
    });

    return propagatedCounts;
}
