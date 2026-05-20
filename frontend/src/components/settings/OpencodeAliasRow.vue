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
</script>

<template>
  <div class="alias-card">
    <!-- 拖曳把手 -->
    <button
      type="button"
      class="alias-card__handle"
      :title="t('llmProvider.opencode.aliases.reorderHint')"
      @click.stop
    >
      <GripVertical class="h-4 w-4" />
    </button>

    <!-- 非編輯態 -->
    <template v-if="!editing">
      <div class="flex flex-1 items-center justify-between gap-2">
        <span
          class="text-sm font-medium font-mono truncate"
          :title="alias.modelID"
        >{{ alias.alias }}</span>
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
            class="w-full rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring font-mono"
          >
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
          <Button
            size="sm"
            class="h-7 px-2"
            @click="handleSave"
          >
            {{ t("common.save") }}
          </Button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.alias-card {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.625rem;
  border: 2px solid var(--doodle-ink);
  border-radius: 0.5rem;
  background: var(--card);
  font-family: var(--font-mono), monospace, sans-serif;
  transition: background 0.15s ease;
}

.alias-card__handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border: 2px solid var(--doodle-ink);
  background: var(--card);
  border-radius: 0.375rem;
  cursor: grab;
  flex-shrink: 0;
}

.alias-card__handle:active {
  cursor: grabbing;
}

.alias-card.sortable-ghost {
  opacity: 0.4;
  background: var(--doodle-sand);
}

.alias-card.sortable-chosen {
  box-shadow: 2px 3px 0 0 var(--doodle-ink);
}
</style>
