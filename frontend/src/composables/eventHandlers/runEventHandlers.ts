import { WebSocketResponseEvents } from '@/services/websocket'
import { useRunStore } from '@/stores/run/runStore'
import { createUnifiedHandler, isCurrentCanvas } from './sharedHandlerUtils'
import type { BasePayload } from './sharedHandlerUtils'
import type {
  RunCreatedPayload,
  RunStatusChangedPayload,
  RunPodStatusChangedPayload,
  RunDeletedPayload,
  RunMessagePayload,
  RunChatCompletePayload,
  RunToolUsePayload,
  RunToolResultPayload,
} from '@/types/websocket/responses'

// === Unified Handlers ===

const handleRunCreated = createUnifiedHandler<BasePayload & RunCreatedPayload>(
  (payload) => {
    useRunStore().addRun(payload.run)
  }
)

const handleRunStatusChanged = createUnifiedHandler<BasePayload & RunStatusChangedPayload>(
  (payload) => {
    useRunStore().updateRunStatus(payload.runId, payload.status, payload.completedAt)
  }
)

const handleRunPodStatusChanged = createUnifiedHandler<BasePayload & RunPodStatusChangedPayload>(
  (payload) => {
    useRunStore().updatePodInstanceStatus({
      runId: payload.runId,
      podId: payload.podId,
      status: payload.status,
      lastResponseSummary: payload.lastResponseSummary,
      errorMessage: payload.errorMessage,
      triggeredAt: payload.triggeredAt,
      completedAt: payload.completedAt,
    })
  }
)

const handleRunDeleted = createUnifiedHandler<BasePayload & RunDeletedPayload>(
  (payload) => {
    // 收到後端推送的刪除事件，直接移除（不再發 WebSocket 避免迴圈）
    useRunStore().removeRun(payload.runId)
  }
)

// === Standalone Handlers ===

export const handleRunMessage = (payload: RunMessagePayload): void => {
  if (!payload.canvasId || !isCurrentCanvas(payload.canvasId)) return

  useRunStore().appendRunChatMessage(
    payload.runId,
    payload.podId,
    payload.messageId,
    payload.content,
    payload.isPartial,
    payload.role ?? 'assistant'
  )
}

export const handleRunChatComplete = (payload: RunChatCompletePayload): void => {
  if (!payload.canvasId || !isCurrentCanvas(payload.canvasId)) return

  useRunStore().handleRunChatComplete(
    payload.runId,
    payload.podId,
    payload.messageId,
    payload.fullContent
  )
}

export const handleRunToolUse = (payload: RunToolUsePayload): void => {
  if (!payload.canvasId || !isCurrentCanvas(payload.canvasId)) return

  useRunStore().handleRunChatToolUse({
    runId: payload.runId,
    podId: payload.podId,
    messageId: payload.messageId,
    toolUseId: payload.toolUseId,
    toolName: payload.toolName,
    input: payload.input,
  })
}

export const handleRunToolResult = (payload: RunToolResultPayload): void => {
  if (!payload.canvasId || !isCurrentCanvas(payload.canvasId)) return

  useRunStore().handleRunChatToolResult({
    runId: payload.runId,
    podId: payload.podId,
    messageId: payload.messageId,
    toolUseId: payload.toolUseId,
    toolName: payload.toolName,
    output: payload.output,
  })
}

// === Export Functions ===

export function getRunEventListeners(): Array<{ event: string; handler: (payload: unknown) => void }> {
  return [
    { event: WebSocketResponseEvents.RUN_CREATED, handler: handleRunCreated as (payload: unknown) => void },
    { event: WebSocketResponseEvents.RUN_STATUS_CHANGED, handler: handleRunStatusChanged as (payload: unknown) => void },
    { event: WebSocketResponseEvents.RUN_POD_STATUS_CHANGED, handler: handleRunPodStatusChanged as (payload: unknown) => void },
    { event: WebSocketResponseEvents.RUN_DELETED, handler: handleRunDeleted as (payload: unknown) => void },
  ]
}

export function getRunStandaloneListeners(): Array<{ event: string; handler: (payload: unknown) => void }> {
  return [
    { event: WebSocketResponseEvents.RUN_MESSAGE, handler: handleRunMessage as (payload: unknown) => void },
    { event: WebSocketResponseEvents.RUN_CHAT_COMPLETE, handler: handleRunChatComplete as (payload: unknown) => void },
    { event: WebSocketResponseEvents.RUN_TOOL_USE, handler: handleRunToolUse as (payload: unknown) => void },
    { event: WebSocketResponseEvents.RUN_TOOL_RESULT, handler: handleRunToolResult as (payload: unknown) => void },
  ]
}
