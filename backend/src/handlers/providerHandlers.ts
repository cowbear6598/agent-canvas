import { WebSocketResponseEvents } from "../schemas";
import type {
  ProviderListPayload,
  ProviderListResultPayload,
} from "../schemas";
import {
  providerRegistry,
  getProvider,
  type ProviderName,
} from "../services/provider/index.js";
import {
  CLAUDE_MODEL_THINKING_LEVELS,
  CODEX_MODEL_THINKING_LEVELS,
  GEMINI_MODEL_THINKING_LEVELS,
} from "../services/provider/capabilities.js";
import { socketService } from "../services/socketService.js";

/**
 * 各 provider 對應的 thinking levels 查表。
 * 用 provider name 取對應常數，再以 model.value 查 levels / default。
 */
const THINKING_LEVELS_BY_PROVIDER: Readonly<
  Record<
    ProviderName,
    Readonly<
      Record<string, { levels: readonly string[]; default: string | null }>
    >
  >
> = {
  claude: CLAUDE_MODEL_THINKING_LEVELS,
  codex: CODEX_MODEL_THINKING_LEVELS,
  gemini: GEMINI_MODEL_THINKING_LEVELS,
};

/**
 * 處理 provider:list 請求
 * 回傳所有支援的 Provider 名稱與對應的能力矩陣
 */
export async function handleProviderList(
  connectionId: string,
  payload: ProviderListPayload,
  requestId: string,
): Promise<void> {
  // 從 providerRegistry 建立 providers 列表，每個 provider 附帶 capabilities、defaultOptions 與 availableModels
  const providers = (Object.keys(providerRegistry) as ProviderName[]).map(
    (name) => {
      const { metadata } = getProvider(name);
      // 移除 pathToClaudeCodeExecutable：此為伺服器絕對路徑，不應洩漏給前端
      const { pathToClaudeCodeExecutable: _stripped, ...safeDefaultOptions } =
        metadata.defaultOptions as Record<string, unknown> & {
          pathToClaudeCodeExecutable?: unknown;
        };
      // 為每個 model 補上 thinking metadata；找不到對應常數時 fallback 為空 / null
      const thinkingTable = THINKING_LEVELS_BY_PROVIDER[name];
      const availableModels = metadata.availableModels.map((model) => {
        const entry = thinkingTable[model.value];
        return {
          label: model.label,
          value: model.value,
          thinkingLevels: entry ? [...entry.levels] : [],
          defaultThinkingLevel: entry ? entry.default : null,
        };
      });
      return {
        name,
        capabilities: metadata.capabilities,
        defaultOptions: safeDefaultOptions,
        availableModels,
      };
    },
  );

  const response: ProviderListResultPayload = {
    requestId,
    success: true,
    providers,
  };

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.PROVIDER_LIST_RESULT,
    response,
  );
}
