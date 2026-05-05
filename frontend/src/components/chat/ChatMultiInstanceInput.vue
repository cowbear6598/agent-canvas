<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { Send } from "lucide-vue-next";

defineProps<{
  podId: string;
}>();

const emit = defineEmits<{
  send: [message: string];
  close: [];
}>();

const { t } = useI18n();

// multi-instance 在畫面中央獨立呈現，可給比 ChatInput 更高的空間上限
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

const handleSend = (): void => {
  if (!inputText.value.trim()) return;
  emit("send", inputText.value.trim());
  inputText.value = "";
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
</script>

<template>
  <div class="flex-1 flex flex-col items-center justify-center p-8">
    <div class="text-sm text-muted-foreground mb-6 text-center">
      {{ $t("chat.multiInstanceHint") }}
    </div>
    <div class="w-full max-w-md">
      <div class="flex gap-2 items-end">
        <textarea
          ref="inputRef"
          v-model="inputText"
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
          class="px-4 py-3 border-2 border-doodle-ink rounded-lg bg-doodle-green"
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
