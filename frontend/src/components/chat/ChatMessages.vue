<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from "vue";
import type { Message } from "@/types";
import type { RunChatTimelineItem, RunGoalRoundDivider } from "@/types/run";
import ChatMessageBubble from "./ChatMessageBubble.vue";
import GoalRoundDivider from "./GoalRoundDivider.vue";
import TypingIndicator from "./TypingIndicator.vue";
import { ScrollArea } from "@/components/ui/scroll-area";

const props = defineProps<{
  timelineItems: RunChatTimelineItem[];
  isTyping: boolean;
  isLoadingHistory?: boolean;
}>();

const messagesEndRef = ref<HTMLDivElement | null>(null);

const isGoalRoundDivider = (
  item: RunChatTimelineItem,
): item is RunGoalRoundDivider =>
  "type" in item && item.type === "goal-round-divider";

const isChatMessage = (item: RunChatTimelineItem): item is Message =>
  !isGoalRoundDivider(item);

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
  () => [props.timelineItems.length, props.isTyping] as const,
  () => {
    scrollToBottom(true);
  },
);
</script>

<template>
  <ScrollArea class="flex-1 p-4">
    <div class="space-y-4">
      <template
        v-for="item in timelineItems"
        :key="item.id"
      >
        <GoalRoundDivider
          v-if="isGoalRoundDivider(item)"
          :divider="item"
        />

        <template v-else-if="isChatMessage(item)">
          <ChatMessageBubble
            v-if="item.role === 'user'"
            :content="item.content"
            :role="item.role"
            :metadata="item.metadata"
            :is-partial="item.isPartial"
            :is-summarized="item.isSummarized"
          />

          <template v-else-if="item.role === 'assistant'">
            <template v-if="item.subMessages && item.subMessages.length > 0">
              <ChatMessageBubble
                v-for="sub in item.subMessages"
                :key="sub.id"
                :content="sub.content"
                :role="item.role"
                :metadata="item.metadata"
                :is-partial="sub.isPartial"
                :tool-use="sub.toolUse"
                :is-summarized="item.isSummarized"
              />
            </template>

            <ChatMessageBubble
              v-else
              :content="item.content"
              :role="item.role"
              :metadata="item.metadata"
              :is-partial="item.isPartial"
              :tool-use="item.toolUse"
              :is-summarized="item.isSummarized"
            />
          </template>

          <ChatMessageBubble
            v-else
            :content="item.content"
            :role="item.role"
            :metadata="item.metadata"
            :is-partial="item.isPartial"
            :is-summarized="item.isSummarized"
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

      <div ref="messagesEndRef" />
    </div>
  </ScrollArea>
</template>
