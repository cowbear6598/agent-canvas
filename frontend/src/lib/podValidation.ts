import type { Pod, PodProvider, ProviderConfig, PodGoal } from "@/types";
import { validatePodName } from "@/lib/sanitize";
import { resolvePodProvider } from "@/lib/providerOptions";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";

function hasValidIdentity(pod: Pod): boolean {
  return validatePodName(pod.name) && pod.id.trim() !== "";
}

function hasValidPosition(pod: Pod): boolean {
  return isFinite(pod.x) && isFinite(pod.y) && isFinite(pod.rotation);
}

export function isValidPod(pod: Pod): boolean {
  return hasValidIdentity(pod) && hasValidPosition(pod);
}

function normalizeGoal(goal: PodGoal | null | undefined): PodGoal | null {
  if (!goal || !Array.isArray(goal.todos)) return null;

  const todos = goal.todos
    .map((todo) => ({
      id: String(todo.id ?? "").trim(),
      text: String(todo.text ?? "").trim(),
    }))
    .filter((todo) => todo.id.length > 0 && todo.text.length > 0);

  return todos.length > 0 ? { todos } : null;
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
 * 規則：長度 1-100、只允許英數字、點、底線、連字號、斜線，與後端 podSchemas.MODEL_PATTERN 對齊。
 * 斜線為支援 opencode 的 "{providerID}/{modelID}" 格式（例：opencode/minimax-m2.5-free）。
 */
export function isValidModelName(model: string): boolean {
  if (typeof model !== "string" || model.length < 1 || model.length > 100)
    return false;
  return /^[a-zA-Z0-9._/-]+$/.test(model);
}

/**
 * 補全 Pod 缺少的欄位
 */
export function enrichPod(pod: Pod): Pod {
  // 缺 provider 或 legacy Gemini 時一律收斂成目前仍支援的 provider。
  const provider: PodProvider = resolvePodProvider(pod);
  const goal = normalizeGoal(pod.goal);

  return {
    ...pod,
    x: pod.x ?? 100,
    y: pod.y ?? 150,
    rotation: pod.rotation ?? Math.random() * 2 - 1,
    goal,
    schedule: pod.schedule ?? null,
    pluginIds: pod.pluginIds ?? [],
    provider,
    providerConfig: resolveProviderConfig(provider, pod.providerConfig),
  };
}
