import type { PodProvider } from "@/types/pod";

/**
 * Provider 子選單的硬編碼選項。
 * 不從 providerCapabilityStore 動態取得，因為新增 provider 時仍要人工確認 UI 順序與 label。
 */
export const PROVIDER_OPTIONS: { value: PodProvider; label: string }[] = [
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
  { value: "opencode", label: "OpenCode" },
];
