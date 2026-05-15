<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GripVertical } from "lucide-vue-next";
import type { OpencodeModelAlias, OpencodeModelInfo } from "@/types/opencode";

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  alias: OpencodeModelAlias;
  /** 此 provider 支援的 model 列表，作為下拉選項 */
  models: OpencodeModelInfo[];
  /** 是否處於編輯態 */
  editing: boolean;
}

const props = defineProps<Props>();

// ── Emits ─────────────────────────────────────────────────────────────────────

const emit = defineEmits<{
  save: [payload: { modelID: string; alias: string }];
  delete: [];
  startEdit: [];
  cancelEdit: [];
  dragstart: [event: DragEvent];
  dragover: [event: DragEvent];
  drop: [event: DragEvent];
  dragend: [];
}>();

// ── 本地編輯狀態 ───────────────────────────────────────────────────────────────

const { t } = useI18n();

const editModelID = ref(props.alias.modelID);
const editAlias = ref(props.alias.alias);

// 進入編輯態時同步最新值
watch(
  () => props.editing,
  (val) => {
    if (val) {
      editModelID.value = props.alias.modelID;
      editAlias.value = props.alias.alias;
    }
  },
);

const handleSave = (): void => {
  emit("save", { modelID: editModelID.value, alias: editAlias.value });
};

const handleCancel = (): void => {
  emit("cancelEdit");
};

const handleStartEdit = (): void => {
  emit("startEdit");
};

const handleDelete = (): void => {
  emit("delete");
};

// ── 拖曳 handlers ─────────────────────────────────────────────────────────────

const handleDragStart = (event: DragEvent): void => {
  emit("dragstart", event);
};

const handleDragOver = (event: DragEvent): void => {
  event.preventDefault();
  emit("dragover", event);
};

const handleDrop = (event: DragEvent): void => {
  event.preventDefault();
  emit("drop", event);
};

const handleDragEnd = (): void => {
  emit("dragend");
};
</script>

<template>
  <div
    class="flex items-start gap-2 rounded-md border border-border p-2"
    draggable="true"
    @dragstart="handleDragStart"
    @dragover="handleDragOver"
    @drop="handleDrop"
    @dragend="handleDragEnd"
  >
    <!-- 拖曳把手 -->
    <div class="mt-1 cursor-grab active:cursor-grabbing text-muted-foreground">
      <GripVertical class="h-4 w-4" />
    </div>

    <!-- 非編輯態 -->
    <template v-if="!editing">
      <div class="flex flex-1 items-center justify-between gap-2">
        <div class="flex flex-col gap-0.5">
          <span class="text-sm font-medium">{{ alias.alias }}</span>
          <span class="text-xs text-muted-foreground">{{ alias.modelID }}</span>
        </div>
        <div class="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            class="h-7 px-2"
            @click="handleStartEdit"
          >
            {{ t("common.edit") }}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 px-2 text-destructive hover:text-destructive"
            @click="handleDelete"
          >
            {{ t("common.delete") }}
          </Button>
        </div>
      </div>
    </template>

    <!-- 編輯態 -->
    <template v-else>
      <div class="flex flex-1 flex-col gap-2">
        <!-- model id 下拉（使用專案 Select 元件） -->
        <div class="flex flex-col gap-1">
          <label class="text-xs text-muted-foreground">
            {{ t("llmProvider.opencode.aliases.modelIdLabel") }}
          </label>
          <Select v-model="editModelID">
            <SelectTrigger class="h-8 text-sm">
              <SelectValue
                :placeholder="
                  t('llmProvider.opencode.aliases.modelIdPlaceholder')
                "
              />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem
                v-for="model in models"
                :key="model.id"
                :value="model.id"
              >
                {{ model.name || model.id }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- alias input -->
        <div class="flex flex-col gap-1">
          <label class="text-xs text-muted-foreground">
            {{ t("llmProvider.opencode.aliases.aliasLabel") }}
          </label>
          <input
            v-model="editAlias"
            :placeholder="t('llmProvider.opencode.aliases.aliasPlaceholder')"
            class="w-full rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <!-- 儲存 / 取消按鈕 -->
        <div class="flex items-center gap-1 justify-end">
          <Button
            variant="outline"
            size="sm"
            class="h-7 px-2"
            @click="handleCancel"
          >
            {{ t("common.cancel") }}
          </Button>
          <Button size="sm" class="h-7 px-2" @click="handleSave">
            {{ t("common.save") }}
          </Button>
        </div>
      </div>
    </template>
  </div>
</template>
