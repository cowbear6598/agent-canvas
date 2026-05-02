import type {
  ContentBlock,
  SystemMessageMetadata,
} from "../../types/message.js";
import type { Pod } from "../../types/pod.js";
import type { RunContext } from "../../types/run.js";
// ProviderName 由 index.ts 的 providerRegistry 推導後 re-export，
// 此處以 import type 反向引用，避免 index.ts ↔ types.ts 產生循環 import 問題。
import type { ProviderName } from "./index.js";
export type { ProviderName };

export type ProviderSystemMessageMetadata = Omit<
  SystemMessageMetadata,
  "provider"
> & {
  provider: ProviderName;
};

export interface ProviderSystemMessage {
  role: "system";
  content: string;
  metadata: ProviderSystemMessageMetadata;
}

/**
 * Provider 自報的 metadata，包含名稱、能力矩陣與預設選項。
 *
 * - `name`：Provider 名稱，對應 providerRegistry 的 key
 * - `capabilities`：功能能力矩陣，前端依此決定顯示哪些設定選項
 * - `defaultOptions`：Provider 的預設執行時選項（執行時型別 TOptions）；
 *   前端可透過 provider:list 取得此值，供新建 Pod 時顯示預設模型等資訊
 *
 * 注意：TOptions 是「執行時型別」，與 Pod.providerConfig（儲存型別 { model: string }）
 * 是兩個獨立概念；抽象隔離發生在執行時層，不影響 DB schema。
 */
export interface ProviderMetadata<TOptions = unknown> {
  name: ProviderName;
  capabilities: ProviderCapabilities;
  defaultOptions: TOptions;
  /**
   * Provider 主動聲告支援的模型清單，作為前後端共通的資料契約。
   * 前端模型選擇器會依此動態渲染選項，新增 provider 時僅需在此宣告即可，
   * 不需要修改前端選擇器的硬編碼。
   */
  availableModels: ReadonlyArray<{ label: string; value: string }>;
  /**
   * 合法 model value 的 Set，從 availableModels 衍生。
   * 供 podStore 以 O(1) Set.has 驗證，避免每次呼叫都 .map().includes()。
   */
  availableModelValues: ReadonlySet<string>;
}

/** Provider 支援的功能能力矩陣 */
export interface ProviderCapabilities {
  /** 是否支援基本聊天 */
  chat: boolean;
  /** 是否支援 Plugin */
  plugin: boolean;
  /** 是否支援 Repository */
  repository: boolean;
  /** 是否支援 Command */
  command: boolean;
  /** 是否支援 MCP */
  mcp: boolean;
}

/** Provider 串流事件的標準化格式（Discriminated Union） */
export type NormalizedEvent =
  | {
      type: "session_started";
      sessionId: string;
    }
  | {
      type: "text";
      content: string;
    }
  | {
      type: "thinking";
      content: string;
    }
  | {
      type: "tool_call_start";
      toolUseId: string;
      toolName: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_call_result";
      toolUseId: string;
      toolName: string;
      output: string;
    }
  | {
      type: "turn_complete";
    }
  | {
      type: "error";
      message: string;
      fatal: boolean;
      /** 結構化錯誤代碼，供未來擴充使用；系統錯誤不帶 code。 */
      code?: string;
      /**
       * Provider 原文錯誤對應的 system message。
       * 後續 phase 會以此取代把 provider error 假裝成 assistant 文字或 Toast。
       */
      systemMessage?: ProviderSystemMessage;
    };

/**
 * 統一建立 Provider 系統錯誤事件（NormalizedEvent error 型別）的 helper。
 *
 * 各 Provider 的 buildXxxSystemError 皆呼叫此函式，避免重複相同的 boilerplate 結構。
 *
 * @param provider - Provider 名稱，填入 metadata.provider
 * @param params   - 錯誤內容、嚴重程度與代碼
 * @returns 符合 NormalizedEvent error discriminant 的物件
 */
export function buildProviderSystemError(
  provider: ProviderName,
  params: {
    content: string;
    fatal: boolean;
    code: string;
    rawContent?: string;
  },
): Extract<NormalizedEvent, { type: "error" }> {
  const { content, fatal, code, rawContent } = params;

  return {
    type: "error",
    message: content,
    fatal,
    code,
    systemMessage: {
      role: "system",
      content,
      metadata: {
        provider,
        code,
        severity: fatal ? "fatal" : "error",
        rawContent: rawContent ?? content,
      },
    },
  };
}

/**
 * Provider chat 呼叫的請求 Context
 *
 * - `options`：執行時型別（由 buildOptions 輸出、僅存在於記憶體中），
 *   每個 provider 的形狀由自身決定（ClaudeOptions / CodexOptions）。
 *
 * session 建立時統一由 provider yield session_started NormalizedEvent 回報，
 * executor 在 for-await loop 內消化並呼叫 strategy.onSessionInit。
 */
export interface ChatRequestContext<TOptions = unknown> {
  podId: string;
  message: string | ContentBlock[];
  workspacePath: string;
  sandboxHomePath?: string;
  resumeSessionId: string | null;
  abortSignal: AbortSignal;
  runContext?: RunContext;
  /**
   * Provider 執行時選項，由 buildOptions(pod, runContext?) 產生。
   * 型別由 provider 決定（TOptions）。
   */
  options?: TOptions;
}

/**
 * Provider 抽象介面，所有 Provider 實作需遵循此合約。
 */
export interface AgentProvider<TOptions = unknown> {
  /**
   * Provider metadata，包含 name、capabilities 與 defaultOptions。
   */
  metadata: ProviderMetadata<TOptions>;
  /**
   * 從 Pod 設定與 RunContext 建構執行時選項（TOptions）。
   * 簽名固定為 async（統一讓調用端不必判斷 union 型別）。
   * runContext 為必傳參數位（可為 undefined），供 buildIntegrationTool 等 closure 使用。
   */
  buildOptions(pod: Pod, runContext?: RunContext): Promise<TOptions>;
  /** 發起聊天，回傳標準化事件的 AsyncIterable */
  chat(ctx: ChatRequestContext<TOptions>): AsyncIterable<NormalizedEvent>;
}
