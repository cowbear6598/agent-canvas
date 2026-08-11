import { ref, type Ref } from "vue";
import { useIntegrationStore } from "@/stores/integrationStore";
import type { PodProvider, ProviderConfig } from "@/types/pod";
import type { usePodStore } from "@/stores/pod/podStore";

type PodStore = ReturnType<typeof usePodStore>;

interface IntegrationConnectModalState {
  visible: boolean;
  podId: string;
  provider: string;
}

export interface CanvasPodActions {
  integrationConnectModal: Ref<IntegrationConnectModalState>;
  handleConnectIntegration: (podId: string, provider: string) => void;
  handleDisconnectIntegration: (
    podId: string,
    provider: string,
  ) => Promise<void>;
  handleSwitchPodProvider: (
    podId: string,
    provider: PodProvider,
    providerConfig: ProviderConfig,
  ) => Promise<void>;
  setIntegrationConnectModalOpen: (open: boolean) => void;
}

export function useCanvasPodActions(podStore: PodStore): CanvasPodActions {
  const integrationStore = useIntegrationStore();
  const integrationConnectModal = ref<IntegrationConnectModalState>({
    visible: false,
    podId: "",
    provider: "",
  });

  const handleConnectIntegration = (podId: string, provider: string): void => {
    integrationConnectModal.value = { visible: true, podId, provider };
  };

  const handleDisconnectIntegration = async (
    podId: string,
    provider: string,
  ): Promise<void> => {
    await integrationStore.unbindFromPod(provider, podId);
  };

  const handleSwitchPodProvider = async (
    podId: string,
    provider: PodProvider,
    providerConfig: ProviderConfig,
  ): Promise<void> => {
    await podStore.updatePodProvider(podId, provider, providerConfig);
  };

  const setIntegrationConnectModalOpen = (open: boolean): void => {
    integrationConnectModal.value.visible = open;
  };

  return {
    integrationConnectModal,
    handleConnectIntegration,
    handleDisconnectIntegration,
    handleSwitchPodProvider,
    setIntegrationConnectModalOpen,
  };
}
