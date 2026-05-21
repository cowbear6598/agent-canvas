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
  const aliasesByProvider = computed(
    () =>
      (providerID: string): OpencodeModelAlias[] => {
        return aliases.value
          .filter((a) => a.providerID === providerID)
          .sort((a, b) => a.orderIdx - b.orderIdx);
      },
  );

  /**
   * 本地唯一性檢查：在同一 providerID 下，alias 名稱是否唯一。
   * 新增時不傳 excludeId；編輯時傳入自身 id 排除自己。
   * 跨 providerID 允許同名，回傳 true。
   */
  const isAliasUnique = computed(
    () =>
      (providerID: string, alias: string, excludeId?: string): boolean => {
        return !aliases.value.some(
          (a) =>
            a.providerID === providerID &&
            a.alias === alias &&
            a.id !== excludeId,
        );
      },
  );

  // ---- Actions ----

  /**
   * 以後端回傳的清單取代本地狀態（全量覆寫）。
   * 供 providerCapabilityStore.test.ts 等測試直接操作 state 使用。
   */
  function setAliases(items: OpencodeModelAlias[]): void {
    aliases.value = [...items].sort((a, b) => a.orderIdx - b.orderIdx);
  }

  /**
   * 透過 WebSocket 向後端載入 alias 清單。
   * 失敗時保留現有 aliases 與 loaded 不變，僅 log 錯誤。
   */
  async function loadFromBackend(): Promise<void> {
    try {
      const items = await opencodeApi.listAliases();
      aliases.value = [...items].sort((a, b) => a.orderIdx - b.orderIdx);
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
    payload: Omit<OpencodeModelAlias, "id" | "orderIdx">,
  ): Promise<void> {
    const item = await opencodeApi.createAlias(payload);
    aliases.value = [...aliases.value, item].sort(
      (a, b) => a.orderIdx - b.orderIdx,
    );
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
    aliases.value = aliases.value
      .map((a) => (a.id === item.id ? item : a))
      .sort((a, b) => a.orderIdx - b.orderIdx);
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
    aliases.value = [...items].sort((a, b) => a.orderIdx - b.orderIdx);
  }

  return {
    aliases,
    loaded,
    aliasesByProvider,
    isAliasUnique,
    setAliases,
    loadFromBackend,
    addAlias,
    editAlias,
    removeAlias,
    reorder,
  };
});
