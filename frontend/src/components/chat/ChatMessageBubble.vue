<script setup lang="ts">
import { computed, ref } from "vue";
import { FileText, Loader2, Check, AlertCircle } from "lucide-vue-next";
import type { MessageRole, ToolUseInfo, ToolUseStatus } from "@/types/chat";
import ToolOutputModal from "./ToolOutputModal.vue";

const props = defineProps<{
  content: string;
  role: MessageRole;
  isPartial?: boolean;
  toolUse?: ToolUseInfo[];
  isSummarized?: boolean;
}>();

const messageAlignment = computed(() =>
  props.role === "user" ? "justify-end" : "justify-start",
);

const bubbleStyle = computed(() =>
  props.role === "user"
    ? "bg-doodle-blue text-card"
    : "bg-card text-foreground",
);

const uniqueToolUse = computed(() => {
  if (!props.toolUse || props.toolUse.length === 0) return [];

  const seen = new Set<string>();
  const unique: ToolUseInfo[] = [];

  for (const tool of props.toolUse) {
    if (!seen.has(tool.toolUseId)) {
      seen.add(tool.toolUseId);
      unique.push(tool);
    }
  }

  return unique;
});

const hasToolUse = computed(() => uniqueToolUse.value.length > 0);

const activeToolModal = ref<string | null>(null);

const isClickable = (status: ToolUseStatus): boolean => {
  return status === "completed" || status === "error";
};

const getToolIcon = (
  status: ToolUseStatus,
): typeof Loader2 | typeof AlertCircle | typeof Check => {
  if (status === "running") return Loader2;
  if (status === "error") return AlertCircle;
  return Check;
};

const toolStatusClassMap: Record<string, string> = {
  running: "bg-blue-50 dark:bg-blue-950/30 border-blue-500 text-blue-600",
  error: "bg-red-50 dark:bg-red-950/30 border-red-500 text-red-600",
  completed: "bg-green-50 dark:bg-green-950/30 border-green-500 text-green-600",
  pending: "bg-gray-50 dark:bg-gray-950/30 border-gray-500 text-gray-600",
};

const getToolTagClass = (status: ToolUseStatus): string => {
  return toolStatusClassMap[status] ?? toolStatusClassMap.completed ?? "";
};

const openToolModal = (toolUseId: string): void => {
  activeToolModal.value = toolUseId;
};

const closeToolModal = (): void => {
  activeToolModal.value = null;
};
</script>

<template>
  <div :class="['flex', messageAlignment]">
    <div
      :class="[
        'max-w-[80%] rounded-lg border-2 border-doodle-ink',
        bubbleStyle,
      ]"
      :style="{ boxShadow: '2px 2px 0 var(--doodle-ink)' }"
    >
      <div class="p-3">
        <div
          v-if="hasToolUse"
          class="mb-2 flex flex-wrap gap-1.5"
        >
          <component
            :is="isClickable(tool.status) ? 'button' : 'div'"
            v-for="tool in uniqueToolUse"
            :key="tool.toolUseId"
            :class="[
              'inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-mono border',
              getToolTagClass(tool.status),
              isClickable(tool.status)
                ? 'cursor-pointer hover:opacity-80 transition-opacity'
                : 'cursor-default',
            ]"
            @click="
              isClickable(tool.status)
                ? openToolModal(tool.toolUseId)
                : undefined
            "
          >
            <component
              :is="getToolIcon(tool.status)"
              :size="12"
              :class="[
                'flex-shrink-0',
                tool.status === 'running' ? 'animate-spin' : '',
              ]"
            />
            <span>{{ tool.toolName }}</span>
          </component>
        </div>

        <div
          v-if="isSummarized"
          class="message-summary-badge"
        >
          <FileText :size="10" />
          <span>{{ $t("chat.summarizedBadge") }}</span>
        </div>

        <p class="font-mono text-sm whitespace-pre-wrap break-all">
          {{ content }}
        </p>

        <span
          v-if="isPartial"
          class="inline-block w-1.5 h-4 bg-foreground animate-pulse ml-0.5"
        />
      </div>
    </div>
  </div>

  <ToolOutputModal
    v-for="tool in uniqueToolUse"
    :key="`modal-${tool.toolUseId}`"
    :open="activeToolModal === tool.toolUseId"
    :tool-name="tool.toolName"
    :input="tool.input"
    :output="tool.output"
    :status="tool.status"
    @update:open="closeToolModal"
  />
</template>
