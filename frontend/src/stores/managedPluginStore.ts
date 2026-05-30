import { defineStore } from "pinia";
import { ref } from "vue";
import {
  listPlugins,
  installPlugin,
  deletePlugin,
  updatePlugin,
  reorderPlugins,
  uploadPluginBundle,
} from "@/services/pluginApi";
import type { InstalledPlugin, InstalledPluginSource } from "@/types/plugin";

function normalizeManagedPluginError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "未知錯誤";
}

function sortPluginsByBackendOrder(
  plugins: InstalledPlugin[],
): InstalledPlugin[] {
  return [...plugins].sort(
    (a, b) =>
      a.sortIndex - b.sortIndex ||
      a.installedAt.localeCompare(b.installedAt) ||
      a.id.localeCompare(b.id),
  );
}

function isSameSource(
  left: InstalledPluginSource,
  right: InstalledPluginSource,
): boolean {
  return left.type === right.type && left.ref === right.ref;
}

function upsertPlugin(
  existing: InstalledPlugin[],
  nextPlugin: InstalledPlugin,
): InstalledPlugin[] {
  const index = existing.findIndex((plugin) => plugin.id === nextPlugin.id);
  if (index === -1) {
    return sortPluginsByBackendOrder([...existing, nextPlugin]);
  }

  const nextItems = [...existing];
  nextItems.splice(index, 1, nextPlugin);
  return sortPluginsByBackendOrder(nextItems);
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
    const normalizedRepo = githubRepo.trim();
    const exists = plugins.value.some((plugin) =>
      isSameSource(plugin.source, {
        type: "github",
        ref: normalizedRepo,
      }),
    );
    if (exists) {
      throw new Error("這個 GitHub skill bundle 已匯入");
    }

    loading.value = true;
    try {
      const installed = await installPlugin(normalizedRepo);
      plugins.value = upsertPlugin(plugins.value, installed);
      error.value = null;
      return installed;
    } catch (err) {
      error.value = normalizeManagedPluginError(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function upload(file: File): Promise<InstalledPlugin> {
    loading.value = true;
    try {
      const installed = await uploadPluginBundle(file);
      plugins.value = upsertPlugin(plugins.value, installed);
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
      plugins.value = upsertPlugin(plugins.value, updated);
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
    const idsInOrderSet = new Set(idsInOrder);
    const missingPlugins = plugins.value.filter(
      (plugin) => !idsInOrderSet.has(plugin.id),
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
    upload,
    remove,
    update,
    reorder,
  };
});
