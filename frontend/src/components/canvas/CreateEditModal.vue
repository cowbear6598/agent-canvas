<script setup lang="ts">
import { ref, watch, computed } from "vue";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "vue-i18n";

interface Props {
  open: boolean;
  mode: "create" | "edit";
  title: string;
  initialName?: string;
  initialContent?: string;
  nameEditable?: boolean;
  showContent?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  initialName: "",
  initialContent: "",
  nameEditable: true,
  showContent: true,
});

const emit = defineEmits<{
  "update:open": [value: boolean];
  submit: [payload: { name: string; content: string }];
}>();

const { t } = useI18n();

const MAX_NAME_LENGTH = 100;
const MAX_CONTENT_LENGTH = 10000;

const name = ref("");
const content = ref("");

const description = computed(() => {
  if (!props.showContent) return t("canvas.createEdit.descriptionNameOnly");
  return props.mode === "create"
    ? t("canvas.createEdit.descriptionCreate")
    : t("canvas.createEdit.descriptionEdit");
});

watch(
  () => props.open,
  (newOpen) => {
    if (newOpen) {
      name.value = props.initialName;
      content.value = props.initialContent;
    } else {
      name.value = "";
      content.value = "";
    }
  },
);

const handleSubmit = (): void => {
  if (
    props.nameEditable &&
    (!name.value.trim() || name.value.length > MAX_NAME_LENGTH)
  ) {
    return;
  }
  if (props.showContent && content.value.length > MAX_CONTENT_LENGTH) {
    return;
  }
  emit("submit", { name: name.value, content: content.value });
};

const handleClose = (): void => {
  emit("update:open", false);
};

const handleKeyDown = (e: KeyboardEvent): void => {
  if (e.key === "Enter" && e.ctrlKey) {
    e.preventDefault();
    handleSubmit();
  }
};
</script>

<template>
  <Dialog
    :open="open"
    @update:open="handleClose"
  >
    <DialogContent class="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>
          {{ description }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4">
        <input
          v-model="name"
          :placeholder="$t('canvas.createEdit.namePlaceholder')"
          :disabled="!nameEditable"
          maxlength="100"
          class="w-full p-3 bg-card border-2 border-doodle-ink rounded text-base font-mono focus:outline-none focus:ring-2 focus:ring-doodle-ink/50 disabled:cursor-not-allowed disabled:opacity-50"
          @keydown.enter="!showContent && handleSubmit()"
        >

        <textarea
          v-if="showContent"
          v-model="content"
          :placeholder="$t('canvas.createEdit.contentPlaceholder')"
          maxlength="10000"
          class="w-full h-[400px] p-3 bg-card border-2 border-doodle-ink rounded text-base font-mono resize-none focus:outline-none focus:ring-2 focus:ring-doodle-ink/50 doodle-textarea"
          @keydown="handleKeyDown"
        />
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          @click="handleClose"
        >
          {{ $t("common.cancel") }}
        </Button>
        <Button
          variant="default"
          @click="handleSubmit"
        >
          {{ mode === "create" ? $t("common.create") : $t("common.save") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
