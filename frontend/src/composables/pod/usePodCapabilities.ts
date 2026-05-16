import { computed } from "vue";
import type { ComputedRef, Ref } from "vue";
import { usePodStore } from "@/stores/pod";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { resolvePodProvider } from "@/lib/providerOptions";
import type { ProviderCapabilities } from "@/types/pod";

/** usePodCapabilities 回傳值型別 */
export interface UsePodCapabilitiesReturn {
  capabilities: ComputedRef<ProviderCapabilities>;
  isCodex: ComputedRef<boolean>;
  isPluginEnabled: ComputedRef<boolean>;
  isRepositoryEnabled: ComputedRef<boolean>;
  isGoalEnabled: ComputedRef<boolean>;
  isMcpEnabled: ComputedRef<boolean>;
}

/**
 * 根據 podId 取得該 Pod 對應 Provider 的能力表，並提供各功能 disabled 邏輯
 * 集中處理，避免散落到各個 Note component
 */
export function usePodCapabilities(
  podId: Ref<string>,
): UsePodCapabilitiesReturn {
  const podStore = usePodStore();
  const capabilityStore = useProviderCapabilityStore();

  /** 取得 Provider 能力表，Pod 不存在時退回 claude fallback */
  const capabilities = computed((): ProviderCapabilities => {
    const pod = podStore.getPodById(podId.value);
    const provider = resolvePodProvider(pod);
    return capabilityStore.getCapabilities(provider);
  });

  /** 是否為 Codex Pod */
  const isCodex = computed((): boolean => {
    const pod = podStore.getPodById(podId.value);
    return pod?.provider === "codex";
  });

  /** Plugin slot 是否啟用 */
  const isPluginEnabled = computed((): boolean => capabilities.value.plugin);

  /** Repository slot 是否啟用 */
  const isRepositoryEnabled = computed(
    (): boolean => capabilities.value.repository,
  );

  /** Goal slot 是否啟用 */
  const isGoalEnabled = computed((): boolean => capabilities.value.goal ?? true);

  /** MCP slot 是否啟用 */
  const isMcpEnabled = computed((): boolean => capabilities.value.mcp);

  return {
    capabilities,
    isCodex,
    isPluginEnabled,
    isRepositoryEnabled,
    isGoalEnabled,
    isMcpEnabled,
  };
}
