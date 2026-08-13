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

const getOpencodeAliasModelValue = (alias: {
  providerID: string;
  modelID: string;
}): string => `${alias.providerID}/${alias.modelID}`;

function getOpencodeAliasThinkingMeta(
  model: string,
):
  | {
      levels: ReadonlyArray<string>;
      labels: Readonly<Record<string, string>>;
      defaultLevel: string;
    }
  | undefined {
  const aliasStore = useOpencodeAliasStore();
  const alias = aliasStore.aliases.find(
    (item) => getOpencodeAliasModelValue(item) === model,
  );

  if (
    alias?.thinkingLevels &&
    alias.thinkingLevels.length > 0 &&
    alias.defaultThinkingLevel
  ) {
    return {
      levels: Object.freeze([...alias.thinkingLevels]),
      labels: Object.freeze({ ...(alias.thinkingLevelLabels ?? {}) }),
      defaultLevel: alias.defaultThinkingLevel,
    };
  }

  return undefined;
}

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

interface ThinkingMeta {
  levels: ReadonlyArray<string>;
  labels: Readonly<Record<string, string>>;
  defaultLevel: string;
}

function buildThinkingMap(
  models: ReadonlyArray<ModelOption>,
): Record<string, ThinkingMeta> {
  const thinkingMap: Record<string, ThinkingMeta> = {};

  for (const model of models) {
    if (!model.thinkingLevels?.length || !model.defaultThinkingLevel) continue;

    thinkingMap[model.value] = {
      levels: Object.freeze([...model.thinkingLevels]),
      labels: Object.freeze({ ...(model.thinkingLevelLabels ?? {}) }),
      defaultLevel: model.defaultThinkingLevel,
    };
  }

  return thinkingMap;
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
        Record<
          string,
          ThinkingMeta
        >
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
              (a): ModelOption => {
                const value = getOpencodeAliasModelValue(a);
                const thinkingMeta =
                  getOpencodeAliasThinkingMeta(value) ??
                  thinkingMetaByProviderModel.value.opencode?.[value];
                const option: ModelOption = {
                  label: a.alias,
                  value,
                };
                if (thinkingMeta) {
                  option.thinkingLevels = thinkingMeta.levels;
                  option.thinkingLevelLabels = thinkingMeta.labels;
                  option.defaultThinkingLevel = thinkingMeta.defaultLevel;
                }
                return option;
              },
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
          if (provider === "opencode") {
            const aliasStore = useOpencodeAliasStore();
            const firstAlias = aliasStore.aliases[0];
            return firstAlias
              ? getOpencodeAliasModelValue(firstAlias)
              : undefined;
          }
          const models = availableModelsByProvider.value[provider];
          return models?.[0]?.value;
        },
    );

    const isModelValidForProvider = computed(
      () =>
        (provider: PodProvider, model: string): boolean => {
          if (provider === "opencode") {
            const aliasStore = useOpencodeAliasStore();
            return aliasStore.aliases.some(
              (alias) => getOpencodeAliasModelValue(alias) === model,
            );
          }
          const modelSet = availableModelValuesByProvider.value[provider];
          if (!modelSet || modelSet.size === 0) return false;
          return modelSet.has(model);
        },
    );

    const getSupportedThinkingLevels = computed(
      () =>
        (provider: PodProvider, model: string): ReadonlyArray<string> => {
          if (provider === "opencode") {
            return (
              getOpencodeAliasThinkingMeta(model)?.levels ??
              thinkingMetaByProviderModel.value.opencode?.[model]?.levels ??
              EMPTY_THINKING_LEVELS
            );
          }
          return (
            thinkingMetaByProviderModel.value[provider]?.[model]?.levels ??
            EMPTY_THINKING_LEVELS
          );
        },
    );

    const getDefaultThinkingLevel = computed(
      () =>
        (provider: PodProvider, model: string): string | undefined => {
          if (provider === "opencode") {
            return (
              getOpencodeAliasThinkingMeta(model)?.defaultLevel ??
              thinkingMetaByProviderModel.value.opencode?.[model]?.defaultLevel
            );
          }
          return thinkingMetaByProviderModel.value[provider]?.[model]
            ?.defaultLevel;
        },
    );

    const getThinkingLevelLabel = computed(
      () =>
        (
          provider: PodProvider,
          model: string,
          level: string,
        ): string | undefined => {
          if (provider === "opencode") {
            return (
              getOpencodeAliasThinkingMeta(model)?.labels[level] ??
              thinkingMetaByProviderModel.value.opencode?.[model]?.labels[level]
            );
          }
          return thinkingMetaByProviderModel.value[provider]?.[model]?.labels[
            level
          ];
        },
    );

    const isThinkingSupportedForModel = computed(
      () =>
        (provider: PodProvider, model: string): boolean => {
          return getSupportedThinkingLevels.value(provider, model).length > 0;
        },
    );

    const isFastModeSupportedForModel = computed(
      () =>
        (provider: PodProvider, model: string): boolean => {
          if (provider === "opencode") return false;
          return Boolean(
            availableModelsByProvider.value[provider]?.find(
              (option) => option.value === model,
            )?.supportsFastMode,
          );
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
        const frozenModels = Object.freeze([...(availableModels ?? [])]);
        if (normalizedName !== "opencode") {
          availableModelsByProvider.value[normalizedName] = frozenModels;
          availableModelValuesByProvider.value[normalizedName] = new Set(
            frozenModels.map((m) => m.value),
          );
        }
        thinkingMetaByProviderModel.value[normalizedName] =
          buildThinkingMap(frozenModels);
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
      getThinkingLevelLabel,
      isThinkingSupportedForModel,
      isFastModeSupportedForModel,
      syncFromPayload,
      loadFromBackend,
    };
  },
);
