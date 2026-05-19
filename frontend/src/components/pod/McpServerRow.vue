<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Switch } from "@/components/ui/switch";
import type { McpTransport } from "@/types/mcp";

/** MCP server 列表中的單一行元件，支援兩種顯示模式：
 * - locked=true（Goal built-in 等系統 MCP）：固定啟用，顯示 badge，不可切換
 * - locked=false：名稱 + 可選 transport chip + disabledReason + Switch（managed registry）
 *
 * 不顯示 MCP runtime status：probe 結果只反映 registry probe 當下狀態，
 * 與 agent chat 實際 spawn 結果無關；診斷請看 registry 頁的 Test 按鈕與 run
 * ignored 通知。
 */
const props = defineProps<{
  name: string;
  label?: string;
  transport?: McpTransport;
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
