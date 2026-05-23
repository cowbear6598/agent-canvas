import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { OpencodeModelAlias } from "@/types/opencode";
import * as opencodeApi from "@/services/opencodeApi";

/**
 * opencode model 別稱對應表 store。
 * 儲存使用者自訂的 alias → providerID/modelID 對應清單，
 * providerCapabilityStore.getAvailableModels("opencode") 從此 store 動態組裝選項。
 */
export const useOpencodeAliasStore = defineStore("opencodeAlias", () => {
  const EMPTY_ALIAS_LIST: OpencodeModelAlias[] = [];

  const sortAliases = (items: OpencodeModelAlias[]): OpencodeModelAlias[] =>
    [...items].sort((a, b) => a.orderIdx - b.orderIdx);

  const appendIndexValue = (
    index: Map<string, Map<string, Set<string>>>,
    providerID: string,
    key: string,
    aliasId: string,
  ): void => {
    const providerIndex = index.get(providerID) ?? new Map<string, Set<string>>();
    const ids = providerIndex.get(key) ?? new Set<string>();
    ids.add(aliasId);
    providerIndex.set(key, ids);
    index.set(providerID, providerIndex);
  };

  // ---- State ----

  /**
   * 所有 alias 條目，依 orderIdx 升冪排列。
   */
  const aliases = ref<OpencodeModelAlias[]>([]);

  /**
   * 是否已從後端成功載入一次。
   */
  const loaded = ref<boolean>(false);

  // ---- Getters ----

  /**
   * 依 providerID 過濾 alias 清單，並依 orderIdx 升冪排序回傳。
   * 用於只顯示特定 provider 下的 alias 選項。
   */
  const aliasesByProviderIndex = computed(() => {
    const providerAliases = new Map<string, OpencodeModelAlias[]>();
    const aliasIdsByProviderAndAlias = new Map<string, Map<string, Set<string>>>();
    const aliasIdsByProviderAndModel = new Map<string, Map<string, Set<string>>>();

    for (const alias of aliases.value) {
      const list = providerAliases.get(alias.providerID) ?? [];
      list.push(alias);
      providerAliases.set(alias.providerID, list);

      appendIndexValue(
        aliasIdsByProviderAndAlias,
        alias.providerID,
        alias.alias,
        alias.id,
      );
      appendIndexValue(
        aliasIdsByProviderAndModel,
        alias.providerID,
        alias.modelID,
        alias.id,
      );
    }

    return {
      providerAliases,
      aliasIdsByProviderAndAlias,
      aliasIdsByProviderAndModel,
    };
  });

  const aliasesByProvider = computed(
    () =>
      (providerID: string): OpencodeModelAlias[] =>
        aliasesByProviderIndex.value.providerAliases.get(providerID) ??
        EMPTY_ALIAS_LIST,
  );

  /**
   * 本地唯一性檢查：在同一 providerID 下，alias 名稱是否唯一。
   * 新增時不傳 excludeId；編輯時傳入自身 id 排除自己。
   * 跨 providerID 允許同名，回傳 true。
   */
  const isAliasUnique = computed(
    () =>
      (providerID: string, alias: string, excludeId?: string): boolean => {
        const ids =
          aliasesByProviderIndex.value.aliasIdsByProviderAndAlias
            .get(providerID)
            ?.get(alias) ?? null;
        if (!ids) {
          return true;
        }
        if (!excludeId) {
          return false;
        }
        return ids.size === 1 && ids.has(excludeId);
      },
  );

  /**
   * 本地一對一檢查：在同一 providerID 下，modelID 是否尚未被其他 alias 使用。
   * 新增時不傳 excludeId；編輯時傳入自身 id 排除自己。
   * 跨 providerID 允許使用相同 modelID，回傳 true。
   */
  const isModelAliasUnique = computed(
    () =>
      (providerID: string, modelID: string, excludeId?: string): boolean => {
        const ids =
          aliasesByProviderIndex.value.aliasIdsByProviderAndModel
            .get(providerID)
            ?.get(modelID) ?? null;
        if (!ids) {
          return true;
        }
        if (!excludeId) {
          return false;
        }
        return ids.size === 1 && ids.has(excludeId);
      },
  );

  // ---- Actions ----

  /**
   * 以後端回傳的清單取代本地狀態（全量覆寫）。
   * 供 providerCapabilityStore.test.ts 等測試直接操作 state 使用。
   */
  function setAliases(items: OpencodeModelAlias[]): void {
    aliases.value = sortAliases(items);
  }

  /**
   * 透過 WebSocket 向後端載入 alias 清單。
   * 失敗時保留現有 aliases 與 loaded 不變，僅 log 錯誤。
   */
  async function loadFromBackend(): Promise<void> {
    try {
      const items = await opencodeApi.listAliases();
      aliases.value = sortAliases(items);
      loaded.value = true;
    } catch (err) {
      // 失敗時不動 aliases / loaded，維持上一次成功載入的值；
      // 理由：WebSocket 瞬斷重連期間，UI 應繼續使用上一次有效的別稱清單。
      console.error("[opencodeAliasStore] 載入 alias 清單失敗：", err);
    }
  }

  /**
   * 新增一筆 alias。
   * API 呼叫失敗時 rethrow，不更新本地 state；成功才同步本地 state。
   */
  async function addAlias(
    payload: Pick<OpencodeModelAlias, "providerID" | "modelID" | "alias">,
  ): Promise<void> {
    const item = await opencodeApi.createAlias(payload);
    aliases.value = sortAliases([...aliases.value, item]);
  }

  /**
   * 更新既有 alias 的別稱與 modelID 對應（依 id 比對）。
   * 順序由 reorder action 獨立處理，本函式不會修改 orderIdx。
   * API 呼叫失敗時 rethrow，不更新本地 state；成功才同步本地 state。
   */
  async function editAlias(
    payload: Pick<OpencodeModelAlias, "id" | "modelID" | "alias">,
  ): Promise<void> {
    const item = await opencodeApi.updateAlias(payload);
    aliases.value = sortAliases(
      aliases.value.map((a) => (a.id === item.id ? item : a)),
    );
  }

  /**
   * 刪除指定 id 的 alias。
   * API 呼叫失敗時 rethrow，不更新本地 state；成功才同步本地 state。
   */
  async function removeAlias(id: string): Promise<void> {
    await opencodeApi.deleteAlias(id);
    aliases.value = aliases.value.filter((a) => a.id !== id);
  }

  /**
   * 依新順序（id 陣列）重排 alias。
   * API 呼叫失敗時 rethrow，不更新本地 state；成功才同步本地 state（後端回傳已重排清單）。
   */
  async function reorder(idsInOrder: string[]): Promise<void> {
    const items = await opencodeApi.reorderAliases(idsInOrder);
    aliases.value = sortAliases(items);
  }

  /**
   * 重新抓取既有 alias 的 thinking presets。
   * 成功後以後端回傳 item 更新本地清單。
   */
  async function refreshPresets(id: string): Promise<void> {
    const item = await opencodeApi.refreshAliasPresets(id);
    aliases.value = sortAliases(
      aliases.value.map((a) => (a.id === item.id ? item : a)),
    );
  }

  return {
    aliases,
    loaded,
    aliasesByProvider,
    isAliasUnique,
    isModelAliasUnique,
    setAliases,
    loadFromBackend,
    addAlias,
    editAlias,
    removeAlias,
    reorder,
    refreshPresets,
  };
});
