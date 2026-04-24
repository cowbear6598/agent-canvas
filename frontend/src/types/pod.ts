import type { Component } from "vue";
import type { IntegrationBinding } from "./integration";

export type ModelType = "opus" | "sonnet" | "haiku";

export type PodStatus = "idle" | "chatting" | "summarizing" | "error";

/**
 * Pod 所屬的 Provider 名稱。
 * 改為寬鬆字串，執行時以 providerCapabilityStore 的 key 集合為真值來源。
 * 舊版 "claude" | "codex" literal union 已移除，compile-time 限縮改由
 * providerOptions.ts 的 narrow helper（getClaudeOptions / getCodexOptions）達成。
 *
 * 鏡射自後端 backend/src/services/provider/types.ts（ProviderName）；
 * 修改時請同步。
 */
export type PodProvider = string;

/**
 * Provider 通用設定，資料形狀維持平坦 { model: string }。
 * 不因 discriminated union 拆分，避免 DB 遷移與全專案 access path 改動。
 * Provider-specific 型別請見 ClaudeOptions / CodexOptions，
 * 並透過 providerOptions.ts 的 narrow helper 取得強型別。
 *
 * 鏡射自後端 backend/src/services/provider/types.ts（ChatRequestContext.providerConfig）；
 * 修改時請同步。
 */
export type ProviderConfig = { model: string };

/**
 * Claude Provider 的執行選項型別。
 * 鏡射自後端 backend/src/services/provider/claudeProvider.ts（ClaudeOptions）；
 * 目前僅含 model，未來可擴充 outputStyleId 等欄位。
 * 修改後端 ClaudeOptions 時請同步更新此型別。
 */
export interface ClaudeOptions {
  model: string;
}

/**
 * Codex Provider 的執行選項型別。
 * 鏡射自後端 backend/src/services/provider/codexProvider.ts（CodexOptions）；
 * 目前僅含 model，未來可擴充欄位。
 * 修改後端 CodexOptions 時請同步更新此型別。
 */
export interface CodexOptions {
  model: string;
}

/**
 * Provider 可選模型選項的共用型別。
 * label 為 UI 顯示名稱，value 為實際傳給後端 providerConfig.model 的字串。
 * 鏡射自後端 `provider:list` payload 中 `availableModels` 欄位的元素結構，
 * 前後端共用此資料契約。
 */
export interface ModelOption {
  label: string;
  value: string;
}

/** 各 Provider 支援的功能能力表 */
export interface ProviderCapabilities {
  chat: boolean;
  outputStyle: boolean;
  skill: boolean;
  subAgent: boolean;
  repository: boolean;
  command: boolean;
  mcp: boolean;
  integration: boolean;
  runMode: boolean;
}

export type FrequencyType =
  | "every-second"
  | "every-x-minute"
  | "every-x-hour"
  | "every-day"
  | "every-week";

export interface Schedule {
  frequency: FrequencyType;
  second: number;
  intervalMinute: number;
  intervalHour: number;
  hour: number;
  minute: number;
  weekdays: number[];
  enabled: boolean;
  lastTriggeredAt: string | null;
}

export interface Pod {
  id: string;
  name: string;
  x: number;
  y: number;
  /** 僅存在於前端狀態，由 chatMessageActions 動態建構，後端不持久化此欄位 */
  output: string[];
  rotation: number;
  status?: PodStatus;
  workspacePath?: string;
  outputStyleId?: string | null;
  skillIds?: string[];
  subAgentIds?: string[];
  mcpServerIds?: string[];
  pluginIds?: string[];
  repositoryId?: string | null;
  multiInstance?: boolean;
  commandId?: string | null;
  schedule?: Schedule | null;
  integrationBindings?: IntegrationBinding[];
  provider: PodProvider;
  providerConfig: ProviderConfig;
}

export interface PodTypeConfig {
  icon: Component;
}

export interface Position {
  x: number;
  y: number;
}

export interface TypeMenuState {
  visible: boolean;
  position: Position | null;
}
