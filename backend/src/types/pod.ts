import type { ScheduleConfig } from "./schedule.js";
import type { IntegrationBinding } from "./integration.js";
import type { ProviderName } from "../services/provider/types.js";

export type ModelType = "opus" | "sonnet" | "haiku";

export interface Pod {
  id: string;
  name: string;
  workspacePath: string;
  x: number;
  y: number;
  rotation: number;
  sessionId: string | null;
  mcpServerNames: string[];
  pluginIds: string[];
  provider: ProviderName;
  /** providerConfig.model 是 model 的唯一來源（Claude 用短名如 "opus"，Codex 用完整名如 "gpt-5.4"） */
  providerConfig: Record<string, unknown> | null;
  repositoryId: string | null;
  commandId: string | null;
  schedule?: ScheduleConfig;
  integrationBindings?: IntegrationBinding[];
}

/**
 * 對外廣播用的 Pod 公開視圖，排除伺服器側敏感欄位：
 *   - workspacePath：系統絕對路徑，不應洩漏給所有 canvas 連線
 *   - sessionId：Claude 會話 ID，僅後端需要
 * 所有 WebSocket broadcast 路徑應使用此型別，內部處理仍使用 Pod。
 */
export type PodPublicView = Omit<Pod, "workspacePath" | "sessionId">;

/** 將內部 Pod 轉換為對外廣播用的公開視圖（去除敏感欄位） */
export function toPodPublicView(pod: Pod): PodPublicView {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { workspacePath, sessionId, ...publicView } = pod;
  return publicView;
}
