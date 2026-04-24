/**
 * providerOptions.ts
 *
 * 提供 provider 型別 narrow helper，透過 Pod.provider 欄位值
 * 將平坦的 providerConfig 收斂到強型別 ClaudeOptions / CodexOptions。
 *
 * 此 helper 僅在 runtime 層做型別 narrow，providerConfig 資料形狀
 * 維持 { model: string } 平坦，不改 DB / wire 格式。
 *
 * 對應後端：
 *   - claudeProvider.ts（ClaudeOptions）
 *   - codexProvider.ts（CodexOptions）
 */

import type { ClaudeOptions, CodexOptions, Pod } from "@/types";

/**
 * 從 Pod 推導出強型別 ClaudeOptions。
 * 若 pod.provider 不為 "claude" 則拋出錯誤。
 *
 * @param pod - 目標 Pod
 * @returns ClaudeOptions（至少含 model，未來可擴充）
 * @throws 若 pod.provider 非 "claude"
 */
export function getClaudeOptions(pod: Pod): ClaudeOptions {
  if (pod.provider !== "claude") {
    throw new Error(`Pod provider 為 ${pod.provider}，無法取得 ClaudeOptions`);
  }
  return {
    model: pod.providerConfig.model,
  };
}

/**
 * 從 Pod 推導出強型別 CodexOptions。
 * 若 pod.provider 不為 "codex" 則拋出錯誤。
 *
 * @param pod - 目標 Pod
 * @returns CodexOptions（至少含 model，未來可擴充）
 * @throws 若 pod.provider 非 "codex"
 */
export function getCodexOptions(pod: Pod): CodexOptions {
  if (pod.provider !== "codex") {
    throw new Error(`Pod provider 為 ${pod.provider}，無法取得 CodexOptions`);
  }
  return {
    model: pod.providerConfig.model,
  };
}
