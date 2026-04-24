<script setup lang="ts">
import { ref, computed, watch } from "vue";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { websocketClient } from "@/services/websocket";
import { WebSocketRequestEvents } from "@/types/websocket";
import { generateRequestId } from "@/services/utils";
import { requireActiveCanvas } from "@/utils/canvasGuard";
import type { RepositoryGitClonePayload } from "@/types/websocket";
import type { GitPlatform } from "@/types/repository";
import { parseGitUrl, getPlatformDisplayName } from "@/utils/gitUrlParser";
import { useModalForm } from "@/composables/useModalForm";
import { validateGitUrl } from "@/lib/validators";

interface Props {
  open: boolean;
}

defineProps<Props>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  "clone-started": [payload: { requestId: string; repoName: string }];
}>();

const detectedPlatform = ref<GitPlatform | null>(null);

const platformDisplayName = computed(() => {
  if (!detectedPlatform.value) {
    return "";
  }
  return getPlatformDisplayName(detectedPlatform.value);
});

const extractRepoName = (url: string): string => {
  const cleanUrl = url.trim().replace(/\.git$/, "");
  const urlParts = cleanUrl.split("/");
  return urlParts[urlParts.length - 1] || "repository";
};

const {
  inputValue: repoUrl,
  isSubmitting,
  errorMessage,
  handleSubmit,
  handleClose,
} = useModalForm<string>({
  validator: validateGitUrl,
  onSubmit: async (url) => {
    const requestId = generateRequestId();
    const repoName = extractRepoName(url);
    const canvasId = requireActiveCanvas();

    const payload: RepositoryGitClonePayload = {
      requestId,
      canvasId,
      repoUrl: url.trim(),
    };

    websocketClient.emit(WebSocketRequestEvents.REPOSITORY_GIT_CLONE, payload);

    emit("clone-started", { requestId, repoName });
    emit("update:open", false);
    return null;
  },
  onClose: () => emit("update:open", false),
});

watch(repoUrl, (newUrl) => {
  if (!newUrl.trim()) {
    detectedPlatform.value = null;
    return;
  }

  const parseResult = parseGitUrl(newUrl);
  detectedPlatform.value = parseResult.isValid ? parseResult.platform : null;
});
</script>

<template>
  <Dialog
    :open="open"
    @update:open="handleClose"
  >
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>{{ $t("canvas.clone.title") }}</DialogTitle>
        <DialogDescription>
          {{ $t("canvas.clone.description") }}
        </DialogDescription>
      </DialogHeader>

      <Input
        v-model="repoUrl"
        placeholder=""
        @keyup.enter="handleSubmit"
      />

      <p
        v-if="detectedPlatform"
        class="text-sm text-muted-foreground"
      >
        {{ $t("canvas.clone.detected", { platform: platformDisplayName }) }}
      </p>

      <p
        v-if="errorMessage"
        class="text-sm text-destructive"
      >
        {{ errorMessage }}
      </p>

      <DialogFooter>
        <Button
          variant="outline"
          @click="handleClose"
        >
          {{ $t("common.cancel") }}
        </Button>
        <Button
          variant="default"
          :disabled="isSubmitting"
          @click="handleSubmit"
        >
          Clone
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
