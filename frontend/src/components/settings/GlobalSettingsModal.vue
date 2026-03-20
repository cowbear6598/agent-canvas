<script setup lang="ts">
import { ref, watch } from "vue";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getConfig, updateConfig } from "@/services/configApi";
import { listPlugins } from "@/services/pluginApi";
import { MODEL_OPTIONS } from "@/types";
import type { ModelType } from "@/types/pod";
import type { InstalledPlugin } from "@/types/plugin";
import { useToast } from "@/composables/useToast";
import { useWebSocketErrorHandler } from "@/composables/useWebSocketErrorHandler";

interface Props {
  open: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const { showSuccessToast } = useToast();
const { withErrorToast } = useWebSocketErrorHandler();

const summaryModel = ref<ModelType>("sonnet");
const aiDecideModel = ref<ModelType>("sonnet");
const installedPlugins = ref<InstalledPlugin[]>([]);
const enabledPluginIds = ref<string[]>([]);
const isLoading = ref<boolean>(false);
const isSaving = ref<boolean>(false);
const loadFailed = ref<boolean>(false);

const loadConfig = async (): Promise<void> => {
  isLoading.value = true;
  loadFailed.value = false;
  // 非同步載入 Plugin 列表，不阻塞 config 載入
  listPlugins()
    .then((plugins) => {
      installedPlugins.value = plugins;
    })
    .catch(() => {
      installedPlugins.value = [];
    });
  try {
    const result = await withErrorToast(getConfig(), "Config", "載入失敗");
    if (!result) {
      loadFailed.value = true;
      return;
    }
    if (result.summaryModel) summaryModel.value = result.summaryModel;
    if (result.aiDecideModel) aiDecideModel.value = result.aiDecideModel;
    if (result.enabledPluginIds)
      enabledPluginIds.value = result.enabledPluginIds;
  } finally {
    isLoading.value = false;
  }
};

const togglePlugin = (pluginId: string, enabled: boolean): void => {
  if (enabled) {
    if (!enabledPluginIds.value.includes(pluginId)) {
      enabledPluginIds.value = [...enabledPluginIds.value, pluginId];
    }
  } else {
    enabledPluginIds.value = enabledPluginIds.value.filter(
      (id) => id !== pluginId,
    );
  }
};

const handleSave = async (): Promise<void> => {
  isSaving.value = true;
  try {
    const result = await withErrorToast(
      updateConfig({
        summaryModel: summaryModel.value,
        aiDecideModel: aiDecideModel.value,
        enabledPluginIds: enabledPluginIds.value,
      }),
      "Config",
      "儲存失敗",
    );
    if (result) {
      showSuccessToast("Config", "儲存成功");
      emit("update:open", false);
    }
  } finally {
    isSaving.value = false;
  }
};

const handleClose = (): void => {
  emit("update:open", false);
};

watch(
  () => props.open,
  (newVal) => {
    if (newVal) {
      loadConfig();
    }
  },
  { immediate: true },
);
</script>

<template>
  <Dialog :open="open" @update:open="handleClose">
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>全域設定</DialogTitle>
        <DialogDescription>管理模型與全域參數設定</DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-2">
        <div class="space-y-2">
          <Label>總結模型</Label>
          <p class="text-xs text-muted-foreground">工作流總結時使用的模型</p>
          <Select v-model="summaryModel">
            <SelectTrigger>
              <SelectValue placeholder="選擇模型" />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem
                v-for="option in MODEL_OPTIONS"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div class="space-y-2">
          <Label>AI 決策模型</Label>
          <p class="text-xs text-muted-foreground">
            AI Decide 連線判斷時使用的模型
          </p>
          <Select v-model="aiDecideModel">
            <SelectTrigger>
              <SelectValue placeholder="選擇模型" />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem
                v-for="option in MODEL_OPTIONS"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div class="space-y-2">
          <Label>Plugin 管理</Label>
          <p class="text-xs text-muted-foreground">
            啟用的 Plugin 將對所有 Pod 生效
          </p>
          <div
            v-if="installedPlugins.length === 0"
            class="text-xs text-muted-foreground py-2"
          >
            尚未安裝任何 Plugin，請透過 Claude Code CLI 安裝
          </div>
          <ScrollArea v-else class="h-40">
            <div class="space-y-3 pr-3">
              <div
                v-for="plugin in installedPlugins"
                :key="plugin.id"
                class="flex items-center justify-between"
              >
                <div>
                  <Label>{{ plugin.name }}</Label>
                  <p class="text-xs text-muted-foreground">
                    v{{ plugin.version }}
                  </p>
                </div>
                <Switch
                  :model-value="enabledPluginIds.includes(plugin.id)"
                  @update:model-value="
                    (val: boolean) => togglePlugin(plugin.id, val)
                  "
                />
              </div>
            </div>
          </ScrollArea>
        </div>
      </div>

      <DialogFooter>
        <Button
          :disabled="isLoading || isSaving || loadFailed"
          @click="handleSave"
        >
          {{ isSaving ? "儲存中..." : "儲存" }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
