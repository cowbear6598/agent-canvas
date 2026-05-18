import { defineStore } from "pinia";
import { ref } from "vue";
import {
  deleteManagedMcpRegistry,
  listManagedMcpRegistry,
  saveManagedMcpRegistry,
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
    deleteRegistryById,
  };
});
