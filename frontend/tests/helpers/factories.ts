import type { Canvas } from "@/types/canvas";
import type { Pod, Schedule, ModelType, FrequencyType } from "@/types/pod";
import type {
  Connection,
  TriggerMode,
  ConnectionStatus,
  DecideStatus,
  AnchorPosition,
} from "@/types/connection";
import type {
  Message,
  MessageRole,
  ToolUseInfo,
  ToolUseStatus,
} from "@/types/chat";
import type { BaseNote } from "@/types/note";
import type { Repository, RepositoryNote } from "@/types/repository";
import type { Group } from "@/types/group";
import type { WorkflowRun, RunPodInstance } from "@/types/run";
import type {
  IntegrationApp,
  IntegrationBinding,
  IntegrationProviderConfig,
  IntegrationResource,
} from "@/types/integration";
import {
  WebSocketResponseEvents,
  type WebSocketMessage,
  type WorkflowAutoTriggeredPayload,
  type WorkflowBranchPendingPayload,
  type WorkflowDirectTriggeredPayload,
  type WorkflowQueuedPayload,
} from "@/types/websocket";
import { defineComponent, h } from "vue";

// 計數器
let canvasCounter = 0;
let podCounter = 0;
let connectionCounter = 0;
let messageCounter = 0;
let noteCounter = 0;
let scheduleCounter = 0;
let repositoryCounter = 0;
let groupCounter = 0;
let runCounter = 0;
let runPodInstanceCounter = 0;
let workflowEventCounter = 0;
let integrationProviderCounter = 0;
let integrationAppCounter = 0;
let integrationResourceCounter = 0;
let integrationBindingCounter = 0;

/**
 * 重置所有 factory 計數器，確保跨測試檔案不互相污染 ID 值。
 * 通常在 setupStoreTest 的 beforeEach 中呼叫。
 */
export function resetFactoryCounters(): void {
  canvasCounter = 0;
  podCounter = 0;
  connectionCounter = 0;
  messageCounter = 0;
  noteCounter = 0;
  scheduleCounter = 0;
  repositoryCounter = 0;
  groupCounter = 0;
  runCounter = 0;
  runPodInstanceCounter = 0;
  workflowEventCounter = 0;
  integrationProviderCounter = 0;
  integrationAppCounter = 0;
  integrationResourceCounter = 0;
  integrationBindingCounter = 0;
}

/**
 * 建立 Mock Canvas
 */
export function createMockCanvas(overrides?: Partial<Canvas>): Canvas {
  return {
    id: `canvas-${++canvasCounter}`,
    name: `Canvas ${canvasCounter}`,
    sortIndex: canvasCounter,
    isProtected: false,
    ...overrides,
  };
}

/**
 * 建立 Mock Schedule
 */
export function createMockSchedule(overrides?: Partial<Schedule>): Schedule {
  scheduleCounter++;
  return {
    frequency: "every-day" as FrequencyType,
    second: 0,
    intervalMinute: 1,
    intervalHour: 1,
    hour: 9,
    minute: 0,
    weekdays: [1, 2, 3, 4, 5],
    enabled: true,
    lastTriggeredAt: null,
    ...overrides,
  };
}

/** 各 provider 的預設 providerConfig，與後端 capabilities.ts 保持同步 */
const DEFAULT_PROVIDER_CONFIGS: Partial<
  Record<Pod["provider"], Pod["providerConfig"]>
> = {
  claude: { model: "opus" },
  codex: { model: "gpt-5.4" },
  gemini: { model: "gemini-2.5-pro" },
};

/**
 * 建立測試用 Mock Pod，預設 provider 為 "claude"。
 * 傳入不同 provider 時，自動套用對應預設 providerConfig；可透過 overrides.providerConfig 覆蓋。
 */
export function createMockPod(overrides?: Partial<Pod>): Pod {
  const id = `pod-${++podCounter}`;
  const provider = overrides?.provider ?? "claude";
  const defaultProviderConfig = DEFAULT_PROVIDER_CONFIGS[provider] ?? {
    model: "opus",
  };
  return {
    id,
    name: `Pod ${podCounter}`,
    x: 100 * podCounter,
    y: 100 * podCounter,
    rotation: 0,
    memoryEnabled: false,
    repoMemoryEnabled: false,
    hasPodMemory: false,
    hasRepoMemory: false,
    repositoryId: null,
    schedule: null,
    mcpServerNames: [],
    pluginIds: [],
    provider: "claude",
    providerConfig: defaultProviderConfig,
    ...overrides,
  };
}

/**
 * 建立 Mock Connection
 */
export function createMockConnection(
  overrides?: Partial<Connection>,
): Connection {
  return {
    id: `connection-${++connectionCounter}`,
    sourcePodId: `pod-${connectionCounter}`,
    sourceAnchor: "bottom" as AnchorPosition,
    targetPodId: `pod-${connectionCounter + 1}`,
    targetAnchor: "top" as AnchorPosition,
    triggerMode: "auto" as TriggerMode,
    status: "idle" as ConnectionStatus,
    decideStatus: "none" as DecideStatus,
    summaryModel: "sonnet" as ModelType,
    ...overrides,
  };
}

/**
 * 建立 Mock Message
 */
export function createMockMessage(overrides?: Partial<Message>): Message {
  return {
    id: `message-${++messageCounter}`,
    role: "user" as MessageRole,
    content: `Message content ${messageCounter}`,
    isPartial: false,
    timestamp: new Date().toISOString(),
    isSummarized: false,
    ...overrides,
  };
}

/**
 * 建立 Mock Assistant Message (含 toolUse)
 */
export function createMockAssistantMessage(
  overrides?: Partial<Message>,
): Message {
  const toolUse: ToolUseInfo = {
    toolUseId: `tool-${messageCounter + 1}`,
    toolName: "Bash",
    input: { command: 'echo "test"' },
    output: "test",
    status: "completed" as ToolUseStatus,
  };

  return createMockMessage({
    role: "assistant" as MessageRole,
    content: "Assistant response",
    toolUse: [toolUse],
    ...overrides,
  });
}

/**
 * 建立 Mock Note (依類型)
 * TODO Phase 6: canvas paste 重構後補回 mcpServer 型別
 */
export function createMockNote(
  type: "repository" | "mcpServer",
  overrides?: Partial<BaseNote>,
): RepositoryNote | (BaseNote & { mcpServerId: string }) {
  const baseNote: BaseNote = {
    id: `note-${++noteCounter}`,
    name: `Note ${noteCounter}`,
    x: 200 * noteCounter,
    y: 200 * noteCounter,
    boundToPodId: null,
    originalPosition: null,
    ...overrides,
  };

  switch (type) {
    case "repository":
      return {
        ...baseNote,
        repositoryId:
          (overrides as Partial<RepositoryNote> | undefined)?.repositoryId ??
          `repository-${noteCounter}`,
      } as RepositoryNote;

    case "mcpServer":
      // TODO Phase 6: canvas paste 重構後補回 McpServerNote 型別
      return {
        ...baseNote,
        mcpServerId: `mcp-server-${noteCounter}`,
      } as BaseNote & { mcpServerId: string };
  }
}

/**
 * 建立 Mock Repository
 */
export function createMockRepository(
  overrides?: Partial<Repository>,
): Repository {
  const id = `repo-${++repositoryCounter}`;
  return {
    id,
    name: `Repository ${repositoryCounter}`,
    isGit: false,
    repoMemoryEnabled: false,
    hasRepoMemory: false,
    ...overrides,
  };
}

/**
 * 建立 Mock RepositoryNote
 */
export function createMockRepositoryNote(
  overrides?: Partial<RepositoryNote>,
): RepositoryNote {
  return createMockNote("repository", overrides) as RepositoryNote;
}

/**
 * 建立 Mock Group
 */
export function createMockGroup(overrides?: Partial<Group>): Group {
  return {
    id: `group-${++groupCounter}`,
    name: `Group ${groupCounter}`,
    type: "command",
    ...overrides,
  };
}

/**
 * 建立 Mock WorkflowRun
 */
export function createMockWorkflowRun(
  overrides?: Partial<WorkflowRun>,
): WorkflowRun {
  return {
    id: `run-${++runCounter}`,
    canvasId: `canvas-1`,
    sourcePodId: `pod-1`,
    sourcePodName: `Pod 1`,
    triggerMessage: `Trigger message ${runCounter}`,
    status: "running",
    podInstances: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * 建立 Mock RunPodInstance
 */
export function createMockRunPodInstance(
  overrides?: Partial<RunPodInstance>,
): RunPodInstance {
  return {
    id: `rpi-${++runPodInstanceCounter}`,
    runId: `run-1`,
    podId: `pod-1`,
    podName: `Pod 1`,
    status: "pending",
    autoPathwaySettled: "not-applicable",
    directPathwaySettled: "not-applicable",
    ...overrides,
  };
}

export type MockWorkflowEventPayload =
  | WorkflowAutoTriggeredPayload
  | WorkflowBranchPendingPayload
  | WorkflowDirectTriggeredPayload
  | WorkflowQueuedPayload;

/**
 * 建立 Mock workflow WebSocket event。
 */
export function createMockWorkflowEvent<
  TPayload extends MockWorkflowEventPayload = WorkflowAutoTriggeredPayload,
>(options?: {
  type?: WebSocketResponseEvents;
  payload?: Partial<TPayload>;
  requestId?: string;
}): WebSocketMessage<TPayload> {
  const id = ++workflowEventCounter;
  const defaultPayload: WorkflowAutoTriggeredPayload = {
    connectionId: `connection-${id}`,
    sourcePodId: `pod-${id}`,
    targetPodId: `pod-${id + 1}`,
    transferredContent: `Workflow content ${id}`,
    isSummarized: false,
  };

  return {
    type: options?.type ?? WebSocketResponseEvents.WORKFLOW_AUTO_TRIGGERED,
    payload: {
      ...defaultPayload,
      ...(options?.payload ?? {}),
    } as TPayload,
    requestId: options?.requestId ?? `request-${id}`,
  };
}

/**
 * 建立 Mock workflow direct triggered payload。
 */
export function createMockWorkflowDirectTriggeredPayload(
  overrides?: Partial<WorkflowDirectTriggeredPayload>,
): WorkflowDirectTriggeredPayload {
  const id = ++workflowEventCounter;
  return {
    canvasId: `canvas-1`,
    connectionId: `connection-${id}`,
    sourcePodId: `pod-${id}`,
    targetPodId: `pod-${id + 1}`,
    transferredContent: `Direct workflow content ${id}`,
    isSummarized: false,
    ...overrides,
  };
}

/**
 * 建立 Mock workflow queued payload。
 */
export function createMockWorkflowQueuedPayload(
  overrides?: Partial<WorkflowQueuedPayload>,
): WorkflowQueuedPayload {
  const id = ++workflowEventCounter;
  return {
    canvasId: `canvas-1`,
    connectionId: `connection-${id}`,
    sourcePodId: `pod-${id}`,
    targetPodId: `pod-${id + 1}`,
    position: 1,
    queueSize: 1,
    triggerMode: "auto",
    ...overrides,
  };
}

/**
 * 建立 Mock integration resource。
 */
export function createMockIntegrationResource(
  overrides?: Partial<IntegrationResource>,
): IntegrationResource {
  const id = ++integrationResourceCounter;
  return {
    id: `resource-${id}`,
    label: `Resource ${id}`,
    ...overrides,
  };
}

/**
 * 建立 Mock integration app。
 */
export function createMockIntegrationApp(
  overrides?: Partial<IntegrationApp>,
): IntegrationApp {
  const id = ++integrationAppCounter;
  const provider = overrides?.provider ?? "slack";
  return {
    id: `app-${id}`,
    name: `Integration App ${id}`,
    connectionStatus: "connected",
    provider,
    resources: [createMockIntegrationResource()],
    raw: {},
    ...overrides,
  };
}

/**
 * 建立 Mock integration binding。
 */
export function createMockIntegrationBinding(
  overrides?: Partial<IntegrationBinding>,
): IntegrationBinding {
  const id = ++integrationBindingCounter;
  return {
    provider: "slack",
    appId: `app-${id}`,
    resourceId: `resource-${id}`,
    extra: {},
    ...overrides,
  };
}

const MockIntegrationIcon = defineComponent({
  name: "MockIntegrationIcon",
  setup() {
    return () => h("span");
  },
});

/**
 * 建立 Mock integration provider config。
 */
export function createMockIntegrationProviderConfig(
  overrides?: Partial<IntegrationProviderConfig>,
): IntegrationProviderConfig {
  const id = ++integrationProviderCounter;
  const name = overrides?.name ?? `provider-${id}`;

  return {
    name,
    label: `Provider ${id}`,
    icon: MockIntegrationIcon,
    description: `Integration provider ${id}`,
    createFormFields: [],
    resourceLabel: "Resource",
    emptyResourceHint: "No resources",
    emptyAppHint: "No apps",
    connectionStatusConfig: {
      connected: {
        dotClass: "bg-green-500",
        bg: "bg-green-50",
        label: "Connected",
      },
      disconnected: {
        dotClass: "bg-gray-400",
        bg: "bg-gray-50",
        label: "Disconnected",
      },
      error: {
        dotClass: "bg-red-500",
        bg: "bg-red-50",
        label: "Error",
      },
    },
    transformApp: (rawApp) =>
      createMockIntegrationApp({
        provider: name,
        raw: rawApp,
      }),
    getResources: (app) => app.resources,
    buildCreatePayload: (formValues) => ({ ...formValues }),
    buildDeletePayload: (appId) => ({ appId }),
    buildBindPayload: (appId, resourceId, extra) => ({
      appId,
      resourceId,
      extra,
    }),
    ...overrides,
  };
}
