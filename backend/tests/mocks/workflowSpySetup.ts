import {vi} from 'vitest';
import {connectionStore} from '../../src/services/connectionStore.js';
import {podStore} from '../../src/services/podStore.js';
import {messageStore} from '../../src/services/messageStore.js';
import {workflowEventEmitter} from '../../src/services/workflow/workflowEventEmitter.js';
import {directTriggerStore} from '../../src/services/directTriggerStore.js';
import {pendingTargetStore} from '../../src/services/pendingTargetStore.js';
import {summaryService} from '../../src/services/summaryService.js';
import {autoClearService} from '../../src/services/autoClear/index.js';
import {logger} from '../../src/utils/logger.js';
import {socketService} from '../../src/services/socketService.js';
import {workflowStateService} from '../../src/services/workflow/workflowStateService.js';
import {commandService} from '../../src/services/commandService.js';
import {claudeService} from '../../src/services/claude/claudeService.js';
import type {Connection, PersistedMessage, Pod} from '../../src/types/index.js';

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

export function setupAutoClearServiceSpy() {
    const spies = {
        initializeWorkflowTracking: vi.spyOn(autoClearService, 'initializeWorkflowTracking').mockImplementation(() => {
        }),
        onPodComplete: vi.spyOn(autoClearService, 'onPodComplete').mockResolvedValue(undefined),
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

export function setupAllSpies(options?: SetupAllSpiesOptions) {
    return {
        connectionStore: setupConnectionStoreSpy(options?.connection),
        podStore: setupPodStoreSpy(options?.podLookup, options?.customPodGetter),
        messageStore: setupMessageStoreSpy(options?.messages),
        workflowEventEmitter: setupWorkflowEventEmitterSpy(),
        directTriggerStore: setupDirectTriggerStoreSpy(),
        pendingTargetStore: setupPendingTargetStoreSpy(),
        summaryService: setupSummaryServiceSpy(options?.summary),
        autoClearService: setupAutoClearServiceSpy(),
        logger: setupLoggerSpy(),
        socketService: setupSocketServiceSpy(),
        workflowStateService: setupWorkflowStateServiceSpy(options?.directConnectionCount),
        commandService: setupCommandServiceSpy(),
        claudeService: setupClaudeServiceSpy(options?.customClaudeQuery),
    };
}
