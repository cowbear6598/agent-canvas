import type { Pod, PodProvider, ProviderConfig } from "@/types";
import { validatePodName } from "@/lib/sanitize";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";

function hasValidIdentity(pod: Pod): boolean {
  return validatePodName(pod.name) && pod.id.trim() !== "";
}

function hasValidPosition(pod: Pod): boolean {
  return isFinite(pod.x) && isFinite(pod.y) && isFinite(pod.rotation);
}

function hasValidOutput(pod: Pod): boolean {
  return (
    Array.isArray(pod.output) &&
    pod.output.every((item) => typeof item === "string")
  );
}

export function isValidPod(pod: Pod): boolean {
  return hasValidIdentity(pod) && hasValidPosition(pod) && hasValidOutput(pod);
}

function pickOutputArray(
  preservedOutput: string[] | undefined,
  podOutput: string[] | undefined,
): string[] {
  if (Array.isArray(preservedOutput)) return preservedOutput;
  if (Array.isArray(podOutput)) return podOutput;
  return [];
}

/**
 * 依據 provider 決定預設的 providerConfig。
 * 優先回傳 existing（已有值時不覆蓋）；
 * 否則從 providerCapabilityStore.getDefaultOptions(provider) 取預設。
 * 若 store 尚未載入（回 undefined）或後端尚未送 defaultOptions（回 {}），
 * 回傳 placeholder { model: "" } 並發出 warn。
 */
function resolveProviderConfig(
  provider: PodProvider,
  existing: ProviderConfig | undefined,
): ProviderConfig {
  if (existing) return existing;

  const store = useProviderCapabilityStore();
  const defaultOptions = store.getDefaultOptions(provider);

  // undefined：未知 provider 或 metadata 尚未從後端載入
  // {}：已知 provider 但後端尚未送 defaultOptions（Phase 6 前的狀態）
  if (
    defaultOptions === undefined ||
    !("model" in defaultOptions) ||
    typeof defaultOptions.model !== "string" ||
    defaultOptions.model === ""
  ) {
    console.warn(
      `[podValidation] 未知 provider 或 provider metadata 尚未載入，使用空 model placeholder（provider: ${provider}）`,
    );
    return { model: "" };
  }

  return { model: defaultOptions.model as string };
}

/**
 * 驗證 provider 的 model 名稱是否合法。
 * 規則：長度 1-100、只允許英數字、點、底線、連字號，與後端 MODEL_RE 對齊。
 */
export function isValidModelName(model: string): boolean {
  if (typeof model !== "string" || model.length < 1 || model.length > 100)
    return false;
  return /^[a-zA-Z0-9._-]+$/.test(model);
}

/**
 * 補全 Pod 缺少的欄位
 * @param pod Pod 物件
 * @param preservedOutput 現有的 output（用於保留）
 * @returns 補全後的 Pod
 */
export function enrichPod(pod: Pod, preservedOutput?: string[]): Pod {
  // 缺 provider 時視為舊有的 Claude Pod
  const provider: PodProvider = pod.provider ?? "claude";

  return {
    ...pod,
    x: pod.x ?? 100,
    y: pod.y ?? 150,
    rotation: pod.rotation ?? Math.random() * 2 - 1,
    output: pickOutputArray(preservedOutput, pod.output),
    outputStyleId: pod.outputStyleId ?? null,
    multiInstance: pod.multiInstance ?? false,
    commandId: pod.commandId ?? null,
    schedule: pod.schedule ?? null,
    pluginIds: pod.pluginIds ?? [],
    provider,
    providerConfig: resolveProviderConfig(provider, pod.providerConfig),
  };
}
