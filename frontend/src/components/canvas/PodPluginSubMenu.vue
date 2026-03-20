<script setup lang="ts">
import { ref, onMounted } from "vue";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { listPlugins } from "@/services/pluginApi";
import { updatePodPlugins as updatePodPluginsApi } from "@/services/podPluginApi";
import { usePodStore } from "@/stores";
import { useToast } from "@/composables/useToast";
import { getActiveCanvasIdOrWarn } from "@/utils/canvasGuard";
import type { InstalledPlugin } from "@/types/plugin";

interface Props {
  podId: string;
  position: { x: number; y: number };
}

const props = defineProps<Props>();

const emit = defineEmits<{
  close: [];
  "cancel-close": [];
}>();

const podStore = usePodStore();
const { toast } = useToast();

const installedPlugins = ref<InstalledPlugin[]>([]);
const localPluginIds = ref<string[]>([]);

onMounted(async () => {
  const pod = podStore.getPodById(props.podId);
  localPluginIds.value = [...(pod?.pluginIds ?? [])];

  try {
    installedPlugins.value = await listPlugins();
  } catch {
    installedPlugins.value = [];
    toast({
      title: "載入 Plugin 列表失敗",
      description: "無法取得已安裝的 Plugin 列表，請稍後再試",
      variant: "destructive",
    });
  }
});

const handleToggle = async (
  pluginId: string,
  enabled: boolean,
): Promise<void> => {
  const previous = [...localPluginIds.value];

  if (enabled) {
    if (!localPluginIds.value.includes(pluginId)) {
      localPluginIds.value = [...localPluginIds.value, pluginId];
    }
  } else {
    localPluginIds.value = localPluginIds.value.filter((id) => id !== pluginId);
  }

  podStore.updatePodPlugins(props.podId, localPluginIds.value);

  const canvasId = getActiveCanvasIdOrWarn("PodPluginSubMenu");
  if (!canvasId) {
    // 回滾
    localPluginIds.value = previous;
    podStore.updatePodPlugins(props.podId, previous);
    return;
  }

  try {
    await updatePodPluginsApi(canvasId, props.podId, localPluginIds.value);
  } catch {
    // 失敗時回滾
    localPluginIds.value = previous;
    podStore.updatePodPlugins(props.podId, previous);
    toast({
      title: "Plugin 設定失敗",
      description: "無法更新 Pod Plugin 設定，請稍後再試",
      variant: "destructive",
    });
  }
};
</script>

<template>
  <div
    class="bg-card border border-doodle-ink rounded-md p-1 fixed z-50 min-w-48"
    :style="{
      left: `${position.x}px`,
      top: `${position.y}px`,
    }"
    @click.stop
    @mouseenter="emit('cancel-close')"
    @mouseleave="emit('close')"
  >
    <div
      v-if="installedPlugins.length === 0"
      class="px-2 py-1 text-xs text-muted-foreground font-mono"
    >
      尚未安裝任何 Plugin
    </div>
    <ScrollArea v-else class="max-h-60">
      <div class="space-y-1 pr-1">
        <div
          v-for="plugin in installedPlugins"
          :key="plugin.id"
          class="flex items-center justify-between gap-3 px-2 py-1 rounded hover:bg-secondary cursor-pointer"
          @click.stop="
            handleToggle(plugin.id, !localPluginIds.includes(plugin.id))
          "
        >
          <div>
            <p class="text-xs font-mono">{{ plugin.name }}</p>
            <p class="text-xs text-muted-foreground font-mono">
              v{{ plugin.version }}
            </p>
          </div>
          <Switch
            :model-value="localPluginIds.includes(plugin.id)"
            @click.stop
            @update:model-value="(val: boolean) => handleToggle(plugin.id, val)"
          />
        </div>
      </div>
    </ScrollArea>
  </div>
</template>
