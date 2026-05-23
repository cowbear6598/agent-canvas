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
} from "../services/provider/capabilities.js";
import { socketService } from "../services/socketService.js";
import { getStmts } from "../database/index.js";
import { parseOpencodeThinkingLevelsJson } from "../services/provider/opencodeThinkingPresetService.js";

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
  // opencode 不支援 thinking levels（由 opencode 後端內部處理 reasoning），保留空表
  opencode: {},
};

/** DB row 形狀（model_aliases 表） */
interface ModelAliasRow {
  id: string;
  provider_id: string;
  real_provider: string;
  real_model: string;
  alias: string;
  order_idx: number;
  thinking_levels_json: string | null;
  default_thinking_level: string | null;
}

/**
 * 組裝整份 provider:list payload（providers 陣列）。
 *
 * - claude / codex：取各自 metadata.availableModels，補 thinking metadata
 * - opencode：從 DB 的 model_aliases 表動態組裝 availableModels
 *
 * 此函式被 handleProviderList 與 broadcastProviderList 共用。
 */
export function buildProviderListPayload(): ProviderListResultPayload["providers"] {
  const stmts = getStmts();

  return (Object.keys(providerRegistry) as ProviderName[]).map((name) => {
    const { metadata } = getProvider(name);
    // 移除 pathToClaudeCodeExecutable：此為伺服器絕對路徑，不應洩漏給前端
    const { pathToClaudeCodeExecutable: _stripped, ...safeDefaultOptions } =
      metadata.defaultOptions as Record<string, unknown> & {
        pathToClaudeCodeExecutable?: unknown;
      };

    let availableModels: Array<{
      label: string;
      value: string;
      thinkingLevels: readonly string[];
      thinkingLevelLabels?: Readonly<Record<string, string>>;
      defaultThinkingLevel: string | null;
    }>;

    if (name === "opencode") {
      // opencode：從 DB 動態取出 alias rows，按 order_idx 升序組成 ModelOption
      const rows = stmts.modelAlias.selectByProviderId.all({
        $providerId: "opencode",
      }) as ModelAliasRow[];

      availableModels = rows.map((r) => {
        const levels = parseOpencodeThinkingLevelsJson(r.thinking_levels_json);
        const labels = Object.fromEntries(
          levels.map((level) => [level.id, level.label]),
        );
        return {
          label: r.alias,
          value: r.real_provider + "/" + r.real_model,
          thinkingLevels: levels.map((level) => level.id),
          ...(levels.length > 0 ? { thinkingLevelLabels: labels } : {}),
          defaultThinkingLevel: r.default_thinking_level,
        };
      });
    } else {
      // claude / codex：沿用 metadata.availableModels，補 thinking metadata
      const thinkingTable = THINKING_LEVELS_BY_PROVIDER[name];
      availableModels = metadata.availableModels.map((model) => {
        const entry = thinkingTable[model.value];
        return {
          label: model.label,
          value: model.value,
          thinkingLevels: entry ? [...entry.levels] : [],
          defaultThinkingLevel: entry ? entry.default : null,
        };
      });
    }

    return {
      name,
      defaultOptions: safeDefaultOptions,
      availableModels,
    };
  });
}

/**
 * 處理 provider:list 請求
 * 回傳所有支援的 Provider 名稱與預設選項
 */
export async function handleProviderList(
  connectionId: string,
  payload: ProviderListPayload,
  requestId: string,
): Promise<void> {
  const providers = buildProviderListPayload();

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
