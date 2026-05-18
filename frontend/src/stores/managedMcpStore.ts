import { defineStore } from "pinia";
import { ref } from "vue";
import {
  deleteManagedMcpRegistry,
  listManagedMcpRegistry,
  saveManagedMcpRegistry,
  testManagedMcpRegistry,
  type ManagedMcpRegistryTestOutcome,
} from "@/services/managedMcpApi";
import type {
  ManagedMcpRegistryInput,
  ManagedMcpRegistryItem,
} from "@/types/mcp";

function normalizeManagedMcpError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

function upsertRegistryItem(
  items: ManagedMcpRegistryItem[],
  nextItem: ManagedMcpRegistryItem,
): ManagedMcpRegistryItem[] {
  const existingIndex = items.findIndex((item) => item.id === nextItem.id);
  if (existingIndex === -1) {
    return [...items, nextItem].sort((a, b) => a.name.localeCompare(b.name));
  }

  const nextItems = [...items];
  nextItems.splice(existingIndex, 1, nextItem);
  return nextItems;
}

export const useManagedMcpStore = defineStore("managedMcp", () => {
  const registry = ref<ManagedMcpRegistryItem[]>([]);
  const loading = ref<boolean>(false);
  const error = ref<string | null>(null);
  const loaded = ref<boolean>(false);

  function setRegistry(items: ManagedMcpRegistryItem[]): void {
    registry.value = [...items].sort((a, b) => a.name.localeCompare(b.name));
    loaded.value = true;
  }

  async function refresh(): Promise<void> {
    loading.value = true;
    try {
      setRegistry(await listManagedMcpRegistry());
      error.value = null;
    } catch (err) {
      error.value = normalizeManagedMcpError(err);
    } finally {
      loading.value = false;
    }
  }

  async function saveRegistry(
    payload: ManagedMcpRegistryInput,
  ): Promise<ManagedMcpRegistryItem | null> {
    loading.value = true;
    try {
      const saved = await saveManagedMcpRegistry(payload);
      if (saved) {
        registry.value = upsertRegistryItem(registry.value, saved);
        loaded.value = true;
      } else {
        await refresh();
      }
      error.value = null;
      return saved;
    } catch (err) {
      error.value = normalizeManagedMcpError(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 手動觸發後端 probe；廣播 MANAGED_MCP_REGISTRY_UPDATED 會由事件 handler 順帶 refresh registry，
   * 因此此處不另呼叫 refresh，避免在同一個 tick 內重複 list 請求。
   */
  async function testRegistryConnection(
    registryId: string,
  ): Promise<ManagedMcpRegistryTestOutcome> {
    try {
      const outcome = await testManagedMcpRegistry(registryId);
      error.value = null;
      return outcome;
    } catch (err) {
      error.value = normalizeManagedMcpError(err);
      throw err;
    }
  }

  async function deleteRegistryById(registryId: string): Promise<void> {
    loading.value = true;
    try {
      await deleteManagedMcpRegistry(registryId);
      registry.value = registry.value.filter((item) => item.id !== registryId);
      error.value = null;
    } catch (err) {
      error.value = normalizeManagedMcpError(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  return {
    registry,
    loading,
    error,
    loaded,
    setRegistry,
    refresh,
    saveRegistry,
    testRegistryConnection,
    deleteRegistryById,
  };
});
