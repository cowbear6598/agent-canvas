<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Plus, RefreshCw } from "lucide-vue-next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import type { ManagedMcpRegistryItem } from "@/types/mcp";
import McpStatusBadge from "./McpStatusBadge.vue";

interface Props {
  registry: ManagedMcpRegistryItem[];
  selectedId: string | null;
  loading: boolean;
  showRefreshSpinner: boolean;
  showInitialLoading: boolean;
}

defineProps<Props>();

const emit = defineEmits<{
  select: [item: ManagedMcpRegistryItem];
  create: [];
  refresh: [];
  "quick-toggle": [item: ManagedMcpRegistryItem, enabled: boolean];
}>();

const { t } = useI18n();
</script>

<template>
  <aside
    class="flex min-h-[18rem] flex-col rounded-xl border border-doodle-ink/20 bg-muted/20 lg:w-[20rem]"
  >
    <div class="flex items-center justify-between gap-2 px-3 py-2">
      <span class="text-sm font-semibold">
        {{ t("managedMcp.list.title") }}
      </span>
      <div class="flex items-center gap-2">
        <button
          data-testid="managed-mcp-new"
          class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-doodle-ink/20 bg-card text-foreground transition hover:bg-accent"
          :title="t('managedMcp.actions.create')"
          @click="emit('create')"
        >
          <Plus class="h-4 w-4" />
        </button>
        <button
          data-testid="managed-mcp-refresh"
          class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-doodle-ink/20 bg-card text-foreground transition hover:bg-accent"
          :title="t('managedMcp.actions.refresh')"
          :disabled="loading"
          @click="emit('refresh')"
        >
          <RefreshCw
            class="h-4 w-4"
            :class="{ 'animate-spin': showRefreshSpinner }"
          />
        </button>
      </div>
    </div>

    <div
      v-if="showInitialLoading"
      class="px-4 py-6 text-sm text-muted-foreground"
    >
      {{ t("common.loading") }}
    </div>

    <ScrollArea
      v-else
      class="h-[18rem] lg:h-[32rem]"
    >
      <div class="space-y-2 p-3">
        <div
          v-for="item in registry"
          :key="item.id"
          :data-testid="`managed-mcp-entry-${item.id}`"
          role="button"
          tabindex="0"
          :class="[
            'w-full cursor-pointer rounded-xl border px-3 py-2 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            selectedId === item.id
              ? 'border-primary bg-primary/5 shadow-sm'
              : 'border-doodle-ink/15 bg-card hover:border-doodle-ink/30 hover:bg-accent/30',
          ]"
          @click="emit('select', item)"
          @keydown.enter.prevent="emit('select', item)"
          @keydown.space.prevent="emit('select', item)"
        >
          <div class="flex items-center gap-2">
            <p
              class="min-w-0 flex-1 truncate text-sm font-semibold text-foreground"
            >
              {{ item.name }}
            </p>
            <McpStatusBadge :status="item.status" />
            <Switch
              :model-value="item.enabled"
              :data-testid="`managed-mcp-quick-toggle-${item.id}`"
              :aria-label="t('managedMcp.form.enabled')"
              :disabled="loading || item.requiresSecretSetup"
              @click.stop
              @update:model-value="
                (val: boolean) => emit('quick-toggle', item, val)
              "
            />
          </div>

          <p
            v-if="item.requiresSecretSetup"
            class="mt-1.5 text-xs font-medium text-amber-700"
          >
            {{ t("managedMcp.form.secretsMissingShort") }}
          </p>

          <p
            v-if="item.lastError"
            class="mt-1.5 line-clamp-2 text-xs text-rose-700"
          >
            {{ item.lastError }}
          </p>
        </div>

        <!-- divider：僅在使用者已建立 MCP 時顯示，避免空 list 出現孤立分隔線 -->
        <div
          v-if="registry.length > 0"
          data-testid="managed-mcp-group-divider"
          class="my-1 border-t border-dashed border-doodle-ink/40"
        />

        <!-- 內建 Goal Runtime：固定顯示於最下方，純展示不可選 -->
        <div
          data-testid="managed-mcp-builtin-goal"
          class="w-full rounded-xl border border-doodle-ink/15 bg-card px-3 py-2"
        >
          <div class="flex items-center gap-2">
            <p
              class="min-w-0 flex-1 truncate text-sm font-semibold text-foreground"
            >
              {{ t("pod.slot.goalMcpLabel") }}
            </p>
            <span
              class="inline-flex shrink-0 items-center rounded-full border border-doodle-ink/15 bg-secondary px-2 py-0.5 text-[11px] font-mono text-primary"
            >
              {{ t("pod.slot.builtinBadge") }}
            </span>
          </div>
        </div>

        <!-- 內建 Plugin MCP：固定顯示於最下方，純展示不可選 -->
        <div
          data-testid="managed-mcp-builtin-plugin"
          class="w-full rounded-xl border border-doodle-ink/15 bg-card px-3 py-2"
        >
          <div class="flex items-center gap-2">
            <p
              class="min-w-0 flex-1 truncate text-sm font-semibold text-foreground"
            >
              {{ t("pod.slot.pluginMcpLabel") }}
            </p>
            <span
              class="inline-flex shrink-0 items-center rounded-full border border-doodle-ink/15 bg-secondary px-2 py-0.5 text-[11px] font-mono text-primary"
            >
              {{ t("pod.slot.builtinBadge") }}
            </span>
          </div>
        </div>
      </div>
    </ScrollArea>
  </aside>
</template>
