import { defineStore } from "pinia";
import { ref } from "vue";
import {
  listPlugins,
  installPlugin,
  deletePlugin,
  updatePlugin,
  reorderPlugins,
} from "@/services/pluginApi";
import type { InstalledPlugin } from "@/types/plugin";

function normalizeManagedPluginError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "未知錯誤";
}

export const useManagedPluginStore = defineStore("managedPlugin", () => {
  const plugins = ref<InstalledPlugin[]>([]);
  const loading = ref<boolean>(false);
  const error = ref<string | null>(null);
  const loaded = ref<boolean>(false);

  async function refresh(): Promise<void> {
    const hasCachedPlugins = loaded.value || plugins.value.length > 0;
    if (!hasCachedPlugins) {
      loading.value = true;
    }

    try {
      const items = await listPlugins();
      plugins.value = items;
      loaded.value = true;
      error.value = null;
    } catch (err) {
      error.value = normalizeManagedPluginError(err);
    } finally {
      if (!hasCachedPlugins) {
        loading.value = false;
      }
    }
  }

  async function install(githubRepo: string): Promise<InstalledPlugin> {
    const exists = plugins.value.some((p) => p.githubRepo === githubRepo);
    if (exists) {
      throw new Error("該 plugin 已安裝");
    }

    loading.value = true;
    try {
      const installed = await installPlugin(githubRepo);
      plugins.value = [installed, ...plugins.value];
      error.value = null;
      return installed;
    } catch (err) {
      error.value = normalizeManagedPluginError(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function remove(pluginId: string): Promise<void> {
    loading.value = true;
    try {
      const deleted = await deletePlugin(pluginId);
      plugins.value =
        deleted.plugins ?? plugins.value.filter((p) => p.id !== pluginId);
      error.value = null;
    } catch (err) {
      error.value = normalizeManagedPluginError(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function update(pluginId: string): Promise<InstalledPlugin> {
    loading.value = true;
    try {
      const updated = await updatePlugin(pluginId);
      const existingIndex = plugins.value.findIndex((p) => p.id === pluginId);
      if (existingIndex === -1) {
        plugins.value = [...plugins.value, updated];
      } else {
        const nextPlugins = [...plugins.value];
        nextPlugins.splice(existingIndex, 1, updated);
        plugins.value = nextPlugins;
      }
      error.value = null;
      return updated;
    } catch (err) {
      error.value = normalizeManagedPluginError(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function reorder(idsInOrder: string[]): Promise<void> {
    const previousPlugins = [...plugins.value];
    const pluginById = new Map(
      plugins.value.map((plugin) => [plugin.id, plugin]),
    );
    const orderedPlugins = idsInOrder
      .map((id) => pluginById.get(id))
      .filter((plugin): plugin is InstalledPlugin => plugin !== undefined);
    const missingPlugins = plugins.value.filter(
      (plugin) => !idsInOrder.includes(plugin.id),
    );

    plugins.value = [...orderedPlugins, ...missingPlugins];

    try {
      const confirmedPlugins = await reorderPlugins(idsInOrder);
      plugins.value = confirmedPlugins;
      error.value = null;
    } catch (err) {
      plugins.value = previousPlugins;
      error.value = normalizeManagedPluginError(err);
      throw err;
    }
  }

  return {
    plugins,
    loading,
    error,
    loaded,
    refresh,
    install,
    remove,
    update,
    reorder,
  };
});
