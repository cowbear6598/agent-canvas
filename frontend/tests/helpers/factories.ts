import type { Canvas } from "@/types/canvas";
import type {
  Pod,
  Schedule,
  ModelType,
  PodStatus,
  FrequencyType,
} from "@/types/pod";
import type {
  Connection,
  TriggerMode,
  ConnectionStatus,
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
import type { CommandNote } from "@/types/command";
import type { Group } from "@/types/group";
import type { WorkflowRun, RunPodInstance } from "@/types/run";

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
}

/**
 * 建立 Mock Canvas
 */
export function createMockCanvas(overrides?: Partial<Canvas>): Canvas {
  return {
    id: `canvas-${++canvasCounter}`,
    name: `Canvas ${canvasCounter}`,
    sortIndex: canvasCounter,
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
    output: [],
    rotation: 0,
    status: "idle" as PodStatus,
    repositoryId: null,
    multiInstance: false,
    commandId: null,
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
    summaryModel: "sonnet" as ModelType,
    aiDecideModel: "sonnet" as ModelType,
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
  type: "repository" | "command" | "mcpServer",
  overrides?: Partial<BaseNote>,
): RepositoryNote | CommandNote | (BaseNote & { mcpServerId: string }) {
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
        repositoryId: `repository-${noteCounter}`,
      } as RepositoryNote;

    case "command":
      return {
        ...baseNote,
        commandId: `command-${noteCounter}`,
      } as CommandNote;

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
