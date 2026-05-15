<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Search } from "lucide-vue-next";
import * as opencodeApi from "@/services/opencodeApi";
import type { OpencodeProviderInfo } from "@/types/opencode";
import { useOpencodeAliasStore } from "@/stores/opencodeAliasStore";
import { useToast } from "@/composables/useToast";
import OpencodeAliasRow from "./OpencodeAliasRow.vue";

const { t } = useI18n();
const opencodeAliasStore = useOpencodeAliasStore();
const { toast } = useToast();

// ── local state ──────────────────────────────────────────────────
type LoadState = "loading" | "loaded" | "error";

const providers = ref<OpencodeProviderInfo[]>([]);
const connected = ref<string[]>([]);
const loadState = ref<LoadState>("loading");

/** Provider 清單搜尋字串（case-insensitive 比對 name/id） */
const providerSearch = ref("");

// ── alias 區塊狀態 ────────────────────────────────────────────────

/** 目前編輯中的 alias id（全域唯一，一次只能編輯一筆） */
const editingAliasId = ref<string | null>(null);

/**
 * 每個 provider 的 draft row（尚未儲存至 API 的新增筆）
 * key = providerID, value = { modelID, alias }
 */
interface DraftRow {
  modelID: string;
  alias: string;
}
const draftRows = ref<Record<string, DraftRow | null>>({});

/** 正在進行拖曳的 alias id */
const draggingAliasId = ref<string | null>(null);

/** 刪除確認 Dialog 狀態 */
const deleteConfirmOpen = ref(false);
const pendingDeleteId = ref<string | null>(null);
const pendingDeleteAlias = ref<string>("");

// ── 已連線的 provider 資訊 ────────────────────────────────────────

const connectedProviders = computed<OpencodeProviderInfo[]>(() =>
  providers.value.filter((p) => connected.value.includes(p.id)),
);

/** 依搜尋字串過濾後的 provider 清單，trim 後若為空則顯示全部 */
const filteredProviders = computed<OpencodeProviderInfo[]>(() => {
  const keyword = providerSearch.value.trim().toLowerCase();
  if (keyword === "") return providers.value;
  return providers.value.filter(
    (p) =>
      p.name.toLowerCase().includes(keyword) ||
      p.id.toLowerCase().includes(keyword),
  );
});

// ── 資料載入 ─────────────────────────────────────────────────────
const loadFromBackend = async (): Promise<void> => {
  loadState.value = "loading";
  try {
    const result = await opencodeApi.listOpencodeProviders();
    providers.value = result.all;
    connected.value = result.connected;
    loadState.value = "loaded";
  } catch {
    loadState.value = "error";
  }
};

onMounted(() => {
  loadFromBackend();
});

// ── alias CRUD handlers ───────────────────────────────────────────

/** 點「新增 model」按鈕：在該 provider 建立 draft row */
const handleAddClick = (providerID: string, firstModelID: string): void => {
  draftRows.value = {
    ...draftRows.value,
    [providerID]: { modelID: firstModelID, alias: "" },
  };
};

/** draft row 儲存 */
const handleDraftSave = async (
  providerID: string,
  payload: { modelID: string; alias: string },
): Promise<void> => {
  // 唯一性檢查
  const isUnique = opencodeAliasStore.isAliasUnique(providerID, payload.alias);
  if (!isUnique) {
    toast({
      title: t("llmProvider.opencode.aliases.aliasDuplicateError"),
      variant: "destructive",
    });
    return;
  }

  // 計算新 sortOrder（排在最後）
  const existing = opencodeAliasStore.aliasesByProvider(providerID);
  const sortOrder =
    existing.length > 0 ? Math.max(...existing.map((a) => a.sortOrder)) + 1 : 0;

  try {
    await opencodeAliasStore.addAlias({
      providerID,
      modelID: payload.modelID,
      alias: payload.alias,
      sortOrder,
    });
    // 成功：移除 draft row
    draftRows.value = { ...draftRows.value, [providerID]: null };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    toast({
      title: t("llmProvider.opencode.aliases.actionFailed", { reason }),
      variant: "destructive",
    });
    // draft row 保留，方便使用者重試
  }
};

/** draft row 取消 */
const handleDraftCancel = (providerID: string): void => {
  draftRows.value = { ...draftRows.value, [providerID]: null };
};

/** 進入編輯態 */
const handleStartEdit = (aliasId: string): void => {
  editingAliasId.value = aliasId;
};

/** 取消編輯 */
const handleCancelEdit = (): void => {
  editingAliasId.value = null;
};

/** 儲存編輯 */
const handleEditSave = async (
  aliasId: string,
  providerID: string,
  payload: { modelID: string; alias: string },
): Promise<void> => {
  // 唯一性檢查（排除自身）
  const isUnique = opencodeAliasStore.isAliasUnique(
    providerID,
    payload.alias,
    aliasId,
  );
  if (!isUnique) {
    toast({
      title: t("llmProvider.opencode.aliases.aliasDuplicateError"),
      variant: "destructive",
    });
    return; // 保留編輯態
  }

  try {
    await opencodeAliasStore.editAlias({
      id: aliasId,
      modelID: payload.modelID,
      alias: payload.alias,
    });
    editingAliasId.value = null;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    toast({
      title: t("llmProvider.opencode.aliases.actionFailed", { reason }),
      variant: "destructive",
    });
    // 保留編輯態，讓使用者重試
  }
};

/** 點刪除按鈕：彈出確認 Dialog */
const handleDeleteClick = (aliasId: string, aliasName: string): void => {
  pendingDeleteId.value = aliasId;
  pendingDeleteAlias.value = aliasName;
  deleteConfirmOpen.value = true;
};

/** 確認刪除 */
const handleDeleteConfirm = async (): Promise<void> => {
  if (!pendingDeleteId.value) return;
  const id = pendingDeleteId.value;
  deleteConfirmOpen.value = false;

  try {
    await opencodeAliasStore.removeAlias(id);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    toast({
      title: t("llmProvider.opencode.aliases.actionFailed", { reason }),
      variant: "destructive",
    });
  } finally {
    pendingDeleteId.value = null;
    pendingDeleteAlias.value = "";
  }
};

// ── 拖曳重排 ──────────────────────────────────────────────────────

/** dragstart：記錄被拖曳的 id */
const handleAliasDragStart = (aliasId: string, event: DragEvent): void => {
  draggingAliasId.value = aliasId;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", aliasId);
  }
};

/** drop 在某個 row 上：重新排列並呼叫 reorder API */
const handleAliasDrop = async (
  targetAliasId: string,
  providerID: string,
): Promise<void> => {
  const dragId = draggingAliasId.value;
  if (!dragId || dragId === targetAliasId) return;

  const currentList = opencodeAliasStore.aliasesByProvider(providerID);
  const ids = currentList.map((a) => a.id);

  // 從舊位置移除 dragId，插入 targetAliasId 之前
  const filtered = ids.filter((id) => id !== dragId);
  const targetIndex = filtered.indexOf(targetAliasId);
  filtered.splice(targetIndex, 0, dragId);

  try {
    await opencodeAliasStore.reorder(filtered);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    toast({
      title: t("llmProvider.opencode.aliases.actionFailed", { reason }),
      variant: "destructive",
    });
    // 還原順序：後端 reorder 失敗時 store 不會改變（action rethrows 前不 mutate），
    // 畫面依然是 aliasesByProvider 的值，不需手動還原。
  }

  draggingAliasId.value = null;
};

/** dragend：清除拖曳狀態 */
const handleAliasDragEnd = (): void => {
  draggingAliasId.value = null;
};
</script>

<template>
  <!-- 上半：Model 對應表（優先顯示） -->
  <div
    v-if="loadState === 'loaded' && connectedProviders.length > 0"
    class="space-y-4"
  >
    <!-- 標題 -->
    <span class="font-medium text-sm">
      {{ t("llmProvider.opencode.aliases.title") }}
    </span>

    <!-- 每個 connected provider 一個摺疊區塊 -->
    <div
      v-for="provider in connectedProviders"
      :key="provider.id"
      class="space-y-2"
    >
      <!-- Provider 名稱 + 新增按鈕 -->
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium text-muted-foreground">
          {{ provider.name }}
        </span>
        <Button
          variant="outline"
          size="sm"
          class="h-7 px-2 text-xs"
          @click="handleAddClick(provider.id, provider.models[0]?.id ?? '')"
        >
          {{ t("llmProvider.opencode.aliases.addButton") }}
        </Button>
      </div>

      <!-- Draft row（新增中） -->
      <div
        v-if="draftRows[provider.id]"
        class="rounded-md border border-dashed border-border p-2 space-y-2"
      >
        <!-- model id 下拉（使用專案 Select 元件） -->
        <div class="flex flex-col gap-1">
          <label class="text-xs text-muted-foreground">
            {{ t("llmProvider.opencode.aliases.modelIdLabel") }}
          </label>
          <Select v-model="draftRows[provider.id]!.modelID">
            <SelectTrigger class="h-8 text-sm">
              <SelectValue
                :placeholder="
                  t('llmProvider.opencode.aliases.modelIdPlaceholder')
                "
              />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem
                v-for="model in provider.models"
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
            v-model="draftRows[provider.id]!.alias"
            :placeholder="t('llmProvider.opencode.aliases.aliasPlaceholder')"
            class="w-full rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
        </div>

        <!-- 儲存 / 取消 -->
        <div class="flex items-center gap-1 justify-end">
          <Button
            variant="outline"
            size="sm"
            class="h-7 px-2"
            @click="handleDraftCancel(provider.id)"
          >
            {{ t("common.cancel") }}
          </Button>
          <Button
            size="sm"
            class="h-7 px-2"
            @click="handleDraftSave(provider.id, draftRows[provider.id]!)"
          >
            {{ t("common.save") }}
          </Button>
        </div>
      </div>

      <!-- Alias row 列表 -->
      <div class="space-y-1">
        <!-- 空狀態提示 -->
        <p
          v-if="
            opencodeAliasStore.aliasesByProvider(provider.id).length === 0 &&
              !draftRows[provider.id]
          "
          class="text-xs text-muted-foreground py-1"
        >
          {{ t("llmProvider.opencode.aliases.reorderHint") }}
        </p>

        <OpencodeAliasRow
          v-for="aliasItem in opencodeAliasStore.aliasesByProvider(provider.id)"
          :key="aliasItem.id"
          :alias="aliasItem"
          :models="provider.models"
          :editing="editingAliasId === aliasItem.id"
          @start-edit="handleStartEdit(aliasItem.id)"
          @cancel-edit="handleCancelEdit"
          @save="
            (payload) => handleEditSave(aliasItem.id, provider.id, payload)
          "
          @delete="handleDeleteClick(aliasItem.id, aliasItem.alias)"
          @dragstart="(event) => handleAliasDragStart(aliasItem.id, event)"
          @dragover="() => {}"
          @drop="() => handleAliasDrop(aliasItem.id, provider.id)"
          @dragend="handleAliasDragEnd"
        />
      </div>
    </div>
  </div>

  <!-- 下半：Provider 清單區塊 -->
  <div class="mt-6 space-y-3">
    <!-- 標題列 -->
    <div class="flex items-center justify-between">
      <span class="font-medium text-sm">
        {{ t("llmProvider.opencode.providerList.title") }}
      </span>
      <Button
        variant="outline"
        size="sm"
        :disabled="loadState === 'loading'"
        @click="loadFromBackend"
      >
        <Loader2
          v-if="loadState === 'loading'"
          class="mr-1.5 h-3.5 w-3.5 animate-spin"
        />
        {{ t("llmProvider.opencode.providerList.refresh") }}
      </Button>
    </div>

    <!-- 搜尋框（loaded 且有 provider 時顯示） -->
    <div
      v-if="loadState === 'loaded' && providers.length > 0"
      class="relative"
    >
      <Search
        class="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
      />
      <Input
        v-model="providerSearch"
        :placeholder="t('llmProvider.opencode.providerList.searchPlaceholder')"
        class="pl-8 h-9 text-sm"
      />
    </div>

    <!-- 錯誤狀態 -->
    <div
      v-if="loadState === 'error'"
      class="rounded-md border border-destructive/30 bg-destructive/10 p-3 space-y-2"
    >
      <p class="text-sm text-destructive">
        {{ t("llmProvider.opencode.providerList.loadError") }}
      </p>
      <Button
        variant="outline"
        size="sm"
        @click="loadFromBackend"
      >
        {{ t("llmProvider.opencode.providerList.retry") }}
      </Button>
    </div>

    <!-- 載入中 / 已載入 狀態 -->
    <template v-else>
      <!-- 完全沒有 Provider 的空白提示 -->
      <p
        v-if="loadState === 'loaded' && providers.length === 0"
        class="text-sm text-muted-foreground"
      >
        {{ t("llmProvider.opencode.providerList.empty") }}
      </p>

      <!-- 搜尋後找不到的提示 -->
      <p
        v-else-if="loadState === 'loaded' && filteredProviders.length === 0"
        class="text-sm text-muted-foreground"
      >
        {{ t("llmProvider.opencode.providerList.noMatch") }}
      </p>

      <!-- provider 列表（依搜尋結果過濾） -->
      <div
        v-for="provider in filteredProviders"
        :key="provider.id"
        class="flex items-center justify-between rounded-md border border-border p-3"
        :class="{ 'opacity-50': !connected.includes(provider.id) }"
      >
        <span class="text-sm font-medium">{{ provider.name }}</span>

        <!-- 已登入 badge -->
        <span
          v-if="connected.includes(provider.id)"
          class="text-xs text-green-600 dark:text-green-400 font-medium"
        >
          {{ t("llmProvider.opencode.providerList.connected") }}
        </span>

        <!-- 未登入提示 -->
        <span
          v-else
          class="text-xs text-muted-foreground"
        >
          {{
            t("llmProvider.opencode.providerList.disabledHint", {
              id: provider.id,
            })
          }}
        </span>
      </div>
    </template>
  </div>

  <!-- 刪除確認 Dialog -->
  <Dialog
    :open="deleteConfirmOpen"
    @update:open="deleteConfirmOpen = false"
  >
    <DialogContent class="max-w-sm">
      <DialogHeader>
        <DialogTitle>
          {{ t("llmProvider.opencode.aliases.deleteConfirmTitle") }}
        </DialogTitle>
        <DialogDescription>
          {{
            t("llmProvider.opencode.aliases.deleteConfirmMessage", {
              alias: pendingDeleteAlias,
            })
          }}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button
          variant="outline"
          @click="deleteConfirmOpen = false"
        >
          {{ t("common.cancel") }}
        </Button>
        <Button
          variant="destructive"
          @click="handleDeleteConfirm"
        >
          {{ t("common.delete") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
