import { z } from "zod";
import type {
  ProviderCapabilities,
  ProviderName,
} from "../services/provider/types.js";

/** provider:list 請求 payload schema */
export const providerListSchema = z.object({
  requestId: z.string(),
});

export type ProviderListPayload = z.infer<typeof providerListSchema>;

/** provider:list:result 回應 payload */
export interface ProviderListResultPayload {
  requestId: string;
  success: boolean;
  providers: Array<{
    name: ProviderName;
    capabilities: ProviderCapabilities;
    /** Provider 預設執行時選項，各 provider 形狀不同，前端各自解析 */
    defaultOptions: Record<string, unknown>;
    /**
     * Provider 聲告支援的模型清單，前端模型選擇器依此動態渲染選項。
     * 每個元素帶 label / value 與 thinking metadata；
     * thinkingLevels 為空陣列、defaultThinkingLevel 為 null 表示該 model 不支援 thinking。
     */
    availableModels: ReadonlyArray<{
      label: string;
      value: string;
      thinkingLevels: readonly string[];
      defaultThinkingLevel: string | null;
    }>;
  }>;
}
