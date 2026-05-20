import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { ModelOption, PodProvider } from "@/types/pod";
import {
  isSupportedPodProvider,
  normalizePodProvider,
} from "@/lib/providerOptions";
import { useOpencodeAliasStore } from "@/stores/opencodeAliasStore";
import {
  createWebSocketRequest,
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/services/websocket";
import { useToast } from "@/composables/useToast";
import { t } from "@/i18n";

const EMPTY_AVAILABLE_MODELS: ReadonlyArray<ModelOption> = Object.freeze([]);

const EMPTY_THINKING_LEVELS: ReadonlyArray<string> = Object.freeze([]);

/**
 * provider:list 回應的單一 Provider 資料結構。
 */
interface ProviderListItem {
  name: PodProvider;
  defaultOptions: Record<string, unknown>;
  availableModels: ReadonlyArray<ModelOption>;
}

/**
 * syncFromPayload 的輸入型別。
 * defaultOptions 與 availableModels 為 optional（有 ?? 防禦 fallback），
 * 允許測試僅傳入 name 而不必補齊所有欄位。
 */
type SyncProviderItem = Omit<
  ProviderListItem,
  "defaultOptions" | "availableModels"
> & {
  defaultOptions?: Record<string, unknown>;
  availableModels?: ReadonlyArray<ModelOption>;
};

interface ProviderListResultPayload {
  requestId?: string;
  success?: boolean;
  error?: string;
  providers: ProviderListItem[];
}

interface ProviderListPayload {
  requestId: string;
}

export const useProviderCapabilityStore = defineStore(
  "providerCapability",
  () => {
    const { toast } = useToast();

    /**
     * 已知 provider 名稱集合，由 syncFromPayload 維護。
     * 取代舊版 capabilitiesByProvider，用於 isKnownProvider / allowedProviders。
     */
    const knownProviders = ref<Set<PodProvider>>(new Set());

    const defaultOptionsByProvider = ref<
      Record<PodProvider, Record<string, unknown>>
    >({});

    const availableModelsByProvider = ref<
      Record<PodProvider, ReadonlyArray<ModelOption>>
    >({});

    const availableModelValuesByProvider = ref<Record<string, Set<string>>>({});

    const thinkingMetaByProviderModel = ref<
      Record<
        string,
        Record<string, { levels: ReadonlyArray<string>; defaultLevel: string }>
      >
    >({});

    const loaded = ref<boolean>(false);

    const getDefaultOptions = computed(
      () =>
        (provider: PodProvider): Record<string, unknown> | undefined => {
          return defaultOptionsByProvider.value[provider];
        },
    );

    const isKnownProvider = computed(() => (provider: string): boolean => {
      return knownProviders.value.has(provider as PodProvider);
    });

    /**
     * 取得指定 Provider 的可選模型清單。
     * - opencode：從 opencodeAliasStore.aliases 動態組裝
     * - 其他 provider：沿用 availableModelsByProvider 靜態清單
     */
    const getAvailableModels = computed(
      () =>
        (provider: PodProvider): ReadonlyArray<ModelOption> => {
          if (provider === "opencode") {
            const aliasStore = useOpencodeAliasStore();
            const aliases = aliasStore.aliases;
            if (aliases.length === 0) return EMPTY_AVAILABLE_MODELS;
            return aliases.map(
              (a): ModelOption => ({
                label: a.alias,
                value: `${a.providerID}/${a.modelID}`,
              }),
            );
          }
          return (
            availableModelsByProvider.value[provider] ?? EMPTY_AVAILABLE_MODELS
          );
        },
    );

    const getDefaultModel = computed(
      () =>
        (provider: PodProvider): string | undefined => {
          const models = availableModelsByProvider.value[provider];
          return models?.[0]?.value;
        },
    );

    const isModelValidForProvider = computed(
      () =>
        (provider: PodProvider, model: string): boolean => {
          const modelSet = availableModelValuesByProvider.value[provider];
          if (!modelSet || modelSet.size === 0) return false;
          return modelSet.has(model);
        },
    );

    const getSupportedThinkingLevels = computed(
      () =>
        (provider: PodProvider, model: string): ReadonlyArray<string> => {
          return (
            thinkingMetaByProviderModel.value[provider]?.[model]?.levels ??
            EMPTY_THINKING_LEVELS
          );
        },
    );

    const getDefaultThinkingLevel = computed(
      () =>
        (provider: PodProvider, model: string): string | undefined => {
          return thinkingMetaByProviderModel.value[provider]?.[model]
            ?.defaultLevel;
        },
    );

    const isThinkingSupportedForModel = computed(
      () =>
        (provider: PodProvider, model: string): boolean => {
          return getSupportedThinkingLevels.value(provider, model).length > 0;
        },
    );

    const allowedProviders = computed(
      () => new Set<string>(knownProviders.value),
    );

    /**
     * 把後端回傳的 providers 陣列寫入 state。
     * 同時更新 knownProviders、defaultOptionsByProvider 與 availableModelsByProvider。
     */
    function syncFromPayload(providers: SyncProviderItem[]): void {
      const normalizedSeen = new Set<string>();

      for (const { name, defaultOptions, availableModels } of providers) {
        const normalizedName = normalizePodProvider(name);
        if (!isSupportedPodProvider(normalizedName)) continue;
        if (name !== normalizedName && normalizedSeen.has(normalizedName)) {
          continue;
        }

        normalizedSeen.add(normalizedName);
        knownProviders.value.add(normalizedName);
        defaultOptionsByProvider.value[normalizedName] = {
          ...(defaultOptions ?? {}),
        };
        // opencode 的 availableModels 由 opencodeAliasStore 動態提供
        if (normalizedName === "opencode") continue;
        const frozenModels = Object.freeze([...(availableModels ?? [])]);
        availableModelsByProvider.value[normalizedName] = frozenModels;
        availableModelValuesByProvider.value[normalizedName] = new Set(
          frozenModels.map((m) => m.value),
        );
        const thinkingMap: Record<
          string,
          { levels: ReadonlyArray<string>; defaultLevel: string }
        > = {};
        for (const model of frozenModels) {
          if (
            model.thinkingLevels &&
            model.thinkingLevels.length > 0 &&
            model.defaultThinkingLevel
          ) {
            thinkingMap[model.value] = {
              levels: Object.freeze([...model.thinkingLevels]),
              defaultLevel: model.defaultThinkingLevel,
            };
          }
        }
        thinkingMetaByProviderModel.value[normalizedName] = thinkingMap;
      }
      // 觸發 Vue reactivity（Set add 不會自動觸發）
      knownProviders.value = new Set(knownProviders.value);
    }

    async function loadFromBackend(): Promise<void> {
      try {
        const response = await createWebSocketRequest<
          ProviderListPayload,
          ProviderListResultPayload
        >({
          requestEvent: WebSocketRequestEvents.PROVIDER_LIST,
          responseEvent: WebSocketResponseEvents.PROVIDER_LIST_RESULT,
          payload: {},
        });

        if (response.providers?.length) {
          syncFromPayload(response.providers);
        }

        loaded.value = true;
      } catch {
        toast({
          title: t("pod.provider.title"),
          description: t("pod.provider.loadFailedDescription"),
          variant: "destructive",
        });
      }
    }

    return {
      knownProviders,
      defaultOptionsByProvider,
      availableModelsByProvider,
      thinkingMetaByProviderModel,
      loaded,
      allowedProviders,
      getDefaultOptions,
      getAvailableModels,
      getDefaultModel,
      isModelValidForProvider,
      isKnownProvider,
      getSupportedThinkingLevels,
      getDefaultThinkingLevel,
      isThinkingSupportedForModel,
      syncFromPayload,
      loadFromBackend,
    };
  },
);
