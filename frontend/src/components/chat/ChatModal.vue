<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import type { Pod } from "@/types";
import type { ContentBlock } from "@/types/websocket/requests";
import ChatHeader from "./ChatHeader.vue";
import ChatMessages from "./ChatMessages.vue";
import ChatInput from "./ChatInput.vue";
import ChatWorkflowBlockedHint from "./ChatWorkflowBlockedHint.vue";
import ChatIntegrationBlockedHint from "@/components/integration/ChatIntegrationBlockedHint.vue";
import ChatMultiInstanceInput from "./ChatMultiInstanceInput.vue";
import { useChatStore } from "@/stores/chat";
import { useConnectionStore } from "@/stores/connectionStore";
import { useRunStore } from "@/stores/run/runStore";
import { isMultiInstanceSourcePod } from "@/utils/multiInstanceGuard";
import { useToast } from "@/composables/useToast";

const props = defineProps<{
  pod: Pod;
}>();

const emit = defineEmits<{
  close: [];
}>();

const chatStore = useChatStore();
const connectionStore = useConnectionStore();
const runStore = useRunStore();
const { showErrorToast } = useToast();

const messages = computed(() => chatStore.getMessages(props.pod.id));
const isTyping = computed(() => props.pod.status === "chatting");
const isHistoryLoading = computed(() =>
  chatStore.isHistoryLoading(props.pod.id),
);
const isMultiInstanceMode = computed(() =>
  isMultiInstanceSourcePod(props.pod.id),
);

const firstIntegrationProvider = computed<string | null>(
  () => props.pod.integrationBindings?.[0]?.provider ?? null,
);
const workflowRole = computed(() =>
  connectionStore.getPodWorkflowRole(props.pod.id),
);
const isMiddlePod = computed(() => workflowRole.value === "middle");
const isWorkflowBusy = computed(() => {
  return (
    !isMiddlePod.value &&
    workflowRole.value !== "independent" &&
    connectionStore.isPartOfRunningWorkflow(props.pod.id) &&
    !isTyping.value
  );
});

const handleSend = async (
  content: string,
  contentBlocks?: ContentBlock[],
): Promise<void> => {
  if (!content.trim() && (!contentBlocks || contentBlocks.length === 0)) return;

  try {
    await chatStore.sendMessage(props.pod.id, content, contentBlocks);
  } catch {
    showErrorToast("Pod", "訊息發送失敗");
  }
};

const handleAbort = (): void => {
  chatStore.abortChat(props.pod.id);
};

const handleClose = (): void => {
  emit("close");
};

const handleMultiInstanceSend = async (message: string): Promise<void> => {
  await chatStore.sendMessage(props.pod.id, message);
  runStore.openHistoryPanel();
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
    <div class="absolute inset-0 modal-overlay" />

    <div class="relative max-w-3xl w-full h-[85vh]">
      <div class="chat-window flex flex-col h-full overflow-hidden">
        <ChatHeader
          :pod="pod"
          @close="handleClose"
        />
        <!-- Multi-instance mode：只顯示簡化版輸入（但若有 integration binding 則優先顯示提示） -->
        <ChatMultiInstanceInput
          v-if="isMultiInstanceMode && !firstIntegrationProvider"
          :pod-id="pod.id"
          @send="handleMultiInstanceSend"
          @close="handleClose"
        />
        <!-- 正常模式：顯示完整聊天介面 -->
        <template v-else>
          <ChatMessages
            :messages="messages"
            :is-typing="isTyping"
            :is-loading-history="isHistoryLoading"
          />
          <!-- integration binding 優先顯示（任何模式皆適用） -->
          <ChatIntegrationBlockedHint
            v-if="firstIntegrationProvider"
            :provider="firstIntegrationProvider"
          />
          <ChatWorkflowBlockedHint v-else-if="isMiddlePod" />
          <ChatInput
            v-else
            :is-typing="isTyping"
            :disabled="isWorkflowBusy"
            @send="handleSend"
            @abort="handleAbort"
          />
        </template>
      </div>
    </div>
  </div>
</template>
