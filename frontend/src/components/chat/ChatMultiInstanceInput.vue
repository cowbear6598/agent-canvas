<script setup lang="ts">
import { ref, onMounted } from "vue";
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

const inputRef = ref<HTMLInputElement | null>(null);
const inputText = ref("");

const handleSend = (): void => {
  if (!inputText.value.trim()) return;
  emit("send", inputText.value.trim());
  inputText.value = "";
};

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
      <div class="flex gap-2">
        <input
          ref="inputRef"
          v-model="inputText"
          type="text"
          class="flex-1 px-4 py-3 border-2 border-doodle-ink rounded-lg bg-card text-sm font-mono"
          :style="{ boxShadow: '2px 2px 0 var(--doodle-ink)' }"
          :placeholder="t('chat.inputPlaceholder')"
          @keydown.enter="handleSend"
        >
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
