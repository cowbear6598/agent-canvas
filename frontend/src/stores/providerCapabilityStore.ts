import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type {
  ModelOption,
  PodProvider,
  ProviderCapabilities,
} from "@/types/pod";
import {
  createWebSocketRequest,
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/services/websocket";
import { useToast } from "@/composables/useToast";
import { t } from "@/i18n";

/**
 * 保守 fallback：找不到 provider 時使用。
 * 僅開放 chat，其餘功能全部關閉，讓 UI 不會因未知 provider 而 crash。
 */
const CONSERVATIVE_FALLBACK_CAPABILITIES: ProviderCapabilities = {
  chat: true,
  plugin: false,
  repository: false,
  command: false,
  mcp: false,
};

/**
 * getAvailableModels 找不到對應 provider 時的回傳值。
 * 後端資料尚未載入或 provider 未聲告時回傳空陣列；
 * 使用單一 frozen 實例避免每次呼叫產生新陣列，方便呼叫端做參考比較。
 */
const EMPTY_AVAILABLE_MODELS: ReadonlyArray<ModelOption> = Object.freeze([]);

/**
 * provider:list 回應的單一 Provider 資料結構。
 * 後端保證 defaultOptions 與 availableModels 均會帶入。
 */
interface ProviderListItem {
  name: PodProvider;
  capabilities: ProviderCapabilities;
  /** Provider 預設執行時選項（後端已移除伺服器敏感路徑） */
  defaultOptions: Record<string, unknown>;
  /** Provider 聲告支援的模型清單，前端模型選擇器依此動態渲染選項 */
  availableModels: ReadonlyArray<ModelOption>;
}

/**
 * syncFromPayload 的輸入型別。
 * defaultOptions 與 availableModels 為 optional（有 ?? 防禦 fallback），
 * 允許測試僅傳入 name + capabilities 而不必補齊所有欄位。
 * 後端 WS 回應路徑使用 ProviderListItem（兩欄位必填），不受此影響。
 */
type SyncProviderItem = Omit<
  ProviderListItem,
  "defaultOptions" | "availableModels"
> & {
  defaultOptions?: Record<string, unknown>;
  availableModels?: ReadonlyArray<ModelOption>;
};

/** provider:list:result 回應格式 */
interface ProviderListResultPayload {
  requestId?: string;
  success?: boolean;
  error?: string;
  providers: ProviderListItem[];
}

/** provider:list 請求格式 */
interface ProviderListPayload {
  requestId: string;
}

export const useProviderCapabilityStore = defineStore(
  "providerCapability",
  () => {
    // ---- Toast composable（store 頂層取得，避免 action 每次重新呼叫） ----
    const { toast } = useToast();

    // ---- State ----

    /**
     * 各 Provider 的功能能力。
     * 初值為空物件，由 loadFromBackend 寫入；
     * 讀取前若 provider 不存在，getCapabilities 會回傳保守 fallback。
     */
    const capabilitiesByProvider = ref<
      Record<PodProvider, ProviderCapabilities>
    >({});

    /**
     * 各 Provider 的預設選項（如 defaultModel）。
     * 初值為空物件；後端 Phase 6 才送此欄位，
     * Phase 2 先建立接收架構，payload 若無帶入則寫 {}。
     */
    const defaultOptionsByProvider = ref<
      Record<PodProvider, Record<string, unknown>>
    >({});

    /**
     * 各 Provider 的可選模型清單。
     * 初值為空物件，由 syncFromPayload 寫入；
     * 未收到對應 provider 資料時，getAvailableModels 回傳 EMPTY_AVAILABLE_MODELS。
     */
    const availableModelsByProvider = ref<
      Record<PodProvider, ReadonlyArray<ModelOption>>
    >({});

    /**
     * 各 Provider 可選模型的 value Set，供 isModelValidForProvider O(1) 查詢。
     * 與 availableModelsByProvider 同步更新，由 syncFromPayload 維護。
     */
    const availableModelValuesByProvider = ref<Record<string, Set<string>>>({});

    /** 是否已從後端成功載入一次 */
    const loaded = ref<boolean>(false);

    // ---- Getters ----

    /**
     * 取得指定 Provider 的能力表。
     * 若 provider 不存在於 state，回傳保守 fallback（chat: true，其餘 false），
     * 不再依賴外部 fallback 常數。
     */
    const getCapabilities = computed(
      () =>
        (provider: PodProvider): ProviderCapabilities => {
          return (
            capabilitiesByProvider.value[provider] ?? {
              ...CONSERVATIVE_FALLBACK_CAPABILITIES,
            }
          );
        },
    );

    /**
     * 查詢特定 Provider 的某項能力是否啟用
     */
    const isCapabilityEnabled = computed(
      () =>
        (provider: PodProvider, key: keyof ProviderCapabilities): boolean => {
          return capabilitiesByProvider.value[provider]?.[key] ?? false;
        },
    );

    /**
     * 取得指定 Provider 的預設選項。
     * 若 provider 尚未收到 metadata，回傳 undefined；
     * 若已收到但後端未帶 defaultOptions，回傳 {}。
     */
    const getDefaultOptions = computed(
      () =>
        (provider: PodProvider): Record<string, unknown> | undefined => {
          return defaultOptionsByProvider.value[provider];
        },
    );

    /**
     * 判斷指定 provider 是否為已知（已收到 metadata）的 provider。
     * 供 UI 層判斷未知 provider 的 fallback 顯示（如「此 Provider 已下線或尚未支援」）。
     */
    const isKnownProvider = computed(() => (provider: string): boolean => {
      return Object.prototype.hasOwnProperty.call(
        capabilitiesByProvider.value,
        provider,
      );
    });

    /**
     * 取得指定 Provider 的可選模型清單。
     * 後端資料尚未載入或 provider 未聲告時回傳空陣列（EMPTY_AVAILABLE_MODELS），
     * 呼叫端應自行判斷是否 fallback 至僅顯示 currentModel 的行為。
     */
    const getAvailableModels = computed(
      () =>
        (provider: PodProvider): ReadonlyArray<ModelOption> => {
          return (
            availableModelsByProvider.value[provider] ?? EMPTY_AVAILABLE_MODELS
          );
        },
    );

    /**
     * 取得指定 Provider 的預設模型（availableModels 第一筆的 value）。
     * 若 provider 尚未收到 metadata 或模型清單為空，回傳 undefined；
     * 呼叫端應自行判斷是否 fallback 至 DEFAULT_SUMMARY_MODEL。
     */
    const getDefaultModel = computed(
      () =>
        (provider: PodProvider): string | undefined => {
          const models = availableModelsByProvider.value[provider];
          return models?.[0]?.value;
        },
    );

    /**
     * 判斷指定 model 是否為該 provider 的合法模型（存在於 availableModels 清單）。
     * provider 尚未收到 metadata（清單為空）時，回傳 false，
     * 避免在 capability 尚未載入時誤判所有 model 都合法。
     * 使用 Set.has() O(1) 查詢，避免每次線性掃描。
     */
    const isModelValidForProvider = computed(
      () =>
        (provider: PodProvider, model: string): boolean => {
          const modelSet = availableModelValuesByProvider.value[provider];
          if (!modelSet || modelSet.size === 0) return false;
          return modelSet.has(model);
        },
    );

    /**
     * 所有已知 provider 的 Set，供各 Pod 共用同一份參考（O(1) 查找）。
     * 集中在 store 計算，避免每個 Pod 元件各自重建 Set。
     */
    const allowedProviders = computed(
      () => new Set<string>(Object.keys(capabilitiesByProvider.value)),
    );

    // ---- Actions ----

    /**
     * 把後端回傳的 providers 陣列寫入 state。
     * 同時更新 capabilitiesByProvider、defaultOptionsByProvider 與 availableModelsByProvider。
     * 後端保證 defaultOptions 與 availableModels 均會帶入。
     * 測試路徑可傳入 SyncProviderItem（兩欄位 optional，?? fallback 保護），
     * 避免所有只關心 capabilities 的測試都要補齊非必填欄位。
     */
    function syncFromPayload(providers: SyncProviderItem[]): void {
      for (const {
        name,
        capabilities,
        defaultOptions,
        availableModels,
      } of providers) {
        capabilitiesByProvider.value[name] = { ...capabilities };
        defaultOptionsByProvider.value[name] = { ...(defaultOptions ?? {}) };
        // Object.freeze 一次性凍結陣列，防止外部引用意外修改 store 內部狀態
        const frozenModels = Object.freeze([...(availableModels ?? [])]);
        availableModelsByProvider.value[name] = frozenModels;
        // 同步建立 value Set，供 isModelValidForProvider O(1) 查詢
        availableModelValuesByProvider.value[name] = new Set(
          frozenModels.map((m) => m.value),
        );
      }
    }

    /**
     * 透過 WebSocket 向後端載入 provider capabilities。
     * 失敗時維持上一次成功載入的值（或初始空物件），並顯示警告 toast。
     */
    async function loadFromBackend(): Promise<void> {
      try {
        // createWebSocketRequest 的 payload 型別為 Omit<TPayload, "requestId">，
        // 因此傳入 {} 即符合合約（requestId 由 createWebSocketRequest 內部自動產生並注入）
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
        // 失敗時不動 capabilitiesByProvider / defaultOptionsByProvider / availableModelsByProvider，
        // 維持上一次成功載入的值；若從未成功則維持初始空物件。
        // 理由：WebSocket 瞬斷重連期間，UI 應繼續使用上一次有效的模型清單，
        // 避免下拉選單瞬間變空導致使用者已選的模型被 fallback 邏輯誤重置。
        // 僅在從未成功載入時才 reset loaded，已成功過的失敗只 toast 不退回未載入狀態。
        toast({
          title: t("pod.provider.title"),
          description: t("pod.provider.loadFailedDescription"),
          variant: "destructive",
        });
      }
    }

    return {
      capabilitiesByProvider,
      defaultOptionsByProvider,
      availableModelsByProvider,
      loaded,
      allowedProviders,
      getCapabilities,
      isCapabilityEnabled,
      getDefaultOptions,
      getAvailableModels,
      getDefaultModel,
      isModelValidForProvider,
      isKnownProvider,
      syncFromPayload,
      loadFromBackend,
    };
  },
);
