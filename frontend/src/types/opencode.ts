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
 * - default：預設 provider id
 * - connected：已登入（可用）的 provider id 清單
 */
export interface OpencodeProviderListResult {
  all: OpencodeProviderInfo[];
  default: string;
  connected: string[];
}

/**
 * model 別稱對應表條目：
 * - id：唯一識別碼
 * - providerID：所屬 provider id
 * - modelID：原始 model id
 * - alias：使用者自訂別稱
 * - sortOrder：排序權重（數值越小越前）
 */
export interface OpencodeModelAlias {
  id: string;
  providerID: string;
  modelID: string;
  alias: string;
  sortOrder: number;
}
