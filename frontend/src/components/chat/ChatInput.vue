<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick,
} from "vue";
import { useI18n } from "vue-i18n";
import { Send, Mic, Square } from "lucide-vue-next";
import { TEXTAREA_MAX_HEIGHT } from "@/lib/constants";
import ScrollArea from "@/components/ui/scroll-area/ScrollArea.vue";
import type { ContentBlock } from "@/types/websocket/requests";
import { useSpeechRecognition } from "@/composables/chat/useSpeechRecognition";
import { useImageAttachment } from "@/composables/chat/useImageAttachment";
import { useContentBlocks } from "@/composables/chat/useContentBlocks";
import { useSelectionManager } from "@/composables/chat/useSelectionManager";

const props = withDefaults(
  defineProps<{
    isTyping?: boolean;
    disabled?: boolean;
  }>(),
  {
    disabled: false,
  },
);

const emit = defineEmits<{
  send: [message: string, contentBlocks?: ContentBlock[]];
  abort: [];
}>();

const input = ref("");
const editableRef = ref<HTMLDivElement | null>(null);
const isAborting = ref(false);
// abort 後若 isTyping 始終未從 true→false，最多 3 秒後強制重置 isAborting，防止按鈕永久 disabled
let abortFallbackTimer: ReturnType<typeof setTimeout> | null = null;

// ChatModal 透過 v-if 掛載，nextTick 確保 DOM 完成渲染後才 focus
onMounted(() => {
  nextTick(() => {
    editableRef.value?.focus();
  });
});

const { t } = useI18n();
const inputPlaceholder = computed(() => t("chat.inputPlaceholder"));

const disabledRef = computed(() => props.disabled);

const {
  moveCursorToEnd,
  insertNodeAtCursor,
  insertLineBreak,
  handleTextPaste,
  findImageAtomBefore,
} = useSelectionManager({ editableRef });

const updateText = (text: string): void => {
  const element = editableRef.value;
  if (!element) return;

  input.value = text;
  element.innerText = text;
  moveCursorToEnd();
};

const { isListening, toggleListening } = useSpeechRecognition({
  disabled: disabledRef,
  currentText: input,
  updateText,
});

const { imageDataMap, findImageFile, handleImagePaste, handleDrop } =
  useImageAttachment({
    editableRef,
    insertNodeAtCursor,
  });

const { buildContentBlocks, extractTextFromBlocks } = useContentBlocks({
  editableRef,
  imageDataMap,
});

const handleInput = (event: Event): void => {
  const target = event.target as HTMLDivElement;
  input.value = target.innerText;
};

const handlePaste = async (event: ClipboardEvent): Promise<void> => {
  event.preventDefault();
  const imageFile = findImageFile(event.clipboardData?.files ?? null);

  if (imageFile) {
    await handleImagePaste(imageFile);
    return;
  }

  handleTextPaste(event, (text) => {
    input.value = text;
  });
};

const clearInput = (): void => {
  input.value = "";
  if (editableRef.value) {
    editableRef.value
      .querySelectorAll<HTMLElement>('[data-type="image"]')
      .forEach((el) => {
        imageDataMap.delete(el);
      });
    editableRef.value.textContent = "";
  }
};

const handleAbort = (): void => {
  if (isAborting.value) return;
  isAborting.value = true;
  emit("abort");

  // Fallback：若 isTyping 始終未改變，3 秒後強制重置 isAborting，避免按鈕永久 disabled
  abortFallbackTimer = setTimeout(() => {
    abortFallbackTimer = null;
    if (isAborting.value) {
      isAborting.value = false;
    }
  }, 3000);
};

const handleSend = (): void => {
  if (props.disabled) return;
  const blocks = buildContentBlocks();
  if (blocks.length === 0) return;

  const textContent = extractTextFromBlocks(blocks);
  const hasImages = blocks.some((block) => block.type === "image");

  if (hasImages) {
    emit("send", textContent, blocks);
  } else {
    emit("send", textContent);
  }

  clearInput();
};

const deleteImageAtom = (element: HTMLElement): void => {
  imageDataMap.delete(element);
  element.remove();
  editableRef.value?.dispatchEvent(new Event("input", { bubbles: true }));
};

const handleEnterKey = (event: KeyboardEvent): void => {
  if (event.ctrlKey || event.shiftKey) return insertLineBreak(event);
  event.preventDefault();
  if (props.isTyping) return;
  if (props.disabled) return;
  handleSend();
};

const handleBackspaceKey = (event: KeyboardEvent): void => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  if (!range.collapsed) return;

  const imageAtom = findImageAtomBefore(range);
  if (imageAtom) {
    event.preventDefault();
    deleteImageAtom(imageAtom);
  }
};

const handleKeyDown = (event: KeyboardEvent): void => {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Enter") return handleEnterKey(event);
  if (event.key === "Backspace") return handleBackspaceKey(event);
};

watch(
  () => props.isTyping,
  (newValue, oldValue) => {
    if (oldValue === true && newValue === false) {
      // isTyping 正常從 true→false，清除 fallback timer 再重置
      if (abortFallbackTimer !== null) {
        clearTimeout(abortFallbackTimer);
        abortFallbackTimer = null;
      }
      isAborting.value = false;
    }
  },
);

onBeforeUnmount(() => {
  if (abortFallbackTimer !== null) {
    clearTimeout(abortFallbackTimer);
    abortFallbackTimer = null;
  }
});
</script>

<template>
  <div class="p-4 border-t-2 border-doodle-ink">
    <div class="flex gap-2">
      <ScrollArea
        class="flex-1 border-2 border-doodle-ink rounded-lg bg-card focus-within:ring-2 focus-within:ring-primary"
        :style="{
          boxShadow: '2px 2px 0 var(--doodle-ink)',
          maxHeight: TEXTAREA_MAX_HEIGHT + 'px',
        }"
      >
        <div
          ref="editableRef"
          :contenteditable="!disabled"
          :data-placeholder="inputPlaceholder"
          class="px-4 py-3 font-mono text-sm outline-none leading-5 chat-input-editable"
          :class="{ 'opacity-50': disabled }"
          @input="handleInput"
          @keydown="handleKeyDown"
          @paste="handlePaste"
          @dragover.prevent
          @drop="handleDrop"
        />
      </ScrollArea>
      <button
        v-if="isTyping"
        :disabled="isAborting"
        class="doodle-action-btn bg-doodle-coral disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-x-0 disabled:hover:translate-y-0"
        @click="handleAbort"
      >
        <Square
          :size="16"
          class="text-card"
        />
      </button>
      <button
        v-else
        :disabled="disabled"
        class="doodle-action-btn bg-doodle-green disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-x-0 disabled:hover:translate-y-0"
        @click="handleSend"
      >
        <Send
          :size="20"
          class="text-card"
        />
      </button>
      <button
        :disabled="disabled"
        class="doodle-action-btn disabled:opacity-50 disabled:cursor-not-allowed"
        :class="isListening ? 'bg-red-500' : 'bg-doodle-coral'"
        @click="toggleListening"
      >
        <Mic
          :size="20"
          class="text-card"
          :class="{ 'animate-pulse': isListening }"
        />
      </button>
    </div>
  </div>
</template>

<style scoped>
.doodle-action-btn {
  padding: 0.75rem 1rem;
  border: 2px solid var(--doodle-ink);
  border-radius: 0.5rem;
  box-shadow: 2px 2px 0 var(--doodle-ink);
  transition-property: transform;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 150ms;
}

.doodle-action-btn:hover {
  transform: translate(-1px, -1px);
}

.chat-input-editable:empty::before {
  content: attr(data-placeholder);
  color: oklch(0.55 0.02 50);
  pointer-events: none;
}

:deep(.image-atom) {
  display: inline-block;
  background-color: oklch(0.85 0.05 200);
  border: 1px solid var(--doodle-ink);
  border-radius: 4px;
  padding: 0 4px;
  font-size: 12px;
  font-family: monospace;
  user-select: none;
  cursor: default;
}
</style>
