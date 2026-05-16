<script setup lang="ts">
import { Switch } from "@/components/ui/switch";

/** MCP server 列表中的單一行元件，支援三種顯示模式：
 * - readonly=true（Codex）：只展示名稱與 type chip，無 Switch
 * - locked=true（Goal built-in）：固定啟用，顯示 badge，不可切換
 * - readonly=false：名稱 + 可選 type chip + Switch
 */
const props = defineProps<{
  name: string;
  type?: "stdio" | "http" | "sse";
  checked: boolean;
  disabled: boolean;
  readonly: boolean;
  locked?: boolean;
  badgeLabel?: string;
}>();

const emit = defineEmits<{
  toggle: [name: string, value: boolean];
}>();
</script>

<template>
  <!-- Codex 唯讀模式：展示名稱、type chip、勾選標記，無 Switch -->
  <div
    v-if="props.readonly"
    class="flex items-center justify-between gap-3 rounded px-2 py-1"
  >
    <p class="text-xs font-mono">
      {{ props.name }}
    </p>
    <div class="flex items-center gap-1">
      <span
        v-if="props.type"
        class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono text-muted-foreground bg-secondary"
      >
        {{ props.type }}
      </span>
      <span
        class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-mono text-green-600"
      >
        ✓
      </span>
    </div>
  </div>

  <!-- 可互動模式：名稱 + 可選 type chip + Switch / Built-in badge -->
  <div
    v-else
    class="group relative flex items-center justify-between gap-3 rounded px-2 py-1 hover:bg-secondary"
  >
    <p class="text-xs font-mono">
      {{ props.name }}
    </p>
    <div class="flex items-center gap-1">
      <span
        v-if="props.type"
        class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono text-muted-foreground bg-secondary"
      >
        {{ props.type }}
      </span>
      <span
        v-if="props.locked"
        class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono text-primary bg-secondary"
      >
        {{ props.badgeLabel }}
      </span>
      <Switch
        v-else
        :model-value="props.checked"
        :disabled="props.disabled"
        @click.stop
        @update:model-value="(val: boolean) => emit('toggle', props.name, val)"
      />
    </div>
  </div>
</template>
