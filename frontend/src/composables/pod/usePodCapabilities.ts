import { computed } from "vue";
import type { ComputedRef, Ref } from "vue";
import { usePodStore } from "@/stores/pod";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import type { ProviderCapabilities } from "@/types/pod";

/** usePodCapabilities 回傳值型別 */
export interface UsePodCapabilitiesReturn {
  capabilities: ComputedRef<ProviderCapabilities>;
  isCodex: ComputedRef<boolean>;
  isSkillEnabled: ComputedRef<boolean>;
  isSubAgentEnabled: ComputedRef<boolean>;
  isRepositoryEnabled: ComputedRef<boolean>;
  isCommandEnabled: ComputedRef<boolean>;
  isMcpEnabled: ComputedRef<boolean>;
  isIntegrationEnabled: ComputedRef<boolean>;
  isRunModeEnabled: ComputedRef<boolean>;
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
    const provider = pod?.provider ?? "claude";
    return capabilityStore.getCapabilities(provider);
  });

  /** 是否為 Codex Pod */
  const isCodex = computed((): boolean => {
    const pod = podStore.getPodById(podId.value);
    return pod?.provider === "codex";
  });

  /** Skill slot 是否啟用 */
  const isSkillEnabled = computed((): boolean => capabilities.value.skill);

  /** SubAgent slot 是否啟用 */
  const isSubAgentEnabled = computed(
    (): boolean => capabilities.value.subAgent,
  );

  /** Repository slot 是否啟用 */
  const isRepositoryEnabled = computed(
    (): boolean => capabilities.value.repository,
  );

  /** Command slot 是否啟用 */
  const isCommandEnabled = computed((): boolean => capabilities.value.command);

  /** MCP slot 是否啟用 */
  const isMcpEnabled = computed((): boolean => capabilities.value.mcp);

  /** Integration 是否啟用（保留給未來使用） */
  const isIntegrationEnabled = computed(
    (): boolean => capabilities.value.integration,
  );

  /** RunMode 是否啟用（保留給未來使用） */
  const isRunModeEnabled = computed((): boolean => capabilities.value.runMode);

  return {
    capabilities,
    isCodex,
    isSkillEnabled,
    isSubAgentEnabled,
    isRepositoryEnabled,
    isCommandEnabled,
    isMcpEnabled,
    isIntegrationEnabled,
    isRunModeEnabled,
  };
}
