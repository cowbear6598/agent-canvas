import {connectionStore} from '../services/connectionStore.js';
import {podStore} from '../services/podStore.js';
import {logger} from './logger.js';
import type {LogCategory} from './logger.js';
import {isPodBusy} from '../types/index.js';

const MAX_WORKFLOW_CHAIN_SIZE = 50;

type ConnectionMaps = {
    sourceMap: Map<string, string[]>
    targetMap: Map<string, string[]>
}

function buildConnectionMaps(canvasId: string): ConnectionMaps {
    const connections = connectionStore.list(canvasId);
    const sourceMap = new Map<string, string[]>();
    const targetMap = new Map<string, string[]>();

    for (const conn of connections) {
        if (!sourceMap.has(conn.sourcePodId)) sourceMap.set(conn.sourcePodId, []);
        sourceMap.get(conn.sourcePodId)!.push(conn.targetPodId);

        if (!targetMap.has(conn.targetPodId)) targetMap.set(conn.targetPodId, []);
        targetMap.get(conn.targetPodId)!.push(conn.sourcePodId);
    }

    return { sourceMap, targetMap };
}

function getAdjacentPodIds(podId: string, maps: ConnectionMaps): string[] {
    const downstream = maps.sourceMap.get(podId) ?? [];
    const upstream = maps.targetMap.get(podId) ?? [];
    return [...downstream, ...upstream];
}

function processQueueItem(
    currentId: string,
    visited: Set<string>,
    queue: string[],
    maps: ConnectionMaps,
    predicate: (podId: string) => boolean
): boolean {
    if (predicate(currentId)) return true;

    for (const adjacentId of getAdjacentPodIds(currentId, maps)) {
        if (!visited.has(adjacentId)) {
            visited.add(adjacentId);
            queue.push(adjacentId);
        }
    }
    return false;
}

function processBfsQueue(
    logCategory: LogCategory,
    queue: string[],
    visited: Set<string>,
    maps: ConnectionMaps,
    predicate: (podId: string) => boolean
): boolean {
    while (queue.length > 0) {
        if (visited.size > MAX_WORKFLOW_CHAIN_SIZE) {
            logger.warn(logCategory, 'Warn', `Workflow 鏈超過最大限制 ${MAX_WORKFLOW_CHAIN_SIZE}，停止遍歷`);
            return false;
        }
        const currentId = queue.shift();
        if (!currentId) break;
        if (processQueueItem(currentId, visited, queue, maps, predicate)) return true;
    }
    return false;
}

// 需要雙向遍歷才能檢測到 Workflow 中間節點的狀態變化，單向遍歷會遺漏反向依賴
export function traverseWorkflowChain(
    logCategory: LogCategory,
    canvasId: string,
    startPodId: string,
    predicate: (podId: string) => boolean
): boolean {
    const maps = buildConnectionMaps(canvasId);
    const visited = new Set<string>([startPodId]);
    const queue = getAdjacentPodIds(startPodId, maps).filter(id => !visited.has(id));
    queue.forEach(id => visited.add(id));
    return processBfsQueue(logCategory, queue, visited, maps, predicate);
}

export function isWorkflowChainBusy(canvasId: string, podId: string): boolean {
    return traverseWorkflowChain('Workflow', canvasId, podId, (currentId) => {
        const pod = podStore.getById(canvasId, currentId);
        return pod !== undefined && isPodBusy(pod.status);
    });
}
