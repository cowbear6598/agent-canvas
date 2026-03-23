<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { X } from "lucide-vue-next";
import { useRunStore } from "@/stores/run/runStore";
import ChatMessages from "@/components/chat/ChatMessages.vue";
import RunStatusIcon from "./RunStatusIcon.vue";
import type { RunStatus } from "@/types/run";

const props = defineProps<{
  runId: string;
  podId: string;
  podName: string;
  runStatus: RunStatus;
}>();

const emit = defineEmits<{
  close: [];
}>();

const runStore = useRunStore();

const messages = computed(() => runStore.getActiveRunChatMessages);
const isLoadingPodMessages = computed(() => runStore.isLoadingPodMessages);

const isTyping = computed(() => {
  const run = runStore.getRunById(props.runId);
  return (
    run?.podInstances.find((i) => i.podId === props.podId)?.status === "running"
  );
});

const handleClose = (): void => {
  emit("close");
};

const handleKeydown = (event: KeyboardEvent): void => {
  if (event.key === "Escape") {
    const openDialog = document.querySelector(
      '[data-state="open"][role="dialog"]',
    );
    if (openDialog) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    handleClose();
  }
};

onMounted(() => {
  document.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div
      class="absolute inset-0 modal-overlay"
      @mousedown.stop
      @click="handleClose"
    />
    <div class="relative max-w-3xl w-full h-[85vh]" @mousedown.stop>
      <div class="chat-window flex flex-col h-full overflow-hidden">
        <div
          class="flex items-center justify-between p-4 border-b-2 border-doodle-ink"
        >
          <div class="flex items-center gap-2">
            <RunStatusIcon :status="runStatus" />
            <span class="font-semibold">{{ podName }}</span>
            <span class="text-xs text-muted-foreground">（歷程紀錄）</span>
          </div>
          <button class="rounded-md p-1 hover:bg-accent" @click="handleClose">
            <X :size="20" />
          </button>
        </div>

        <ChatMessages
          :messages="messages"
          :is-typing="isTyping ?? false"
          :is-loading-history="isLoadingPodMessages"
        />

        <div
          class="p-4 border-t-2 border-doodle-ink text-center text-sm text-muted-foreground"
        >
          此為歷程紀錄，僅供查看
        </div>
      </div>
    </div>
  </div>
</template>
