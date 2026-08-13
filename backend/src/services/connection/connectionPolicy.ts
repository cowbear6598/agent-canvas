import {
  assertModelSupportedByProvider,
  getProvider,
  type ProviderName,
} from "../provider/index.js";
import {
  getDefaultThinkingLevel,
  isThinkingLevelValid,
} from "../pod/providerConfigResolver.js";
import type { Connection, Pod } from "../../types/index.js";

export function validateProviderModel(
  provider: ProviderName,
  model: string,
  fieldName: "summaryModel" | "branchModel",
): void {
  try {
    assertModelSupportedByProvider(provider, model);
  } catch {
    throw new Error(`${fieldName} 不支援 provider ${provider}`);
  }
}

export function resolveProviderDefaultModel(
  provider: ProviderName,
): string | undefined {
  const defaultModel = (
    getProvider(provider).metadata.defaultOptions as {
      model?: unknown;
    }
  ).model;
  return typeof defaultModel === "string" && defaultModel.trim()
    ? defaultModel
    : undefined;
}

export function resolveSourceThinkingLevel(sourcePod?: Pod | null): string | null {
  const thinkingLevel = sourcePod?.providerConfig?.thinkingLevel;
  return typeof thinkingLevel === "string" && thinkingLevel.trim().length > 0
    ? thinkingLevel
    : null;
}

export function resolveConnectionThinkingLevel(
  sourcePod: Pod | undefined,
  provider: ProviderName,
  model: string | null,
): string | null {
  return (
    resolveSourceThinkingLevel(sourcePod) ??
    (model ? getDefaultThinkingLevel(provider, model) : null)
  );
}

export function resolveBranchThinkingModel(
  sourcePod: Pod | undefined,
  provider: ProviderName,
  model: string | null,
): string | null {
  if (model !== null) return model;

  const sourceModel =
    typeof sourcePod?.providerConfig?.model === "string" &&
    sourcePod.providerConfig.model.trim().length > 0
      ? sourcePod.providerConfig.model
      : undefined;
  if (provider === "opencode" && sourceModel) return sourceModel;

  return (
    resolveProviderDefaultModel(provider) ??
    resolveProviderDefaultModel("claude") ??
    null
  );
}

export function validateConnectionThinkingLevel(
  provider: ProviderName,
  model: string | null,
  level: string | null,
  fieldName: "summaryThinkingLevel" | "branchThinkingLevel",
): void {
  if (level === null) return;
  if (model === null || !isThinkingLevelValid(provider, model, level)) {
    throw new Error(`${fieldName} 不支援指定的 provider/model`);
  }
}

export function validateBranchLabel(
  label: string,
  siblings: Connection[],
  excludeConnectionId?: string,
): void {
  const trimmedLabel = label.trim();
  if (!trimmedLabel) {
    throw new Error("label 必填");
  }
  if (trimmedLabel.toLowerCase() === "none") {
    throw new Error("label 不可為保留字 None");
  }

  const isDuplicate = siblings.some(
    (conn) =>
      conn.id !== excludeConnectionId &&
      conn.triggerMode === "branch" &&
      conn.label.toLowerCase() === trimmedLabel.toLowerCase(),
  );
  if (isDuplicate) {
    throw new Error("label 已存在於同一組 branch");
  }
}
