import { createResourceCRUDActions } from "./createResourceCRUDActions";
import type { NoteCRUDConfig, NoteStoreConfig } from "./createNoteStore";
import { capitalizeFirstLetter } from "@/lib/utils";

type CRUDStoreContext = {
  availableItems: { id: string; name: string }[];
  deleteItem: (id: string) => Promise<void>;
  loadItems: () => Promise<void>;
};

type CRUDActionResult = { success: boolean; [key: string]: unknown };

interface CRUDActions {
  create: (
    this: CRUDStoreContext,
    name: string,
    content: string,
  ) => Promise<CRUDActionResult>;
  update: (
    this: CRUDStoreContext,
    itemId: string,
    content: string,
  ) => Promise<CRUDActionResult>;
  read: (
    this: CRUDStoreContext,
    itemId: string,
  ) => Promise<{ id: string; name: string; content: string } | null>;
  delete: (this: CRUDStoreContext, itemId: string) => Promise<void>;
  loadAll: (this: CRUDStoreContext) => Promise<void>;
}

/**
 * 根據 crudConfig.methodPrefix 動態產生命名方法，以符合各 store 的語意慣例。
 *
 * 對應規則（以 methodPrefix = 'command' 為例）：
 *   - createCommand  → 建立資源
 *   - updateCommand  → 更新資源
 *   - readCommand    → 讀取單一資源內容
 *   - deleteCommand  → 刪除資源（委派給 deleteItem）
 *   - loadCommands   → 載入所有資源（委派給 loadItems）
 *
 * 目前使用此機制的 store：
 *   - commandStore  (methodPrefix: 'command')
 *   - repositoryStore (methodPrefix: 'repository')
 *   - mcpServerStore (methodPrefix: 'mcpServer')
 */
export function buildCRUDActions<TItem>(
  config: NoteStoreConfig<TItem>,
): Record<string, CRUDActions[keyof CRUDActions]> {
  if (!config.crudConfig) return {};

  const crudConfig = config.crudConfig as NoteCRUDConfig<{
    id: string;
    name: string;
  }>;
  const methodPrefix = crudConfig.methodPrefix;
  const capitalizedMethodPrefix = capitalizeFirstLetter(methodPrefix);

  const crud = createResourceCRUDActions(
    crudConfig.resourceType,
    crudConfig.events,
    crudConfig.payloadConfig,
    crudConfig.toastCategory,
  );

  const createAction = async function (
    this: CRUDStoreContext,
    name: string,
    content: string,
  ): Promise<CRUDActionResult> {
    const result = await crud.create(this.availableItems, name, content);
    return result.success
      ? { success: true, [methodPrefix]: result.item }
      : { success: false, error: result.error };
  };

  const updateAction = async function (
    this: CRUDStoreContext,
    itemId: string,
    content: string,
  ): Promise<CRUDActionResult> {
    const result = await crud.update(this.availableItems, itemId, content);
    return result.success
      ? { success: true, [methodPrefix]: result.item }
      : { success: false, error: result.error };
  };

  const readAction = async function (
    this: CRUDStoreContext,
    itemId: string,
  ): Promise<{ id: string; name: string; content: string } | null> {
    return crud.read(itemId) as Promise<{
      id: string;
      name: string;
      content: string;
    } | null>;
  };

  const deleteAction = async function (
    this: CRUDStoreContext,
    itemId: string,
  ): Promise<void> {
    return this.deleteItem(itemId);
  };

  const loadAllAction = async function (this: CRUDStoreContext): Promise<void> {
    return this.loadItems();
  };

  return {
    [`create${capitalizedMethodPrefix}`]: createAction,
    [`update${capitalizedMethodPrefix}`]: updateAction,
    [`read${capitalizedMethodPrefix}`]: readAction,
    [`delete${capitalizedMethodPrefix}`]: deleteAction,
    [`load${capitalizedMethodPrefix}s`]: loadAllAction,
  };
}
