<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from "vue";
import { useEscapeClose } from "@/composables/useEscapeClose";
import { useI18n } from "vue-i18n";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useManagedPluginStore } from "@/stores/managedPluginStore";
import { updatePodPlugins as updatePodPluginsApi } from "@/services/podPluginApi";
import { usePodStore } from "@/stores/pod";
import { getActiveCanvasIdOrWarn } from "@/utils/canvasGuard";
import { useOptimisticToggle } from "@/composables/pod/useOptimisticToggle";
import type { InstalledPlugin } from "@/types/plugin";

const POPOVER_ANCHOR_GAP_PX = 8;

const props = defineProps<{
  podId: string;
  anchorRect: DOMRect;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useI18n();
const podStore = usePodStore();
const managedPluginStore = useManagedPluginStore();
const { isToggling: isPluginDraftDirty, runToggle } = useOptimisticToggle();

const localPluginIds = ref<string[]>([]);

const searchQuery = ref<string>("");
const searchInputRef = ref<HTMLInputElement | null>(null);

const loading = computed(() => managedPluginStore.loading);
const hasPluginCache = computed(
  () => managedPluginStore.loaded || managedPluginStore.plugins.length > 0,
);
const showLoading = computed(() => loading.value && !hasPluginCache.value);
const loadFailed = computed(() => managedPluginStore.error !== null);

const filteredPlugins = computed<InstalledPlugin[]>(() => {
  const plugins = managedPluginStore.plugins;
  if (!searchQuery.value) return plugins;
  const query = searchQuery.value.toLowerCase();
  return plugins.filter((plugin) =>
    plugin.displayName.toLowerCase().includes(query),
  );
});

const localPluginIdsSet = computed(() => new Set(localPluginIds.value));

const rootRef = ref<HTMLElement | null>(null);

const handleMousedown = (event: MouseEvent): void => {
  if (!rootRef.value) return;
  if ((event.target as Element).closest(".pod-plugin-notch-area")) return;
  if (!rootRef.value.contains(event.target as Node)) {
    emit("close");
  }
};

const initLocalPluginIds = (): void => {
  const pod = podStore.getPodById(props.podId);
  localPluginIds.value = [...(pod?.pluginIds ?? [])];
};

const focusSearchInput = async (): Promise<void> => {
  await nextTick();
  searchInputRef.value?.focus();
};

const refreshPluginsInBackground = (): void => {
  // Refresh only the installed plugin catalog. The Pod plugin draft stays local
  // while the user is toggling switches, so late refreshes cannot reset it.
  void managedPluginStore.refresh();
};

onMounted(() => {
  initLocalPluginIds();
  refreshPluginsInBackground();
  void focusSearchInput();
  document.addEventListener("mousedown", handleMousedown, true);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", handleMousedown, true);
});

useEscapeClose(() => emit("close"));

const buildNextIds = (
  current: string[],
  pluginId: string,
  enabled: boolean,
): string[] => {
  if (enabled) {
    return current.includes(pluginId) ? [...current] : [...current, pluginId];
  }
  return current.filter((id) => id !== pluginId);
};

const resolvePluginErrorDescription = (err: unknown): string => {
  const reason =
    err !== null && typeof err === "object" && "reason" in err
      ? (err as Record<string, unknown>).reason
      : undefined;

  return reason === "pod-busy"
    ? t("pod.slot.pluginsBusyTooltip")
    : t("pod.slot.pluginsToggleFailed");
};

const handleToggle = async (
  pluginId: string,
  enabled: boolean,
): Promise<void> => {
  const nextIds = buildNextIds(localPluginIds.value, pluginId, enabled);

  const canvasId = getActiveCanvasIdOrWarn("PluginPopover");
  if (!canvasId) return;

  await runToggle(nextIds, {
    getCurrent: () => [...localPluginIds.value],
    setLocal: (items) => {
      localPluginIds.value = items;
    },
    setStore: (items) => podStore.updatePodPlugins(props.podId, items),
    callApi: (items) => updatePodPluginsApi(canvasId, props.podId, items),
    resolveError: resolvePluginErrorDescription,
    failToast: { title: "Pod" },
  });
};
</script>

<template>
  <Teleport to="body">
    <div
      ref="rootRef"
      class="fixed z-50 min-w-60 rounded-md border border-doodle-ink bg-card p-2 shadow-md"
      :style="{
        left: `${anchorRect.left - POPOVER_ANCHOR_GAP_PX}px`,
        top: `${anchorRect.top}px`,
        transform: 'translateX(-100%)',
      }"
      @click.stop
    >
      <input
        ref="searchInputRef"
        v-model="searchQuery"
        class="pod-popover-search"
        type="text"
        :placeholder="t('pod.slot.searchPlaceholder')"
        @click.stop
      >

      <div
        v-if="showLoading"
        class="flex items-center gap-2 px-2 py-1 text-xs font-mono text-muted-foreground"
      >
        <span
          class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
        <span>{{ t("pod.slot.pluginsLoading") }}</span>
      </div>

      <div
        v-else-if="loadFailed || managedPluginStore.plugins.length === 0"
        class="px-2 py-1 text-xs font-mono text-muted-foreground whitespace-pre-wrap"
      >
        {{ t("pod.slot.pluginsEmpty") }}
      </div>

      <div
        v-else-if="filteredPlugins.length === 0"
        class="px-2 py-1 text-xs font-mono text-muted-foreground"
      >
        {{ t("pod.slot.pluginsSearchEmpty") }}
      </div>

      <ScrollArea
        v-else
        class="pod-popover-scrollable"
      >
        <div class="space-y-1">
          <div
            v-for="plugin in filteredPlugins"
            :key="plugin.id"
            class="group relative flex items-center justify-between gap-3 rounded px-2 py-1 hover:bg-secondary"
          >
            <p class="text-xs font-mono">
              {{ plugin.displayName }}
            </p>
            <Switch
              :model-value="localPluginIdsSet.has(plugin.id)"
              :disabled="isPluginDraftDirty"
              @click.stop
              @update:model-value="
                (val: boolean) => handleToggle(plugin.id, val)
              "
            />
          </div>
        </div>
      </ScrollArea>
    </div>
  </Teleport>
</template>
