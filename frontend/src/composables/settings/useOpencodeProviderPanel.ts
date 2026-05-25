import { computed, ref, type ComputedRef, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "@/composables/useToast";
import * as opencodeApi from "@/services/opencodeApi";
import type { OpencodeProviderInfo } from "@/types/opencode";

export type OpencodeProviderLoadState = "loading" | "loaded" | "error";

export interface UseOpencodeProviderPanelOptions {
  listOpencodeProviders?: typeof opencodeApi.listOpencodeProviders;
  restartOpencodeServer?: typeof opencodeApi.restartOpencodeServer;
}

export interface UseOpencodeProviderPanelReturn {
  providers: Ref<OpencodeProviderInfo[]>;
  connected: Ref<string[]>;
  loadState: Ref<OpencodeProviderLoadState>;
  providerSearch: Ref<string>;
  restarting: Ref<boolean>;
  connectedProviders: ComputedRef<OpencodeProviderInfo[]>;
  sortedFilteredProviders: ComputedRef<OpencodeProviderInfo[]>;
  loadFromBackend: () => Promise<void>;
  handleRestartOpencode: () => Promise<void>;
  isConnectedProvider: (providerID: string) => boolean;
}

export function useOpencodeProviderPanel(
  options: UseOpencodeProviderPanelOptions = {},
): UseOpencodeProviderPanelReturn {
  const { t } = useI18n();
  const { toast } = useToast();

  const listOpencodeProviders =
    options.listOpencodeProviders ?? opencodeApi.listOpencodeProviders;
  const restartOpencodeServer =
    options.restartOpencodeServer ?? opencodeApi.restartOpencodeServer;

  const providers = ref<OpencodeProviderInfo[]>([]);
  const connected = ref<string[]>([]);
  const loadState = ref<OpencodeProviderLoadState>("loading");
  const providerSearch = ref("");
  const restarting = ref(false);

  const connectedProviders = computed<OpencodeProviderInfo[]>(() =>
    providers.value.filter((provider) => connected.value.includes(provider.id)),
  );

  const filteredProviders = computed<OpencodeProviderInfo[]>(() => {
    const keyword = providerSearch.value.trim().toLowerCase();
    if (keyword === "") return providers.value;
    return providers.value.filter(
      (provider) =>
        provider.name.toLowerCase().includes(keyword) ||
        provider.id.toLowerCase().includes(keyword),
    );
  });

  const sortedFilteredProviders = computed<OpencodeProviderInfo[]>(() => {
    const connectedSet = new Set(connected.value);
    const groups = filteredProviders.value.reduce<{
      connected: OpencodeProviderInfo[];
      disconnected: OpencodeProviderInfo[];
    }>(
      (acc, provider) => {
        if (connectedSet.has(provider.id)) {
          acc.connected.push(provider);
        } else {
          acc.disconnected.push(provider);
        }
        return acc;
      },
      { connected: [], disconnected: [] },
    );
    return [...groups.connected, ...groups.disconnected];
  });

  const loadFromBackend = async (): Promise<void> => {
    loadState.value = "loading";
    try {
      const result = await listOpencodeProviders();
      providers.value = result.all;
      connected.value = result.connected;
      loadState.value = "loaded";
    } catch (err) {
      console.error("[OpencodeSettingsPanel] loadFromBackend 失敗：", err);
      loadState.value = "error";
    }
  };

  const handleRestartOpencode = async (): Promise<void> => {
    restarting.value = true;
    try {
      await restartOpencodeServer();
      toast({ title: t("llmProvider.opencode.providerList.restartSuccess") });
      await loadFromBackend();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      toast({
        title: t("llmProvider.opencode.providerList.restartFailed", { reason }),
        variant: "destructive",
      });
    } finally {
      restarting.value = false;
    }
  };

  const isConnectedProvider = (providerID: string): boolean =>
    connected.value.includes(providerID);

  return {
    providers,
    connected,
    loadState,
    providerSearch,
    restarting,
    connectedProviders,
    sortedFilteredProviders,
    loadFromBackend,
    handleRestartOpencode,
    isConnectedProvider,
  };
}
