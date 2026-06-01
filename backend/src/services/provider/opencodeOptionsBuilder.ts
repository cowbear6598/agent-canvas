import type { Pod } from "../../types/pod.js";
import type { RunContext } from "../../types/run.js";
import type { ContentBlock } from "../../types/message.js";
import {
  managedMcpSurfaceService,
  type PodMcpEntry,
} from "../mcp/managedMcpSurfaceService.js";
import { formatPluginSkillCatalogPrompt } from "../plugin/pluginCatalogBuilder.js";
import { getStmts } from "../../database/index.js";
import { parseOpencodeThinkingLevelsJson } from "./opencodeThinkingPresetService.js";
import { buildOpencodePromptText } from "./opencodePromptHelpers.js";
import type { OpencodeV2PromptInput } from "./opencodeClientPort.js";

/**
 * opencode provider 的執行時選項（執行時型別，由 buildOptions 輸出）。
 * 與 Pod.providerConfig（儲存型別 { model: string }）是兩個獨立概念。
 */
export interface OpencodeOptions {
  /** opencode 的 provider ID（如 "anthropic"、"openai"） */
  providerID: string;
  /** opencode 的 model ID（如 "claude-sonnet-4-5"） */
  modelID: string;
  /**
   * 要注入給 opencode transient server 的 managed MCP entries（含 Goal Runtime；run / chat 統一）。
   * 每筆轉成 opencode `config.mcp[name]` 形狀（stdio 用 type=local、http/sse 用 type=remote）。
   * 為空時不啟動 transient server，沿用全域 opencode server。
   */
  mcpEntries: PodMcpEntry[];
  /** Goal Runtime 是否在 mcpEntries 內，用於決定是否注入 bootstrap prompt */
  hasGoalRuntime: boolean;
  /**
   * Plugin Skill Catalog 文字段落（已預先 format）。
   * 空字串代表本 Pod 無啟用 plugin 或掃不出任何 SKILL.md。
   * Fresh session 首輪會與 Goal Runtime bootstrap 一起注入 user prompt。
   */
  pluginCatalogText: string;
  /** 一次性查詢使用的 system prompt；一般 Pod 對話不設定。 */
  systemPrompt?: string;
  /** Pod 目前選到的 OpenCode thinking preset id。 */
  thinkingLevel?: string;
  /** 從 alias 建立時保存的官方 metadata snapshot 正規化出的 OpenCode prompt options。 */
  thinkingOptions?: Record<string, unknown>;
}

function splitModelValue(rawModel: string): {
  providerID: string;
  modelID: string;
} {
  const slashIndex = rawModel.indexOf("/");
  if (slashIndex === -1) {
    return { providerID: rawModel, modelID: "" };
  }

  return {
    providerID: rawModel.slice(0, slashIndex),
    modelID: rawModel.slice(slashIndex + 1),
  };
}

function getOpencodeThinkingOptions(
  modelValue: string,
  thinkingLevel?: string,
): Record<string, unknown> | undefined {
  if (!thinkingLevel) return undefined;
  const { providerID, modelID } = splitModelValue(modelValue);
  if (!providerID || !modelID) return undefined;

  const row = getStmts().modelAlias.selectByRealProviderAndModel.get({
    $providerId: "opencode",
    $realProvider: providerID,
    $realModel: modelID,
  }) as
    | {
        thinking_levels_json: string | null;
      }
    | undefined;
  const preset = parseOpencodeThinkingLevelsJson(
    row?.thinking_levels_json,
  ).find((level) => level.id === thinkingLevel);
  return preset?.options;
}

export async function buildOpencodeOptions(
  pod: Pod,
  runContext?: RunContext,
): Promise<OpencodeOptions> {
  const rawModel =
    typeof pod.providerConfig?.model === "string"
      ? (pod.providerConfig.model as string)
      : "";
  const { providerID, modelID } = splitModelValue(rawModel);
  const thinkingLevel =
    typeof pod.providerConfig?.thinkingLevel === "string"
      ? pod.providerConfig.thinkingLevel
      : undefined;
  const { entries, hasGoalRuntime, pluginCatalog } =
    await managedMcpSurfaceService.buildPodMcpEntries(
      pod,
      runContext ?? null,
    );

  return {
    providerID,
    modelID,
    mcpEntries: entries,
    hasGoalRuntime,
    pluginCatalogText: formatPluginSkillCatalogPrompt(pluginCatalog),
    thinkingLevel,
    thinkingOptions: getOpencodeThinkingOptions(rawModel, thinkingLevel),
  };
}

export function buildOpencodePromptInput(options: {
  message: string | ContentBlock[];
  providerOptions: OpencodeOptions;
  hiddenBootstrapSections?: string[];
  resumeSessionId: string | null | undefined;
}): OpencodeV2PromptInput {
  const {
    message,
    providerOptions,
    hiddenBootstrapSections,
    resumeSessionId,
  } = options;
  const promptInput: OpencodeV2PromptInput = {
    parts: [
      {
        type: "text",
        text: buildOpencodePromptText(
          message,
          Boolean(providerOptions.hasGoalRuntime),
          providerOptions.pluginCatalogText ?? "",
          hiddenBootstrapSections,
          resumeSessionId,
        ),
      },
    ],
  };

  if (providerOptions.providerID || providerOptions.modelID) {
    promptInput.model = {
      providerID: providerOptions.providerID,
      modelID: providerOptions.modelID,
    };
  }

  if (
    providerOptions.systemPrompt &&
    providerOptions.systemPrompt.trim().length > 0
  ) {
    promptInput.system = providerOptions.systemPrompt;
  }

  if (typeof providerOptions.thinkingOptions?.variant === "string") {
    promptInput.variant = providerOptions.thinkingOptions.variant;
  }

  return promptInput;
}
