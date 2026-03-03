<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import type { Pod } from '@/types'
import type { ContentBlock } from '@/types/websocket/requests'
import ChatHeader from './ChatHeader.vue'
import ChatMessages from './ChatMessages.vue'
import ChatInput from './ChatInput.vue'
import ChatWorkflowBlockedHint from './ChatWorkflowBlockedHint.vue'
import { useChatStore } from '@/stores/chat'
import { useConnectionStore } from '@/stores/connectionStore'

const props = defineProps<{
  pod: Pod
}>()

const emit = defineEmits<{
  close: []
}>()

const chatStore = useChatStore()
const connectionStore = useConnectionStore()

const messages = computed(() => chatStore.getMessages(props.pod.id))
const isTyping = computed(() => chatStore.isTyping(props.pod.id))
const isHistoryLoading = computed(() => chatStore.isHistoryLoading(props.pod.id))

const workflowRole = computed(() => connectionStore.getPodWorkflowRole(props.pod.id))
const isMiddlePod = computed(() => workflowRole.value === 'middle')
const isWorkflowBusy = computed(() => {
  return !isMiddlePod.value && workflowRole.value !== 'independent' && connectionStore.isPartOfRunningWorkflow(props.pod.id) && !isTyping.value
})

const handleSend = async (content: string, contentBlocks?: ContentBlock[]): Promise<void> => {
  if (!content.trim() && !contentBlocks) return

  await chatStore.sendMessage(props.pod.id, content, contentBlocks)
}

const handleAbort = (): void => {
  chatStore.abortChat(props.pod.id)
}

const handleClose = (): void => {
  emit('close')
}

const handleKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') {
    const openDialog = document.querySelector('[data-state="open"][role="dialog"]')
    if (openDialog) {
      return
    }
    handleClose()
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
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
        <ChatMessages
          :messages="messages"
          :is-typing="isTyping"
          :is-loading-history="isHistoryLoading"
        />
        <ChatWorkflowBlockedHint v-if="isMiddlePod" />
        <ChatInput
          v-else
          :is-typing="isTyping"
          :disabled="isWorkflowBusy"
          @send="handleSend"
          @abort="handleAbort"
        />
      </div>
    </div>
  </div>
</template>
