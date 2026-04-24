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

/**
 * 保守 fallback：找不到 provider 時使用。
 * 僅開放 chat，其餘功能全部關閉，讓 UI 不會因未知 provider 而 crash。
 */
const CONSERVATIVE_FALLBACK_CAPABILITIES: ProviderCapabilities = {
  chat: true,
  outputStyle: false,
  skill: false,
  subAgent: false,
  repository: false,
  command: false,
  mcp: false,
  integration: false,
  runMode: false,
};

/**
 * getAvailableModels 找不到對應 provider 時的回傳值。
 * 後端資料尚未載入或 provider 未聲告時回傳空陣列；
 * 使用單一 frozen 實例避免每次呼叫產生新陣列，方便呼叫端做參考比較。
 */
const EMPTY_AVAILABLE_MODELS: ReadonlyArray<ModelOption> = Object.freeze([]);

/**
 * provider:list 回應的單一 Provider 資料結構。
 * defaultOptions 為 optional：後端 Phase 6 才會帶此欄位，
 * 前端先行處理以確保 graceful degradation。
 */
interface ProviderListItem {
  name: PodProvider;
  capabilities: ProviderCapabilities;
  /** 後端 Phase 6 後才帶入；不存在時預設 {} */
  defaultOptions?: Record<string, unknown>;
  /**
   * 後端提供的可選模型清單；未來由此欄位取代前端 CLAUDE_OPTIONS / CODEX_OPTIONS 硬編碼。
   * 後端尚未帶入時為 undefined，UI 層需 fallback 至內建清單。
   */
  availableModels?: ReadonlyArray<ModelOption>;
}

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

    // ---- Actions ----

    /**
     * 把後端回傳的 providers 陣列寫入 state。
     * 同時更新 capabilitiesByProvider、defaultOptionsByProvider 與 availableModelsByProvider。
     * 若 payload 未帶 defaultOptions，寫入 {} 確保 graceful degradation；
     * 若 payload 未帶 availableModels，寫入空陣列，UI 層會 fallback 至 currentModel 單卡模式。
     */
    function syncFromPayload(providers: ProviderListItem[]): void {
      for (const {
        name,
        capabilities,
        defaultOptions,
        availableModels,
      } of providers) {
        capabilitiesByProvider.value[name] = { ...capabilities };
        // 後端 Phase 6 才送 defaultOptions，此階段先以 {} 填充確保不 crash
        defaultOptionsByProvider.value[name] = { ...(defaultOptions ?? {}) };
        // 後端提供 availableModels 時寫入，未帶則以空陣列覆蓋；
        // 淺拷貝一份避免外部引用污染 store 內部狀態
        availableModelsByProvider.value[name] = availableModels
          ? [...availableModels]
          : [];
      }
    }

    /**
     * 透過 WebSocket 向後端載入 provider capabilities。
     * 失敗時維持初始空物件，並顯示警告 toast。
     */
    async function loadFromBackend(): Promise<void> {
      const { toast } = useToast();

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
        // 失敗時不動 capabilitiesByProvider / defaultOptionsByProvider / availableModelsByProvider，
        // 維持上一次成功載入的值；若從未成功則維持初始空物件。
        // 理由：WebSocket 瞬斷重連期間，UI 應繼續使用上一次有效的模型清單，
        // 避免下拉選單瞬間變空導致使用者已選的模型被 fallback 邏輯誤重置。
        toast({
          title: "Provider",
          description: "無法取得 provider capabilities，部分功能可能不正常",
          variant: "destructive",
        });
      }
    }

    return {
      capabilitiesByProvider,
      defaultOptionsByProvider,
      availableModelsByProvider,
      loaded,
      getCapabilities,
      isCapabilityEnabled,
      getDefaultOptions,
      getAvailableModels,
      isKnownProvider,
      syncFromPayload,
      loadFromBackend,
    };
  },
);
