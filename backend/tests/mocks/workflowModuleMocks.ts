import { vi } from 'vitest';

export function createPodStoreMock() {
  return {
    podStore: {
      getById: vi.fn(),
      setStatus: vi.fn(),
      update: vi.fn(),
    },
  };
}

export function createConnectionStoreMock() {
  return {
    connectionStore: {
      findBySourcePodId: vi.fn(),
      getById: vi.fn(),
      updateDecideStatus: vi.fn(),
      updateConnectionStatus: vi.fn(),
      findByTargetPodId: vi.fn(),
    },
  };
}

export function createMessageStoreMock() {
  return {
    messageStore: {
      getMessages: vi.fn(),
      upsertMessage: vi.fn(),
      clearMessages: vi.fn(),
    },
  };
}

export function createSummaryServiceMock() {
  return {
    summaryService: {
      generateSummaryForTarget: vi.fn(),
    },
  };
}

export function createPendingTargetStoreMock() {
  return {
    pendingTargetStore: {
      hasPendingTarget: vi.fn(),
      getPendingTarget: vi.fn(),
      clearPendingTarget: vi.fn(),
      initializePendingTarget: vi.fn(),
      recordSourceCompletion: vi.fn(),
      recordSourceRejection: vi.fn().mockReturnValue({ allSourcesResponded: false }),
      getCompletedSummaries: vi.fn(),
    },
  };
}

export function createWorkflowStateServiceMock() {
  return {
    workflowStateService: {
      checkMultiInputScenario: vi.fn(),
      emitPendingStatus: vi.fn(),
      getDirectConnectionCount: vi.fn(),
    },
  };
}

export function createWorkflowEventEmitterMock() {
  return {
    workflowEventEmitter: {
      emitWorkflowAutoTriggered: vi.fn(),
      emitAiDecidePending: vi.fn(),
      emitAiDecideResult: vi.fn(),
      emitAiDecideError: vi.fn(),
      emitWorkflowQueued: vi.fn(),
      emitWorkflowComplete: vi.fn(),
      emitWorkflowPending: vi.fn(),
      emitWorkflowSourcesMerged: vi.fn(),
      emitAiDecideClear: vi.fn(),
      emitDirectTriggered: vi.fn(),
      emitDirectWaiting: vi.fn(),
      emitWorkflowQueueProcessed: vi.fn(),
      emitDirectCountdown: vi.fn(),
      emitDirectMerged: vi.fn(),
      emitWorkflowAiDecideTriggered: vi.fn(),
    },
  };
}

export function createAiDecideServiceMock() {
  return {
    aiDecideService: {
      decideConnections: vi.fn(),
    },
  };
}

export function createAutoClearServiceMock() {
  return {
    autoClearService: {
      initializeWorkflowTracking: vi.fn(),
      onPodComplete: vi.fn(),
      onGroupNotTriggered: vi.fn().mockResolvedValue(undefined),
    },
  };
}

export function createLoggerMock() {
  return {
    logger: {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

export function createSocketServiceMock() {
  return {
    socketService: {
      emitToCanvas: vi.fn(),
    },
  };
}

export function createClaudeQueryServiceMock() {
  return {
    claudeQueryService: {
      executeChatInPod: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
  };
}

export function createCommandServiceMock() {
  return {
    commandService: {
      getContent: vi.fn(),
      list: vi.fn(async () => []),
    },
  };
}

export function createWorkflowMultiInputServiceMock() {
  return {
    workflowMultiInputService: {
      handleMultiInputForConnection: vi.fn(),
      init: vi.fn(),
    },
  };
}

export function createDirectTriggerStoreMock() {
  return {
    directTriggerStore: {
      hasDirectPending: vi.fn(),
      initializeDirectPending: vi.fn(),
      recordDirectReady: vi.fn(),
      clearDirectPending: vi.fn(),
      hasActiveTimer: vi.fn(),
      clearTimer: vi.fn(),
      setTimer: vi.fn(),
      getReadySummaries: vi.fn(),
    },
  };
}

export function createWorkflowPipelineMock() {
  return {
    workflowPipeline: {
      execute: vi.fn(),
      init: vi.fn(),
    },
  };
}

export function createErrorHelpersMock() {
  return {
    getErrorMessage: vi.fn((e) => e?.message ?? String(e)),
  };
}
