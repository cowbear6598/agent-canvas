<script setup lang="ts">
import { computed } from "vue";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "vue-i18n";

interface Props {
  open: boolean;
  title: string;
  summary: string | null;
  summaryUpdatedAt?: string | null;
  emptyMessage: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const { t } = useI18n();

function formatXmlSummary(summary: string | null): string | null {
  if (!summary) {
    return null;
  }

  const tagPattern = /<([a-z][a-z0-9-]*)>([\s\S]*?)<\/\1>/g;
  const blocks = Array.from(summary.matchAll(tagPattern)).map((match) => {
    const tagName = match[1] ?? "";
    const content = (match[2] ?? "").trim();
    return `<${tagName}>\n${content}\n</${tagName}>`;
  });

  if (blocks.length === 0) {
    return summary;
  }

  return blocks.join("\n\n");
}

const formattedSummary = computed(() => formatXmlSummary(props.summary));
</script>

<template>
  <Dialog
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <DialogContent class="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription v-if="summaryUpdatedAt">
          {{
            t("canvas.memoryViewer.lastUpdated", {
              timestamp: summaryUpdatedAt,
            })
          }}
        </DialogDescription>
      </DialogHeader>

      <pre
        v-if="formattedSummary"
        class="m-0 max-h-[60vh] overflow-auto rounded-md border border-border bg-muted/30 p-4 text-sm leading-7 whitespace-pre-wrap break-words"
      >{{ formattedSummary }}</pre>

      <div
        v-else
        class="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground"
      >
        {{ emptyMessage }}
      </div>
    </DialogContent>
  </Dialog>
</template>
