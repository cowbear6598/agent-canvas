/**
 * 單一 opencode provider 的模型資訊
 */
export interface OpencodeModelInfo {
  id: string;
  name: string;
}

/**
 * 單一 opencode provider 的基本資訊
 */
export interface OpencodeProviderInfo {
  id: string;
  name: string;
  models: OpencodeModelInfo[];
}

/**
 * GET /provider 回傳結果：
 * - all：所有支援的 provider
 * - default：各 provider 對應的預設 model id
 * - connected：已登入（可用）的 provider id 清單
 */
export interface OpencodeProviderListResult {
  all: OpencodeProviderInfo[];
  default: Record<string, string>;
  connected: string[];
}

/**
 * model 別稱對應表條目：
 * - id：唯一識別碼
 * - providerID：所屬 provider id
 * - modelID：原始 model id
 * - alias：使用者自訂別稱
 * - orderIdx：排序索引（數值越小越前，與後端 order_idx 欄位一致）
 * - thinkingLevels：OpenCode 官方 thinking presets id 清單
 * - thinkingLevelLabels：thinking preset id 對應顯示名稱
 * - defaultThinkingLevel：預設 thinking preset id；null 代表不支援
 * - thinkingMetadataFetchedAt：metadata 快照取得時間
 */
export interface OpencodeModelAlias {
  id: string;
  providerID: string;
  modelID: string;
  alias: string;
  orderIdx: number;
  thinkingLevels?: string[];
  thinkingLevelLabels?: Record<string, string>;
  defaultThinkingLevel?: string | null;
  thinkingMetadataFetchedAt?: number | null;
}
