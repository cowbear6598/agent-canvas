<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from "vue";
import type { Message } from "@/types";
import ChatMessageBubble from "./ChatMessageBubble.vue";
import TypingIndicator from "./TypingIndicator.vue";
import { ScrollArea } from "@/components/ui/scroll-area";

const props = withDefaults(
  defineProps<{
    messages: Message[];
    isTyping: boolean;
    isLoadingHistory?: boolean;
  }>(),
  {
    isLoadingHistory: false,
  },
);

const messagesEndRef = ref<HTMLDivElement | null>(null);

const scrollToBottom = async (smooth = true): Promise<void> => {
  await nextTick();
  messagesEndRef.value?.scrollIntoView({
    behavior: smooth ? "smooth" : "instant",
    block: "end",
  });
};

onMounted(() => {
  scrollToBottom(false);
});

watch(
  () => [props.messages.length, props.isTyping] as const,
  () => {
    scrollToBottom(true);
  },
);
</script>

<template>
  <ScrollArea class="flex-1 p-4">
    <div class="space-y-4">
      <div
        v-if="isLoadingHistory && messages.length === 0"
        class="flex justify-center items-center h-full"
      >
        <div class="flex flex-col items-center gap-3 text-muted-foreground">
          <TypingIndicator />
          <span class="text-sm">{{ $t("chat.loadingHistory") }}</span>
        </div>
      </div>

      <template v-else>
        <template
          v-for="message in messages"
          :key="message.id"
        >
          <ChatMessageBubble
            v-if="message.role === 'user'"
            :content="message.content"
            :role="message.role"
            :is-partial="message.isPartial"
            :is-summarized="message.isSummarized"
          />

          <template v-else-if="message.role === 'assistant'">
            <template
              v-if="message.subMessages && message.subMessages.length > 0"
            >
              <ChatMessageBubble
                v-for="sub in message.subMessages"
                :key="sub.id"
                :content="sub.content"
                :role="message.role"
                :is-partial="sub.isPartial"
                :tool-use="sub.toolUse"
                :is-summarized="message.isSummarized"
              />
            </template>

            <ChatMessageBubble
              v-else
              :content="message.content"
              :role="message.role"
              :is-partial="message.isPartial"
              :tool-use="message.toolUse"
              :is-summarized="message.isSummarized"
            />
          </template>
        </template>

        <div
          v-if="isTyping"
          class="flex justify-start"
        >
          <div
            class="p-3 rounded-lg border-2 border-doodle-ink bg-card"
            :style="{ boxShadow: '2px 2px 0 var(--doodle-ink)' }"
          >
            <TypingIndicator />
          </div>
        </div>
      </template>

      <div ref="messagesEndRef" />
    </div>
  </ScrollArea>
</template>
