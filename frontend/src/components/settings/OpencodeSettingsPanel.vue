<script setup lang="ts">
import { onMounted } from "vue";
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
import type { OpencodeModelAlias } from "@/types/opencode";
import { useOpencodeProviderPanel } from "@/composables/settings/useOpencodeProviderPanel";
import { useOpencodeAliasEditor } from "@/composables/settings/useOpencodeAliasEditor";
import OpencodeAliasRow from "./OpencodeAliasRow.vue";
import { VueDraggable } from "vue-draggable-plus";

const { t } = useI18n();
const {
  providers,
  connected,
  loadState,
  providerSearch,
  restarting,
  connectedProviders,
  sortedFilteredProviders,
  loadFromBackend,
  handleRestartOpencode,
  isConnectedProvider,
} = useOpencodeProviderPanel();

const {
  editingAliasId,
  draftRows,
  aliasListsByProvider,
  deleteConfirmOpen,
  pendingDeleteAlias,
  savingDraftProviderIds,
  refreshingAliasIds,
  draftSelectableModelsByProvider,
  firstDraftSelectableModelIDByProvider,
  editableSelectableModelsByAliasId,
  aliasCountByProvider,
  isProviderExpanded,
  setProviderExpanded,
  handleAddClick,
  handleDraftSave,
  handleDraftCancel,
  handleStartEdit,
  handleCancelEdit,
  handleEditSave,
  handleRefreshPresets,
  handleDeleteClick,
  setDeleteConfirmOpen,
  handleDeleteConfirm,
  updateAliasListForProvider,
  handleAliasReorder,
} = useOpencodeAliasEditor({ providers, connected });

onMounted(() => {
  loadFromBackend();
});
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
              (draftSelectableModelsByProvider[provider.id] ?? []).length === 0
            "
            :aria-label="t('llmProvider.opencode.aliases.addModelTooltip')"
            :title="t('llmProvider.opencode.aliases.addModelTooltip')"
            @click.stop="
              handleAddClick(
                provider.id,
                firstDraftSelectableModelIDByProvider[provider.id] ?? '',
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
                  v-for="model in draftSelectableModelsByProvider[
                    provider.id
                  ] ?? []"
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
              (aliasCountByProvider[provider.id] ?? 0) === 0 &&
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
                updateAliasListForProvider(provider.id, list)
            "
            @end="() => handleAliasReorder(provider.id)"
          >
            <OpencodeAliasRow
              v-for="aliasItem in aliasListsByProvider[provider.id] ?? []"
              :key="aliasItem.id"
              :alias="aliasItem"
              :models="editableSelectableModelsByAliasId[aliasItem.id] ?? []"
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
        :class="{ 'opacity-50': !isConnectedProvider(provider.id) }"
      >
        <span class="text-sm font-medium">{{ provider.name }}</span>

        <!-- 已登入 badge -->
        <span
          v-if="isConnectedProvider(provider.id)"
          class="text-xs text-green-600 font-medium"
        >
          {{ t("llmProvider.opencode.providerList.connected") }}
        </span>
      </div>
    </template>
  </div>

  <!-- 刪除確認 Dialog -->
  <Dialog
    :open="deleteConfirmOpen"
    @update:open="setDeleteConfirmOpen"
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
          @click="setDeleteConfirmOpen(false)"
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
