<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Switch } from "@/components/ui/switch";
import type { McpDisplayStatus, McpTransport } from "@/types/mcp";

/** MCP server 列表中的單一行元件，支援三種顯示模式：
 * - readonly=true（Codex）：只展示名稱與 type chip，無 Switch
 * - locked=true（Goal built-in）：固定啟用，顯示 badge，不可切換
 * - readonly=false：名稱 + 可選 type chip + Switch
 */
const props = defineProps<{
  name: string;
  label?: string;
  transport?: McpTransport;
  status?: McpDisplayStatus;
  checked: boolean;
  disabled: boolean;
  readonly: boolean;
  locked?: boolean;
  lockedLabel?: string;
  disabledReason?: string | null;
}>();

const emit = defineEmits<{
  toggle: [name: string, value: boolean];
}>();

const { t } = useI18n();

const transportLabel = computed(() =>
  props.transport ? t(`managedMcp.transport.${props.transport}`) : null,
);

const statusLabel = computed(() =>
  props.status ? t(`managedMcp.status.${props.status}`) : null,
);

const statusClass = computed(() => {
  switch (props.status) {
    case "healthy":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "starting":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "error":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "running":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "completed":
      return "border-violet-200 bg-violet-50 text-violet-700";
    case "blocked":
      return "border-orange-200 bg-orange-50 text-orange-700";
    case "disabled":
      return "border-zinc-200 bg-zinc-100 text-zinc-700";
    case "idle":
      return "border-slate-200 bg-slate-100 text-slate-700";
    case "unknown":
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
});
</script>

<template>
  <div
    class="group relative flex items-start justify-between gap-3 rounded px-2 py-1"
    :class="{
      'opacity-75': props.disabled && !props.locked,
      'hover:bg-secondary': !props.readonly,
    }"
  >
    <div class="min-w-0 flex-1">
      <p class="truncate text-xs font-mono">
        {{ props.label ?? props.name }}
      </p>
      <p
        v-if="props.disabledReason"
        class="mt-0.5 text-[10px] font-mono text-muted-foreground"
        data-testid="mcp-disabled-reason"
      >
        {{ props.disabledReason }}
      </p>
    </div>
    <div class="flex items-center gap-1">
      <span
        v-if="transportLabel"
        data-testid="mcp-transport-badge"
        class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono text-muted-foreground bg-secondary"
      >
        {{ transportLabel }}
      </span>
      <span
        v-if="statusLabel"
        data-testid="mcp-status-badge"
        class="inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-mono"
        :class="statusClass"
      >
        {{ statusLabel }}
      </span>
      <span
        v-if="props.locked"
        data-testid="mcp-locked-badge"
        class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono text-primary bg-secondary"
      >
        {{ props.lockedLabel }}
      </span>
      <span
        v-else-if="props.readonly"
        class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-mono text-green-600"
      >
        ✓
      </span>
      <Switch
        v-else-if="!props.readonly"
        :model-value="props.checked"
        :disabled="props.disabled"
        @click.stop
        @update:model-value="(val: boolean) => emit('toggle', props.name, val)"
      />
    </div>
  </div>
</template>
