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
  }>;
}
