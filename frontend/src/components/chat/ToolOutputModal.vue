<script setup lang="ts">
import { computed, ref, watchEffect } from "vue";
import { useI18n } from "vue-i18n";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { renderMarkdown } from "@/utils/renderMarkdown";
import type { ToolUseStatus } from "@/types/chat";

const props = defineProps<{
  open: boolean;
  toolName: string;
  input: Record<string, unknown>;
  output: string | Record<string, unknown> | unknown[] | undefined;
  status: ToolUseStatus;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const { t } = useI18n();

const modalTitle = computed(() =>
  props.status === "error"
    ? t("chat.toolOutput.errorTitle", { toolName: props.toolName })
    : t("chat.toolOutput.resultTitle", { toolName: props.toolName }),
);

const hasInput = computed(() => Object.keys(props.input).length > 0);

const formattedInput = computed(() => JSON.stringify(props.input, null, 2));

const hasOutput = computed(() => {
  if (!props.output) return false;
  if (typeof props.output === "string") return props.output.trim().length > 0;
  return true;
});

const renderedOutput = ref("");

watchEffect(async () => {
  if (!props.output) {
    renderedOutput.value = "";
    return;
  }
  const raw =
    typeof props.output === "string"
      ? props.output
      : "```json\n" + JSON.stringify(props.output, null, 2) + "\n```";
  renderedOutput.value = await renderMarkdown(raw);
});
</script>

<template>
  <Dialog
    :open="open"
    @update:open="(val) => emit('update:open', val)"
  >
    <DialogContent class="max-w-2xl max-h-[80vh] flex flex-col">
      <DialogHeader>
        <DialogTitle>{{ modalTitle }}</DialogTitle>
        <DialogDescription />
      </DialogHeader>

      <div class="overflow-y-auto flex-1 min-h-0">
        <div
          v-if="status === 'error'"
          class="mb-3 px-3 py-2 rounded bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm"
        >
          {{ $t("chat.toolOutput.executionError") }}
        </div>

        <div
          v-if="hasInput"
          class="mb-4"
        >
          <h4 class="text-sm font-semibold text-muted-foreground mb-2">
            {{ $t("chat.toolOutput.inputParams") }}
          </h4>
          <pre
            class="bg-muted rounded-lg p-3 overflow-x-auto text-xs font-mono"
          >{{ formattedInput }}</pre>
        </div>

        <hr
          v-if="hasInput && hasOutput"
          class="my-4 border-border"
        >

        <div>
          <h4
            v-if="hasInput"
            class="text-sm font-semibold text-muted-foreground mb-2"
          >
            {{ $t("chat.toolOutput.executionResult") }}
          </h4>

          <div
            v-if="hasOutput"
            class="markdown-body"
            v-html="renderedOutput"
          />

          <p
            v-else
            class="text-muted-foreground text-sm"
          >
            {{ $t("chat.toolOutput.noResult") }}
          </p>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.markdown-body :deep(h1) {
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
}
.markdown-body :deep(h2) {
  font-size: 1.25rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}
.markdown-body :deep(h3) {
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}
.markdown-body :deep(p) {
  margin-bottom: 0.75rem;
}
.markdown-body :deep(code) {
  background: var(--muted);
  padding: 0.15rem 0.3rem;
  border-radius: 0.25rem;
  font-size: 0.875rem;
}
.markdown-body :deep(pre) {
  background: var(--muted);
  padding: 1rem;
  border-radius: 0.5rem;
  overflow-x: auto;
  margin-bottom: 0.75rem;
}
.markdown-body :deep(pre code) {
  background: transparent;
  padding: 0;
}
.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 1.5rem;
  margin-bottom: 0.75rem;
}
.markdown-body :deep(ul) {
  list-style-type: disc;
}
.markdown-body :deep(ol) {
  list-style-type: decimal;
}
.markdown-body :deep(li) {
  margin-bottom: 0.25rem;
}
.markdown-body :deep(a) {
  color: var(--primary);
  text-decoration: underline;
}
</style>
