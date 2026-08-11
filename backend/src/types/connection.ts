import type { ProviderName } from "../services/provider/index.js";

export type AnchorPosition = "top" | "bottom" | "left" | "right";

export type ConnectionBaseTriggerMode = "auto" | "branch";
export type TriggerMode = "auto" | "branch" | "direct";

export type AutoTriggerMode = ConnectionBaseTriggerMode;

export type DecideStatus =
  | "none"
  | "pending"
  | "approved"
  | "rejected"
  | "error";

export type ConnectionStatus = "idle" | "active" | "queued" | "waiting";

export interface Connection {
  id: string;
  sourcePodId: string;
  sourceAnchor: AnchorPosition;
  targetPodId: string;
  targetAnchor: AnchorPosition;
  /**
   * 對外 connection 契約僅保留 auto / branch 基底模式。
   * legacy "direct" 會在 schema / repository 層正規化為 directEnabled。
   */
  triggerMode: ConnectionBaseTriggerMode;
  /** direct 代表 no-wait pathway toggle，非第三種 connection 類別 */
  direct: boolean;
  decideStatus: DecideStatus;
  decideReason: string | null;
  connectionStatus: ConnectionStatus;
  /** summaryModel 接受任意模型名稱（如 "sonnet"、"gpt-5.6-luna"），由 service 層驗證 capability */
  summaryModel: string;
  /**
   * summaryProvider 指定本 Connection 摘要時使用的 provider。
   * null 代表舊資料（升級前）：runtime 會 fallback 至 sourcePod.provider。
   */
  summaryProvider: ProviderName | null;
  /** Summary 生成時使用的 thinking level；null 代表交由 provider 預設 */
  summaryThinkingLevel: string | null;
  /**
   * label 為 Branch 模式下的連線名稱，不可為 "None"（大小寫不敏感）。
   * 同一 sourcePod 內的所有連線 label 必須唯一（由 service 層驗證）。
   */
  label: string;
  /** description 為 Branch 模式下的連線描述，選填 */
  description?: string;
  /** branchProvider 指定 branch 決策時使用的 provider */
  branchProvider: ProviderName;
  /** branchModel 指定 branch 決策時使用的模型名稱 */
  branchModel: string;
  /** Branch 決策時使用的 thinking level；null 代表交由 provider 預設 */
  branchThinkingLevel: string | null;
}

export type ConnectionPublic = Omit<
  Connection,
  "branchProvider" | "branchModel" | "branchThinkingLevel"
>;

export function toConnectionPublic(connection: Connection): ConnectionPublic {
  const {
    branchProvider: _branchProvider,
    branchModel: _branchModel,
    branchThinkingLevel: _branchThinkingLevel,
    ...publicConnection
  } = connection;

  return publicConnection;
}
