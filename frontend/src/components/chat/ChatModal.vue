<script setup lang="ts">
import { computed, ref, onMounted, watch, nextTick } from "vue";
import { Send } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import type { Pod } from "@/types";
import ChatWorkflowBlockedHint from "./ChatWorkflowBlockedHint.vue";
import ChatIntegrationBlockedHint from "@/components/integration/ChatIntegrationBlockedHint.vue";
import { useChatStore } from "@/stores/chat";
import { useConnectionStore } from "@/stores/connectionStore";
import { useRunStore } from "@/stores/run/runStore";
import { useEscapeClose } from "@/composables/useEscapeClose";

const props = defineProps<{
  pod: Pod;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useI18n();
const chatStore = useChatStore();
const connectionStore = useConnectionStore();
const runStore = useRunStore();

const firstIntegrationProvider = computed<string | null>(
  () => props.pod.integrationBindings?.[0]?.provider ?? null,
);
const workflowRole = computed(() =>
  connectionStore.getPodWorkflowRole(props.pod.id),
);
const isMiddlePod = computed(() => workflowRole.value === "middle");

const MIN_HEIGHT = 48;
const MAX_HEIGHT = 200;

const inputRef = ref<HTMLTextAreaElement | null>(null);
const inputText = ref("");

const autoResize = (): void => {
  const el = inputRef.value;
  if (!el) return;
  el.style.height = "auto";
  const next = Math.min(Math.max(el.scrollHeight, MIN_HEIGHT), MAX_HEIGHT);
  el.style.height = `${next}px`;
};

const handleClose = (): void => {
  emit("close");
};

const handleSend = async (): Promise<void> => {
  const content = inputText.value.trim();
  if (!content) return;
  await chatStore.sendMessage(props.pod.id, content);
  inputText.value = "";
  runStore.openHistoryPanel();
  emit("close");
};

const handleEnterKey = (event: KeyboardEvent): void => {
  if (event.ctrlKey || event.shiftKey) return;
  event.preventDefault();
  handleSend();
};

const handleKeyDown = (event: KeyboardEvent): void => {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Enter") return handleEnterKey(event);
};

watch(inputText, async () => {
  await nextTick();
  autoResize();
});

onMounted(() => {
  inputRef.value?.focus();
});

useEscapeClose(() => {
  const openDialog = document.querySelector(
    '[data-state="open"][role="dialog"]',
  );
  if (openDialog) return;
  handleClose();
});
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div
      class="absolute inset-0 modal-overlay"
      @click="handleClose"
    />

    <div
      v-if="firstIntegrationProvider || isMiddlePod"
      class="relative w-full max-w-md chat-window overflow-hidden"
    >
      <ChatIntegrationBlockedHint
        v-if="firstIntegrationProvider"
        :provider="firstIntegrationProvider"
      />
      <ChatWorkflowBlockedHint v-else-if="isMiddlePod" />
    </div>

    <div
      v-else
      class="relative w-full max-w-md chat-window p-6 flex flex-col items-center"
    >
      <div class="text-sm text-muted-foreground mb-6 text-center font-mono">
        {{ $t("chat.launchHint") }}
      </div>
      <div class="w-full flex gap-2 items-end">
        <textarea
          ref="inputRef"
          v-model="inputText"
          data-testid="chat-launch-textarea"
          class="doodle-textarea flex-1 px-4 py-3 border-2 border-doodle-ink rounded-lg bg-card text-sm font-mono resize-none overflow-y-auto"
          :style="{
            boxShadow: '2px 2px 0 var(--doodle-ink)',
            minHeight: MIN_HEIGHT + 'px',
            maxHeight: MAX_HEIGHT + 'px',
          }"
          :placeholder="t('chat.inputPlaceholder')"
          rows="1"
          @keydown="handleKeyDown"
        />
        <button
          data-testid="chat-launch-send"
          class="px-4 py-3 border-2 border-doodle-ink rounded-lg bg-doodle-green doodle-send-btn"
          :style="{ boxShadow: '2px 2px 0 var(--doodle-ink)' }"
          @click="handleSend"
        >
          <Send
            :size="20"
            class="text-card"
          />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.doodle-send-btn {
  transition: transform 150ms cubic-bezier(0.4, 0, 0.2, 1);
}
.doodle-send-btn:hover {
  transform: translate(-1px, -1px);
}
</style>
