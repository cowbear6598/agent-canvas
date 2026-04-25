import type { ScheduleConfig } from "./schedule.js";
import type { IntegrationBinding } from "./integration.js";
import type { ProviderName } from "../services/provider/types.js";

export type PodStatus = "idle" | "chatting" | "summarizing" | "error";

export function isPodBusy(
  status: PodStatus,
): status is "chatting" | "summarizing" {
  return status === "chatting" || status === "summarizing";
}

export type ModelType = "opus" | "sonnet" | "haiku";

export interface Pod {
  id: string;
  name: string;
  status: PodStatus;
  workspacePath: string;
  x: number;
  y: number;
  rotation: number;
  sessionId: string | null;
  subAgentIds: string[];
  mcpServerIds: string[];
  pluginIds: string[];
  provider: ProviderName;
  /** providerConfig.model 是 model 的唯一來源（Claude 用短名如 "opus"，Codex 用完整名如 "gpt-5.4"） */
  providerConfig: Record<string, unknown> | null;
  repositoryId: string | null;
  commandId: string | null;
  multiInstance: boolean;
  schedule?: ScheduleConfig;
  integrationBindings?: IntegrationBinding[];
}
