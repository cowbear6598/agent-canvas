import { computed, type ComputedRef } from "vue";
import type { Pod } from "@/types";
import type { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";

interface UseCanvasPodStateOptions {
  pod: () => Pod;
  providerCapabilityStore: ReturnType<typeof useProviderCapabilityStore>;
  connectionStore: {
    isSourcePod: (podId: string) => boolean;
    hasUpstreamConnections: (podId: string) => boolean;
  };
}

interface UseCanvasPodStateReturn {
  isUnknownProvider: ComputedRef<boolean>;
  isSourcePod: ComputedRef<boolean>;
  hasUpstreamConnection: ComputedRef<boolean>;
  isDownstreamChainPod: ComputedRef<boolean>;
  showScheduleButton: ComputedRef<boolean>;
  podProviderClasses: ComputedRef<string>;
  isFileDropDisabled: ComputedRef<boolean>;
}

/**
 * 集中 CanvasPod 的 provider 與 chain 狀態判斷，讓元件只負責綁定畫面與事件。
 */
export function useCanvasPodState({
  pod,
  providerCapabilityStore,
  connectionStore,
}: UseCanvasPodStateOptions): UseCanvasPodStateReturn {
  const isUnknownProvider = computed(
    () =>
      providerCapabilityStore.loaded &&
      !providerCapabilityStore.isKnownProvider(pod().provider),
  );

  const isSourcePod = computed(() => connectionStore.isSourcePod(pod().id));
  const hasUpstreamConnection = computed(() =>
    connectionStore.hasUpstreamConnections(pod().id),
  );
  const isDownstreamChainPod = computed(
    () => hasUpstreamConnection.value && !isSourcePod.value,
  );

  const showScheduleButton = computed(
    () => isSourcePod.value || !hasUpstreamConnection.value,
  );

  const podProviderClasses = computed(() =>
    providerCapabilityStore.allowedProviders.has(pod().provider)
      ? `pod-provider-${pod().provider}`
      : "",
  );

  const isFileDropDisabled = computed(
    () => isDownstreamChainPod.value || isUnknownProvider.value,
  );

  return {
    isUnknownProvider,
    isSourcePod,
    hasUpstreamConnection,
    isDownstreamChainPod,
    showScheduleButton,
    podProviderClasses,
    isFileDropDisabled,
  };
}
