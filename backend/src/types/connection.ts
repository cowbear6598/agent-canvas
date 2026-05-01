import type { ProviderName } from "../services/provider/index.js";

export type AnchorPosition = "top" | "bottom" | "left" | "right";

export type TriggerMode = "auto" | "ai-decide" | "direct";

export type AutoTriggerMode = Extract<TriggerMode, "auto" | "ai-decide">;

export type DecideStatus =
  | "none"
  | "pending"
  | "approved"
  | "rejected"
  | "error";

export type ConnectionStatus =
  | "idle"
  | "active"
  | "queued"
  | "waiting"
  | "ai-deciding"
  | "ai-approved"
  | "ai-rejected"
  | "ai-error";

/** aiDecideModel 硬性鎖定 Claude 三選一（不接受第三方模型） */
export type AiDecideModelType = "opus" | "sonnet" | "haiku";

/** aiDecideModel 預設值，避免字面值 "sonnet" 散落各處 */
export const DEFAULT_AI_DECIDE_MODEL: AiDecideModelType = "sonnet";

export interface Connection {
  id: string;
  sourcePodId: string;
  sourceAnchor: AnchorPosition;
  targetPodId: string;
  targetAnchor: AnchorPosition;
  triggerMode: TriggerMode;
  decideStatus: DecideStatus;
  decideReason: string | null;
  connectionStatus: ConnectionStatus;
  /** summaryModel 接受任意模型名稱（如 "sonnet"、"gpt-5.4"），由 service 層驗證 capability */
  summaryModel: string;
  /**
   * summaryProvider 指定本 Connection 摘要時使用的 provider。
   * null 代表舊資料（升級前）：runtime 會 fallback 至 sourcePod.provider。
   */
  summaryProvider: ProviderName | null;
  /** aiDecideModel 僅允許 Claude 三選一 */
  aiDecideModel: AiDecideModelType;
}
