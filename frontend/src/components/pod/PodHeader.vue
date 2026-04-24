<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import { MAX_POD_NAME_LENGTH } from "@/lib/constants";
import { Pencil } from "lucide-vue-next";

const props = defineProps<{
  name: string;
  isEditing: boolean;
}>();

const emit = defineEmits<{
  "update:name": [name: string];
  save: [];
  rename: [];
}>();

const editName = ref(props.name);
const inputRef = ref<HTMLInputElement | null>(null);

watch(
  () => props.name,
  (newName) => {
    editName.value = newName;
  },
);

watch(
  () => props.isEditing,
  (isEditing) => {
    if (isEditing) {
      nextTick(() => {
        inputRef.value?.focus();
      });
    }
  },
);

const handleSave = (): void => {
  const trimmedName = editName.value.trim();
  if (trimmedName && trimmedName.length <= MAX_POD_NAME_LENGTH) {
    emit("update:name", trimmedName);
  } else {
    editName.value = props.name;
  }
  emit("save");
};
</script>

<template>
  <div>
    <div class="flex items-center gap-2 mb-2">
      <input
        v-if="isEditing"
        ref="inputRef"
        v-model="editName"
        type="text"
        :maxlength="MAX_POD_NAME_LENGTH"
        class="flex-1 min-w-0 w-full bg-transparent border-b-2 border-doodle-ink/50 outline-none font-sans text-base"
        @blur="handleSave"
        @keydown.enter="handleSave"
      >
      <h3
        v-else
        class="flex-1 font-sans text-base text-foreground truncate"
      >
        {{ name }}
      </h3>
      <button
        v-if="!isEditing"
        class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        @click="$emit('rename')"
      >
        <Pencil
          :size="14"
          class="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
        />
      </button>
    </div>
  </div>
</template>
