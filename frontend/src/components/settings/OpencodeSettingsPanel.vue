<script setup lang="ts">
import { ref, onMounted, computed, watch } from "vue";
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
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { Loader2, Search, ChevronDown, Plus } from "lucide-vue-next";
import * as opencodeApi from "@/services/opencodeApi";
import type {
  OpencodeProviderInfo,
  OpencodeModelAlias,
  OpencodeModelInfo,
} from "@/types/opencode";
import { useOpencodeAliasStore } from "@/stores/opencodeAliasStore";
import { useToast } from "@/composables/useToast";
import OpencodeAliasRow from "./OpencodeAliasRow.vue";
import { VueDraggable } from "vue-draggable-plus";

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

/** 每個 provider Card 是否展開（預設全部收合） */
const expandedProviders = ref<Record<string, boolean>>({});

/** VueDraggable v-model 用的本地可寫 alias 陣列，key = providerID */
const aliasListsByProvider = ref<Record<string, OpencodeModelAlias[]>>({});

const isProviderExpanded = (providerID: string): boolean =>
  !!expandedProviders.value[providerID];

const setProviderExpanded = (providerID: string, value: boolean): void => {
  expandedProviders.value[providerID] = value;
};

/** 刪除確認 Dialog 狀態 */
const deleteConfirmOpen = ref(false);
const pendingDeleteId = ref<string | null>(null);
const pendingDeleteAlias = ref<string>("");
const savingDraftProviderIds = ref<Set<string>>(new Set());
const refreshingAliasIds = ref<Set<string>>(new Set());

const setSavingDraft = (providerID: string, saving: boolean): void => {
  const next = new Set(savingDraftProviderIds.value);
  if (saving) {
    next.add(providerID);
  } else {
    next.delete(providerID);
  }
  savingDraftProviderIds.value = next;
};

const setRefreshingAlias = (aliasId: string, refreshing: boolean): void => {
  const next = new Set(refreshingAliasIds.value);
  if (refreshing) {
    next.add(aliasId);
  } else {
    next.delete(aliasId);
  }
  refreshingAliasIds.value = next;
};

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

/** 依連線狀態分組排序：已連線排前，未連線排後；兩組內部維持原順序。
 *  使用 Set 將 connected 轉為 O(1) 查詢，一次 reduce 完成 partition。
 */
const sortedFilteredProviders = computed<OpencodeProviderInfo[]>(() => {
  const connectedSet = new Set(connected.value);
  const groups = filteredProviders.value.reduce<{
    connected: OpencodeProviderInfo[];
    disconnected: OpencodeProviderInfo[];
  }>(
    (acc, p) => {
      if (connectedSet.has(p.id)) {
        acc.connected.push(p);
      } else {
        acc.disconnected.push(p);
      }
      return acc;
    },
    { connected: [], disconnected: [] },
  );
  return [...groups.connected, ...groups.disconnected];
});

const getSelectableModels = (
  providerID: string,
  models: OpencodeModelInfo[],
  excludeAliasId?: string,
): OpencodeModelInfo[] =>
  models.filter((model) =>
    opencodeAliasStore.isModelAliasUnique(
      providerID,
      model.id,
      excludeAliasId,
    ),
  );

const getFirstSelectableModelID = (
  providerID: string,
  models: OpencodeModelInfo[],
): string => getSelectableModels(providerID, models)[0]?.id ?? "";

// ── 資料載入 ─────────────────────────────────────────────────────

/**
 * 將 store 內指定 providerID 的 aliases 同步寫入本地可寫陣列，
 * 作為 VueDraggable v-model 的資料來源。
 * 使用 group-by Map 優化，避免對每個 provider 重複遍歷整個 aliases 陣列。
 */
const syncAliasListsFromStore = (providerIDs: string[]): void => {
  // 依 providerID group aliases 成 Map（只走訪一次）
  const grouped = opencodeAliasStore.aliases.reduce<
    Map<string, OpencodeModelAlias[]>
  >((map, alias) => {
    const list = map.get(alias.providerID);
    if (list) {
      list.push(alias);
    } else {
      map.set(alias.providerID, [alias]);
    }
    return map;
  }, new Map());

  for (const id of providerIDs) {
    const list = grouped.get(id) ?? [];
    // 依 orderIdx 排序後指派
    aliasListsByProvider.value[id] = [...list].sort(
      (a, b) => a.orderIdx - b.orderIdx,
    );
  }
};

const loadFromBackend = async (): Promise<void> => {
  loadState.value = "loading";
  try {
    const result = await opencodeApi.listOpencodeProviders();
    providers.value = result.all;
    connected.value = result.connected;
    loadState.value = "loaded";
    syncAliasListsFromStore(result.connected);
  } catch (err) {
    console.error("[OpencodeSettingsPanel] loadFromBackend 失敗：", err);
    loadState.value = "error";
  }
};

onMounted(() => {
  loadFromBackend();
});

/** store 內 aliases 變動時，同步更新本地陣列 */
watch(
  () => opencodeAliasStore.aliases,
  () => {
    syncAliasListsFromStore(connected.value);
  },
);

// ── alias CRUD handlers ───────────────────────────────────────────

/** 點「新增 model」按鈕：先展開 Card，再建立 draft row */
const handleAddClick = (providerID: string, firstModelID: string): void => {
  setProviderExpanded(providerID, true);
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
  // alias 唯一性檢查
  const isUnique = opencodeAliasStore.isAliasUnique(providerID, payload.alias);
  if (!isUnique) {
    toast({
      title: t("llmProvider.opencode.aliases.aliasDuplicateError"),
      variant: "destructive",
    });
    return;
  }

  try {
    setSavingDraft(providerID, true);
    await opencodeAliasStore.addAlias({
      providerID,
      modelID: payload.modelID,
      alias: payload.alias,
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
  } finally {
    setSavingDraft(providerID, false);
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
  // alias 唯一性檢查（排除自身）
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

const handleRefreshPresets = async (aliasId: string): Promise<void> => {
  try {
    setRefreshingAlias(aliasId, true);
    await opencodeAliasStore.refreshPresets(aliasId);
    toast({ title: t("llmProvider.opencode.aliases.refreshSuccess") });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    toast({
      title: t("llmProvider.opencode.aliases.refreshFailed", { reason }),
      variant: "destructive",
    });
  } finally {
    setRefreshingAlias(aliasId, false);
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

// ── 重新啟動 OpenCode ─────────────────────────────────────────────

const restarting = ref(false);

const handleRestartOpencode = async (): Promise<void> => {
  restarting.value = true;
  try {
    await opencodeApi.restartOpencodeServer();
    toast({ title: t("llmProvider.opencode.providerList.restartSuccess") });
    await loadFromBackend();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    toast({
      title: t("llmProvider.opencode.providerList.restartFailed", { reason }),
      variant: "destructive",
    });
  } finally {
    restarting.value = false;
  }
};

// ── 拖曳重排 ──────────────────────────────────────────────────────

/** VueDraggable @end：讀取本地陣列順序並呼叫 reorder API */
const handleAliasReorder = async (providerID: string): Promise<void> => {
  const ids = (aliasListsByProvider.value[providerID] ?? []).map((a) => a.id);
  try {
    await opencodeAliasStore.reorder(ids);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    toast({
      title: t("llmProvider.opencode.aliases.actionFailed", { reason }),
      variant: "destructive",
    });
    // 失敗時不手動還原本地陣列；store rethrow 後 aliases 未變動，
    // watch 將在下一個 tick 把本地陣列同步回正確順序。
  }
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

    <!-- 每個 connected provider 一個可摺疊 Card -->
    <Collapsible
      v-for="provider in connectedProviders"
      :key="provider.id"
      :open="isProviderExpanded(provider.id)"
      class="rounded-md border border-border"
      @update:open="(v) => setProviderExpanded(provider.id, v)"
    >
      <!-- 標題列 -->
      <CollapsibleTrigger
        as-child
        :aria-label="t('llmProvider.opencode.aliases.collapsibleTrigger')"
      >
        <div
          class="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-muted/50 rounded-md"
        >
          <div class="flex items-center gap-2">
            <ChevronDown
              class="h-4 w-4 text-muted-foreground transition-transform"
              :class="{ 'rotate-180': isProviderExpanded(provider.id) }"
            />
            <span class="text-sm font-medium">
              {{ provider.name }}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 w-7 p-0"
            :disabled="
              getSelectableModels(provider.id, provider.models).length === 0
            "
            :aria-label="t('llmProvider.opencode.aliases.addModelTooltip')"
            :title="t('llmProvider.opencode.aliases.addModelTooltip')"
            @click.stop="
              handleAddClick(
                provider.id,
                getFirstSelectableModelID(provider.id, provider.models),
              )
            "
          >
            <Plus class="h-4 w-4" />
          </Button>
        </div>
      </CollapsibleTrigger>

      <!-- 內容區 -->
      <CollapsibleContent class="px-3 py-3 space-y-2">
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
                  v-for="model in getSelectableModels(
                    provider.id,
                    provider.models,
                  )"
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
              :disabled="savingDraftProviderIds.has(provider.id)"
              @click="handleDraftSave(provider.id, draftRows[provider.id]!)"
            >
              <Loader2
                v-if="savingDraftProviderIds.has(provider.id)"
                class="mr-1 h-3.5 w-3.5 animate-spin"
              />
              {{
                savingDraftProviderIds.has(provider.id)
                  ? t("llmProvider.opencode.aliases.saving")
                  : t("common.save")
              }}
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
            {{ t("llmProvider.opencode.aliases.emptyHint") }}
          </p>

          <VueDraggable
            :model-value="aliasListsByProvider[provider.id] ?? []"
            handle=".alias-card__handle"
            :animation="180"
            ghost-class="sortable-ghost"
            chosen-class="sortable-chosen"
            class="flex flex-col gap-2"
            @update:model-value="
              (list: OpencodeModelAlias[]) =>
                (aliasListsByProvider[provider.id] = list)
            "
            @end="() => handleAliasReorder(provider.id)"
          >
            <OpencodeAliasRow
              v-for="aliasItem in aliasListsByProvider[provider.id] ?? []"
              :key="aliasItem.id"
              :alias="aliasItem"
              :models="
                getSelectableModels(provider.id, provider.models, aliasItem.id)
              "
              :editing="editingAliasId === aliasItem.id"
              :refreshing="refreshingAliasIds.has(aliasItem.id)"
              @start-edit="handleStartEdit(aliasItem.id)"
              @cancel-edit="handleCancelEdit"
              @save="
                (payload) => handleEditSave(aliasItem.id, provider.id, payload)
              "
              @refresh-presets="handleRefreshPresets(aliasItem.id)"
              @delete="handleDeleteClick(aliasItem.id, aliasItem.alias)"
            />
          </VueDraggable>
        </div>
      </CollapsibleContent>
    </Collapsible>
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
        :disabled="restarting || loadState === 'loading'"
        @click="handleRestartOpencode"
      >
        <Loader2
          v-if="restarting"
          class="mr-1.5 h-3.5 w-3.5 animate-spin"
        />
        {{
          restarting
            ? t("llmProvider.opencode.providerList.restartLoading")
            : t("llmProvider.opencode.providerList.restart")
        }}
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
        v-else-if="
          loadState === 'loaded' && sortedFilteredProviders.length === 0
        "
        class="text-sm text-muted-foreground"
      >
        {{ t("llmProvider.opencode.providerList.noMatch") }}
      </p>

      <!-- provider 列表（依搜尋結果過濾，已連線排前） -->
      <div
        v-for="provider in sortedFilteredProviders"
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
