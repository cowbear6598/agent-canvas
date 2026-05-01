<script setup lang="ts">
import { computed, ref } from "vue";
import { FileText, Loader2, Check, AlertCircle } from "lucide-vue-next";
import type {
  MessageRole,
  SystemMessageMetadata,
  ToolUseInfo,
  ToolUseStatus,
} from "@/types/chat";
import ToolOutputModal from "./ToolOutputModal.vue";

const props = defineProps<{
  content: string;
  role: MessageRole;
  metadata?: SystemMessageMetadata;
  isPartial?: boolean;
  toolUse?: ToolUseInfo[];
  isSummarized?: boolean;
}>();

const isSystemMessage = computed(() => props.role === "system");

const messageAlignment = computed(() =>
  props.role === "user" ? "justify-end" : "justify-start",
);

const bubbleStyle = computed(() => {
  if (props.role === "user") {
    return "bg-doodle-blue text-card";
  }

  if (isSystemMessage.value) {
    return "border-amber-700 bg-amber-50 text-amber-950";
  }

  return "bg-card text-foreground";
});

const systemSeverityLabel = computed(() => {
  switch (props.metadata?.severity) {
    case "fatal":
      return "Fatal";
    case "warning":
      return "Warning";
    case "info":
      return "Info";
    default:
      return "Error";
  }
});

const systemProviderLabel = computed(() =>
  props.metadata?.provider ? props.metadata.provider.toUpperCase() : null,
);

const systemCodeLabel = computed(() => props.metadata?.code ?? null);

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
          v-if="isSystemMessage"
          class="mb-2 flex flex-wrap items-center gap-1.5"
        >
          <span
            data-testid="system-severity-tag"
            class="rounded-full border border-amber-700/40 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-900"
          >
            {{ systemSeverityLabel }}
          </span>
          <span
            v-if="systemProviderLabel"
            data-testid="system-provider-tag"
            class="rounded-full border border-amber-700/30 bg-white/70 px-2 py-0.5 text-[11px] font-mono text-amber-900"
          >
            {{ systemProviderLabel }}
          </span>
          <span
            v-if="systemCodeLabel"
            data-testid="system-code-tag"
            class="rounded-full border border-amber-700/30 bg-white/70 px-2 py-0.5 text-[11px] font-mono text-amber-900"
          >
            {{ systemCodeLabel }}
          </span>
        </div>

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
