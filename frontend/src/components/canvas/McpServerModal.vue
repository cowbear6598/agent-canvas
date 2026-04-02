<script setup lang="ts">
import { ref, watch } from "vue";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { McpServerConfig } from "@/types";
import { useModalForm } from "@/composables/useModalForm";
import { RESOURCE_NAME_PATTERN } from "@/lib/validators";
import { safeJsonParse } from "@/utils/safeJsonParse";
import { useI18n } from "vue-i18n";

interface Props {
  open: boolean;
  mode: "create" | "edit";
  initialName?: string;
  initialConfig?: McpServerConfig;
}

const props = withDefaults(defineProps<Props>(), {
  initialName: undefined,
  initialConfig: undefined,
});

const emit = defineEmits<{
  "update:open": [value: boolean];
  submit: [payload: { name: string; config: McpServerConfig }];
}>();

const { t } = useI18n();

const jsonPlaceholder =
  '{"my-mcp-server": {"command": "npx", "args": ["-y", "my-mcp"]}}';

const validateMcpServerName = (
  parsed: Record<string, unknown>,
): string | null => {
  const keys = Object.keys(parsed);
  if (keys.length === 0) return t("canvas.mcpServer.minOneServer");

  const name = keys[0] as string;
  if (!RESOURCE_NAME_PATTERN.test(name))
    return t("canvas.mcpServer.nameInvalid");

  return null;
};

const validateMcpServerMode = (
  config: Record<string, unknown>,
): string | null => {
  const isStdioMode = typeof config.command === "string";
  const isHttpMode =
    typeof config.type === "string" && typeof config.url === "string";

  if (!isStdioMode && !isHttpMode) {
    return t("canvas.mcpServer.modeError");
  }

  return null;
};

const validateStdioConfig = (
  config: Record<string, unknown>,
): string | null => {
  if (typeof config.command !== "string") return null;
  if (config.command.trim() === "") return t("canvas.mcpServer.commandEmpty");

  return null;
};

const validateHttpConfig = (config: Record<string, unknown>): string | null => {
  const isHttpMode =
    typeof config.type === "string" && typeof config.url === "string";
  if (!isHttpMode) return null;

  if (!URL.canParse(config.url as string)) {
    return t("canvas.mcpServer.urlInvalid");
  }

  return null;
};

const validateArgs = (config: Record<string, unknown>): string | null => {
  if (config.args === undefined) return null;

  const isValidArgs =
    Array.isArray(config.args) &&
    config.args.every((arg) => typeof arg === "string");
  if (!isValidArgs) return t("canvas.mcpServer.argsInvalid");

  return null;
};

const lastParsed = ref<Record<string, unknown> | null>(null);

const parseAndValidateJson = (jsonText: string): string | null => {
  const parsed = safeJsonParse<Record<string, unknown>>(jsonText);
  if (!parsed) return t("canvas.mcpServer.parseError");

  const nameError = validateMcpServerName(parsed);
  if (nameError) return nameError;

  const name = Object.keys(parsed)[0] as string;
  const config = parsed[name] as Record<string, unknown>;

  const configError =
    validateMcpServerMode(config) ??
    validateStdioConfig(config) ??
    validateHttpConfig(config) ??
    validateArgs(config);

  if (configError) return configError;

  lastParsed.value = parsed;
  return null;
};

const {
  inputValue: jsonText,
  errorMessage,
  handleSubmit,
  handleClose,
  resetForm,
} = useModalForm<string>({
  validator: parseAndValidateJson,
  onSubmit: async () => {
    const parsed = lastParsed.value;
    if (!parsed) return t("canvas.mcpServer.parseLost");
    const name = Object.keys(parsed)[0] as string;
    const config = parsed[name] as McpServerConfig;
    emit("submit", { name, config });
    return null;
  },
  onClose: () => emit("update:open", false),
});

watch(
  () => props.open,
  (newOpen) => {
    if (newOpen) {
      if (props.mode === "edit" && props.initialName && props.initialConfig) {
        jsonText.value = JSON.stringify(
          { [props.initialName]: props.initialConfig },
          null,
          2,
        );
      } else {
        resetForm();
      }
    }
  },
);
</script>

<template>
  <Dialog :open="open" @update:open="handleClose">
    <DialogContent class="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{{
          mode === "create"
            ? $t("canvas.mcpServer.createTitle")
            : $t("canvas.mcpServer.editTitle")
        }}</DialogTitle>
        <DialogDescription>
          {{ $t("canvas.mcpServer.description") }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4">
        <textarea
          v-model="jsonText"
          :placeholder="jsonPlaceholder"
          class="w-full h-[300px] p-3 bg-card border-2 border-doodle-ink rounded text-base font-mono resize-none focus:outline-none focus:ring-2 focus:ring-doodle-ink/50 doodle-textarea"
        />

        <p v-if="errorMessage" class="text-sm text-red-500 font-mono">
          {{ errorMessage }}
        </p>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="handleClose">
          {{ $t("common.cancel") }}
        </Button>
        <Button variant="default" @click="handleSubmit">
          {{ mode === "create" ? $t("common.create") : $t("common.save") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
