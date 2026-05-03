import type { Component } from "vue";
import type { IntegrationBinding } from "./integration";

export type ModelType = "opus" | "sonnet" | "haiku";

export type PodStatus =
  | "idle"
  | "chatting"
  | "summarizing"
  | "error"
  | "uploading";

/**
 * Pod 所屬的 Provider 名稱。
 * 刻意保持寬鬆 string，不使用 "claude" | "codex" literal union，原因如下：
 *   1. 後端 providerCapabilityStore 動態建構 ALLOWED_PROVIDERS；
 *      若前端 compile-time 釘死 union，每次後端新增 provider 時
 *      兩端的 union 容易不同步，導致型別錯誤或靜默地拒絕合法值。
 *   2. 前端執行時驗證（透過 providerCapabilityStore 的 key 集合）
 *      即可有效過濾無效 provider，無需 compile-time 限制。
 * compile-time 的型別縮窄由 providerOptions.ts 的 narrow helper
 *   （getClaudeOptions / getCodexOptions）在需要的地方達成。
 *
 * 鏡射自後端 backend/src/services/provider/types.ts（ProviderName）；
 * 修改時請同步。
 */
export type PodProvider = string;

/**
 * Provider 通用設定，資料形狀維持平坦 { model, thinkingLevel? }。
 * 不因 discriminated union 拆分，避免 DB 遷移與全專案 access path 改動。
 * Provider-specific 型別請見 ClaudeOptions / CodexOptions，
 * 並透過 providerOptions.ts 的 narrow helper 取得強型別。
 *
 * `thinkingLevel` 為當前 model 的 reasoning level，model 切換時必須由後端
 * 清空再重新填入；不支援 thinking 的 model（Haiku、Gemini 全系列）此欄位
 * 為 undefined。
 *
 * 鏡射自後端 backend/src/services/provider/types.ts（ChatRequestContext.providerConfig）；
 * 修改時請同步。
 */
export type ProviderConfig = { model: string; thinkingLevel?: string };

/**
 * Claude Provider 的執行選項型別。
 * 鏡射自後端 backend/src/services/provider/claudeProvider.ts（ClaudeOptions）；
 * 含 model 與 thinkingLevel（Haiku 不支援，故為 optional）。
 * 修改後端 ClaudeOptions 時請同步更新此型別。
 */
export interface ClaudeOptions {
  model: string;
  thinkingLevel?: string;
}

/**
 * Codex Provider 的執行選項型別。
 * 鏡射自後端 backend/src/services/provider/codexProvider.ts（CodexOptions）；
 * 含 model 與 thinkingLevel（Codex 全系列支援 Low/Medium/High/xHigh）。
 * 修改後端 CodexOptions 時請同步更新此型別。
 */
export interface CodexOptions {
  model: string;
  thinkingLevel?: string;
}

/**
 * Provider 可選模型選項的共用型別。
 * label 為 UI 顯示名稱，value 為實際傳給後端 providerConfig.model 的字串。
 * 鏡射自後端 `provider:list` payload 中 `availableModels` 欄位的元素結構，
 * 前後端共用此資料契約。
 *
 * `thinkingLevels` 與 `defaultThinkingLevel` 鏡射自後端 provider:list payload
 * 中 `availableModels` 元素新增的 thinking 相關欄位；不支援 thinking 的 model
 * （Haiku、Gemini 全系列）不會帶入此兩欄位。
 */
export interface ModelOption {
  label: string;
  value: string;
  thinkingLevels?: ReadonlyArray<string>;
  defaultThinkingLevel?: string;
}

/** 各 Provider 支援的功能能力表 */
export interface ProviderCapabilities {
  chat: boolean;
  plugin: boolean;
  repository: boolean;
  command: boolean;
  mcp: boolean;
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
  mcpServerNames?: string[];
  pluginIds?: string[];
  repositoryId?: string | null;
  multiInstance: boolean;
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
