import {vi} from 'vitest';
import {connectionStore} from '../../src/services/connectionStore.js';
import {podStore} from '../../src/services/podStore.js';
import {messageStore} from '../../src/services/messageStore.js';
import {workflowEventEmitter} from '../../src/services/workflow/workflowEventEmitter.js';
import {directTriggerStore} from '../../src/services/directTriggerStore.js';
import {pendingTargetStore} from '../../src/services/pendingTargetStore.js';
import {summaryService} from '../../src/services/summaryService.js';
import {logger} from '../../src/utils/logger.js';
import {socketService} from '../../src/services/socketService.js';
import {workflowStateService} from '../../src/services/workflow/workflowStateService.js';
import {commandService} from '../../src/services/commandService.js';
import {claudeService} from '../../src/services/claude/claudeService.js';
import {runStore} from '../../src/services/runStore.js';
import {runExecutionService} from '../../src/services/workflow/runExecutionService.js';
import type {Connection, PersistedMessage, Pod} from '../../src/types/index.js';
import type {WorkflowRun, RunPodInstance} from '../../src/services/runStore.js';

interface SetupAllSpiesOptions {
    podLookup?: Map<string, Pod>;
    messages?: PersistedMessage[];
    summary?: { targetPodId: string; success: boolean; summary: string };
    // 自訂 podStore.getById 實作（用於動態查詢）
    customPodGetter?: (canvasId: string, podId: string) => Pod | undefined;
    // 自訂 connectionStore.getById 返回值
    connection?: Connection;
    // 自訂 workflowStateService.getDirectConnectionCount 返回值
    directConnectionCount?: number;
    // 自訂 claudeService.sendMessage 實作
    customClaudeQuery?: (...args: any[]) => Promise<any>;
}

export function setupConnectionStoreSpy(connection?: Connection) {
    return {
        findBySourcePodId: vi.spyOn(connectionStore, 'findBySourcePodId').mockReturnValue([]),
        getById: vi.spyOn(connectionStore, 'getById').mockReturnValue(connection),
        updateDecideStatus: vi.spyOn(connectionStore, 'updateDecideStatus').mockReturnValue(undefined),
        updateConnectionStatus: vi.spyOn(connectionStore, 'updateConnectionStatus').mockReturnValue(undefined),
        findByTargetPodId: vi.spyOn(connectionStore, 'findByTargetPodId').mockReturnValue([]),
    };
}

export function setupPodStoreSpy(
    podLookup?: Map<string, Pod>,
    customPodGetter?: (canvasId: string, podId: string) => Pod | undefined
) {
    const spies = {
        getById: vi.spyOn(podStore, 'getById').mockImplementation((canvasId: string, podId: string) => {
            if (customPodGetter) {
                return customPodGetter(canvasId, podId);
            }
            if (podLookup) {
                return podLookup.get(podId);
            }
            return undefined;
        }),
        setStatus: vi.spyOn(podStore, 'setStatus').mockImplementation(() => {
        }),
        update: vi.spyOn(podStore, 'update').mockReturnValue(undefined),
    };
    return spies;
}

export function setupMessageStoreSpy(messages?: PersistedMessage[]) {
    const spies = {
        getMessages: vi.spyOn(messageStore, 'getMessages').mockReturnValue(messages || []),
        upsertMessage: vi.spyOn(messageStore, 'upsertMessage').mockImplementation(() => {
        }),
        clearMessages: vi.spyOn(messageStore, 'clearMessages').mockImplementation(() => {
        }),
    };
    return spies;
}

export function setupWorkflowEventEmitterSpy() {
    const spies = {
        emitWorkflowComplete: vi.spyOn(workflowEventEmitter, 'emitWorkflowComplete').mockImplementation(() => {
        }),
        emitWorkflowAutoTriggered: vi.spyOn(workflowEventEmitter, 'emitWorkflowAutoTriggered').mockImplementation(() => {
        }),
        emitWorkflowPending: vi.spyOn(workflowEventEmitter, 'emitWorkflowPending').mockImplementation(() => {
        }),
        emitWorkflowSourcesMerged: vi.spyOn(workflowEventEmitter, 'emitWorkflowSourcesMerged').mockImplementation(() => {
        }),
        emitAiDecidePending: vi.spyOn(workflowEventEmitter, 'emitAiDecidePending').mockImplementation(() => {
        }),
        emitAiDecideResult: vi.spyOn(workflowEventEmitter, 'emitAiDecideResult').mockImplementation(() => {
        }),
        emitAiDecideError: vi.spyOn(workflowEventEmitter, 'emitAiDecideError').mockImplementation(() => {
        }),
        emitAiDecideClear: vi.spyOn(workflowEventEmitter, 'emitAiDecideClear').mockImplementation(() => {
        }),
        emitDirectTriggered: vi.spyOn(workflowEventEmitter, 'emitDirectTriggered').mockImplementation(() => {
        }),
        emitDirectWaiting: vi.spyOn(workflowEventEmitter, 'emitDirectWaiting').mockImplementation(() => {
        }),
        emitWorkflowQueued: vi.spyOn(workflowEventEmitter, 'emitWorkflowQueued').mockImplementation(() => {
        }),
        emitWorkflowQueueProcessed: vi.spyOn(workflowEventEmitter, 'emitWorkflowQueueProcessed').mockImplementation(() => {
        }),
        emitDirectCountdown: vi.spyOn(workflowEventEmitter, 'emitDirectCountdown').mockImplementation(() => {
        }),
        emitDirectMerged: vi.spyOn(workflowEventEmitter, 'emitDirectMerged').mockImplementation(() => {
        }),
    };
    return spies;
}

export function setupDirectTriggerStoreSpy() {
    const spies = {
        hasDirectPending: vi.spyOn(directTriggerStore, 'hasDirectPending').mockReturnValue(false),
        initializeDirectPending: vi.spyOn(directTriggerStore, 'initializeDirectPending').mockImplementation(() => {
        }),
        recordDirectReady: vi.spyOn(directTriggerStore, 'recordDirectReady').mockReturnValue(0),
        clearDirectPending: vi.spyOn(directTriggerStore, 'clearDirectPending').mockImplementation(() => {
        }),
        hasActiveTimer: vi.spyOn(directTriggerStore, 'hasActiveTimer').mockReturnValue(false),
        clearTimer: vi.spyOn(directTriggerStore, 'clearTimer').mockImplementation(() => {
        }),
        setTimer: vi.spyOn(directTriggerStore, 'setTimer').mockImplementation(() => {
        }),
        getReadySummaries: vi.spyOn(directTriggerStore, 'getReadySummaries').mockReturnValue(null),
    };
    return spies;
}

export function setupPendingTargetStoreSpy() {
    const spies = {
        hasPendingTarget: vi.spyOn(pendingTargetStore, 'hasPendingTarget').mockReturnValue(false),
        getPendingTarget: vi.spyOn(pendingTargetStore, 'getPendingTarget').mockReturnValue(undefined),
        clearPendingTarget: vi.spyOn(pendingTargetStore, 'clearPendingTarget').mockImplementation(() => {
        }),
        initializePendingTarget: vi.spyOn(pendingTargetStore, 'initializePendingTarget').mockImplementation(() => {
        }),
        recordSourceCompletion: vi.spyOn(pendingTargetStore, 'recordSourceCompletion').mockReturnValue({
            allSourcesResponded: false,
            hasRejection: false,
        }),
        recordSourceRejection: vi.spyOn(pendingTargetStore, 'recordSourceRejection').mockImplementation(() => {
        }),
        getCompletedSummaries: vi.spyOn(pendingTargetStore, 'getCompletedSummaries').mockReturnValue(undefined),
    };
    return spies;
}

export function setupSummaryServiceSpy(summary?: { targetPodId: string; success: boolean; summary: string }) {
    const spies = {
        generateSummaryForTarget: vi.spyOn(summaryService, 'generateSummaryForTarget').mockResolvedValue(
            summary || {targetPodId: 'target-pod', success: true, summary: 'Test summary'}
        ),
    };
    return spies;
}

export function setupLoggerSpy() {
    const spies = {
        log: vi.spyOn(logger, 'log').mockImplementation(() => {
        }),
        error: vi.spyOn(logger, 'error').mockImplementation(() => {
        }),
    };
    return spies;
}

export function setupSocketServiceSpy() {
    const spies = {
        emitToCanvas: vi.spyOn(socketService, 'emitToCanvas').mockImplementation(() => {
        }),
    };
    return spies;
}

export function setupWorkflowStateServiceSpy(directConnectionCount?: number) {
    const spies = {
        checkMultiInputScenario: vi.spyOn(workflowStateService, 'checkMultiInputScenario').mockReturnValue({
            isMultiInput: false,
            requiredSourcePodIds: [],
        }),
        getDirectConnectionCount: vi.spyOn(workflowStateService, 'getDirectConnectionCount').mockReturnValue(directConnectionCount ?? 0),
    };
    return spies;
}

export function setupCommandServiceSpy() {
    const spies = {
        list: vi.spyOn(commandService, 'list').mockResolvedValue([]),
    };
    return spies;
}

export function setupClaudeServiceSpy(customClaudeQuery?: (...args: any[]) => Promise<any>) {
    const defaultImplementation = async (...args: any[]) => {
        const callback = args[2] as any;
        if (callback) {
            callback({type: 'text', content: 'Response text'});
            callback({type: 'complete'});
        }
    };

    const spies = {
        sendMessage: vi.spyOn(claudeService, 'sendMessage').mockImplementation(
            (customClaudeQuery || defaultImplementation) as any
        ),
    };
    return spies;
}

export function setupRunStoreSpy() {
    const spies = {
        createRun: vi.spyOn(runStore, 'createRun').mockImplementation((canvasId: string, sourcePodId: string, triggerMessage: string): WorkflowRun => ({
            id: 'test-run-id',
            canvasId,
            sourcePodId,
            triggerMessage,
            status: 'running',
            createdAt: new Date().toISOString(),
            completedAt: null,
        })),
        getRun: vi.spyOn(runStore, 'getRun').mockReturnValue(undefined),
        getRunsByCanvasId: vi.spyOn(runStore, 'getRunsByCanvasId').mockReturnValue([]),
        updateRunStatus: vi.spyOn(runStore, 'updateRunStatus').mockImplementation(() => {}),
        deleteRun: vi.spyOn(runStore, 'deleteRun').mockImplementation(() => {}),
        countRunsByCanvasId: vi.spyOn(runStore, 'countRunsByCanvasId').mockReturnValue(0),
        getOldestCompletedRunIds: vi.spyOn(runStore, 'getOldestCompletedRunIds').mockReturnValue([]),
        createPodInstance: vi.spyOn(runStore, 'createPodInstance').mockImplementation((runId: string, podId: string): RunPodInstance => ({
            id: 'test-instance-id',
            runId,
            podId,
            status: 'pending',
            claudeSessionId: null,
            errorMessage: null,
            triggeredAt: null,
            completedAt: null,
        })),
        getPodInstance: vi.spyOn(runStore, 'getPodInstance').mockReturnValue(undefined),
        getPodInstancesByRunId: vi.spyOn(runStore, 'getPodInstancesByRunId').mockReturnValue([]),
        updatePodInstanceStatus: vi.spyOn(runStore, 'updatePodInstanceStatus').mockImplementation(() => {}),
        updatePodInstanceClaudeSessionId: vi.spyOn(runStore, 'updatePodInstanceClaudeSessionId').mockImplementation(() => {}),
        getRunningPodInstances: vi.spyOn(runStore, 'getRunningPodInstances').mockReturnValue([]),
        addRunMessage: vi.spyOn(runStore, 'addRunMessage').mockImplementation(() => ({
            id: 'test-msg-id',
            role: 'user' as const,
            content: '',
            timestamp: new Date().toISOString(),
        })),
        upsertRunMessage: vi.spyOn(runStore, 'upsertRunMessage').mockImplementation(() => {}),
        getRunMessages: vi.spyOn(runStore, 'getRunMessages').mockReturnValue([]),
    };
    return spies;
}

export function setupRunExecutionServiceSpy() {
    const spies = {
        createRun: vi.spyOn(runExecutionService, 'createRun').mockResolvedValue({ runId: 'test-run-id', canvasId: 'canvas-1', sourcePodId: 'source-pod' }),
        startPodInstance: vi.spyOn(runExecutionService, 'startPodInstance').mockImplementation(() => {}),
        completePodInstance: vi.spyOn(runExecutionService, 'completePodInstance').mockImplementation(() => {}),
        errorPodInstance: vi.spyOn(runExecutionService, 'errorPodInstance').mockImplementation(() => {}),
        summarizingPodInstance: vi.spyOn(runExecutionService, 'summarizingPodInstance').mockImplementation(() => {}),
        skipPodInstance: vi.spyOn(runExecutionService, 'skipPodInstance').mockImplementation(() => {}),
        registerActiveStream: vi.spyOn(runExecutionService, 'registerActiveStream').mockImplementation(() => {}),
        unregisterActiveStream: vi.spyOn(runExecutionService, 'unregisterActiveStream').mockImplementation(() => {}),
        deleteRun: vi.spyOn(runExecutionService, 'deleteRun').mockImplementation(() => {}),
    };
    return spies;
}

export function setupAllSpies(options?: SetupAllSpiesOptions) {
    return {
        connectionStore: setupConnectionStoreSpy(options?.connection),
        podStore: setupPodStoreSpy(options?.podLookup, options?.customPodGetter),
        messageStore: setupMessageStoreSpy(options?.messages),
        workflowEventEmitter: setupWorkflowEventEmitterSpy(),
        directTriggerStore: setupDirectTriggerStoreSpy(),
        pendingTargetStore: setupPendingTargetStoreSpy(),
        summaryService: setupSummaryServiceSpy(options?.summary),
        logger: setupLoggerSpy(),
        socketService: setupSocketServiceSpy(),
        workflowStateService: setupWorkflowStateServiceSpy(options?.directConnectionCount),
        commandService: setupCommandServiceSpy(),
        claudeService: setupClaudeServiceSpy(options?.customClaudeQuery),
        runStore: setupRunStoreSpy(),
        runExecutionService: setupRunExecutionServiceSpy(),
    };
}
