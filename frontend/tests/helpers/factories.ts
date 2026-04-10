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
import type { OutputStyleNote } from "@/types/outputStyle";
import type { SkillNote } from "@/types/skill";
import type { Repository, RepositoryNote } from "@/types/repository";
import type { SubAgentNote, SubAgent } from "@/types/subAgent";
import type { CommandNote } from "@/types/command";
import type { McpServerNote } from "@/types/mcpServer";
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
let subAgentCounter = 0;
let groupCounter = 0;
let runCounter = 0;
let runPodInstanceCounter = 0;

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

/**
 * 建立 Mock Pod
 */
export function createMockPod(overrides?: Partial<Pod>): Pod {
  const id = `pod-${++podCounter}`;
  return {
    id,
    name: `Pod ${podCounter}`,
    x: 100 * podCounter,
    y: 100 * podCounter,
    output: [],
    rotation: 0,
    status: "idle" as PodStatus,
    model: "opus" as ModelType,
    outputStyleId: null,
    skillIds: [],
    subAgentIds: [],
    repositoryId: null,
    multiInstance: false,
    commandId: null,
    schedule: null,
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
 */
export function createMockNote(
  type:
    | "outputStyle"
    | "skill"
    | "repository"
    | "subAgent"
    | "command"
    | "mcpServer",
  overrides?: Partial<BaseNote>,
):
  | OutputStyleNote
  | SkillNote
  | RepositoryNote
  | SubAgentNote
  | CommandNote
  | McpServerNote {
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
    case "outputStyle":
      return {
        ...baseNote,
        outputStyleId: `output-style-${noteCounter}`,
      } as OutputStyleNote;

    case "skill":
      return {
        ...baseNote,
        skillId: `skill-${noteCounter}`,
      } as SkillNote;

    case "repository":
      return {
        ...baseNote,
        repositoryId: `repository-${noteCounter}`,
      } as RepositoryNote;

    case "subAgent":
      return {
        ...baseNote,
        subAgentId: `sub-agent-${noteCounter}`,
      } as SubAgentNote;

    case "command":
      return {
        ...baseNote,
        commandId: `command-${noteCounter}`,
      } as CommandNote;

    case "mcpServer":
      return {
        ...baseNote,
        mcpServerId: `mcp-server-${noteCounter}`,
      } as McpServerNote;
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
 * 建立 Mock SubAgent
 */
export function createMockSubAgent(overrides?: Partial<SubAgent>): SubAgent {
  return {
    id: `subagent-${++subAgentCounter}`,
    name: `SubAgent ${subAgentCounter}`,
    description: `Description for SubAgent ${subAgentCounter}`,
    groupId: null,
    ...overrides,
  };
}

/**
 * 建立 Mock SubAgentNote
 */
export function createMockSubAgentNote(
  overrides?: Partial<SubAgentNote>,
): SubAgentNote {
  return createMockNote("subAgent", overrides) as SubAgentNote;
}

/**
 * 建立 Mock Group
 */
export function createMockGroup(overrides?: Partial<Group>): Group {
  return {
    id: `group-${++groupCounter}`,
    name: `Group ${groupCounter}`,
    type: "subAgent",
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
