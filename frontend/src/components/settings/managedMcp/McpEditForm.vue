<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Plug, Plus, Trash2 } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ManagedMcpRegistryInput,
  ManagedMcpRegistryItem,
  McpTransport,
} from "@/types/mcp";
import McpStatusBadge from "./McpStatusBadge.vue";
import {
  buildSavePayload,
  createArgRow,
  createEmptyForm,
  createEnvRow,
  createFormFromItem,
  truncateLastError,
  validateDraft,
  type ManagedMcpFormState,
} from "./mcpFormHelpers";

type PendingAction = "refresh" | "save" | "delete" | "test" | null;

interface Props {
  entry: ManagedMcpRegistryItem | null;
  pendingAction: PendingAction;
  loading: boolean;
  storeError: string | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  save: [payload: ManagedMcpRegistryInput];
  test: [];
  delete: [];
}>();

const { t } = useI18n();

const isEditingExisting = computed<boolean>(() => props.entry !== null);

const draft = ref<ManagedMcpFormState>(
  props.entry ? createFormFromItem(props.entry) : createEmptyForm(),
);
const validationError = ref<string | null>(null);

watch(
  () => props.entry,
  (entry) => {
    draft.value = entry ? createFormFromItem(entry) : createEmptyForm();
    validationError.value = null;
  },
);

function transportLabel(transport: McpTransport): string {
  return t(`managedMcp.transport.${transport}` as const);
}

function addArgRow(): void {
  draft.value.args.push(createArgRow());
}

function removeArgRow(id: string): void {
  draft.value.args = draft.value.args.filter((entry) => entry.id !== id);
}

function addEnvRow(): void {
  draft.value.envRows.push(createEnvRow());
}

function removeEnvRow(id: string): void {
  draft.value.envRows = draft.value.envRows.filter((entry) => entry.id !== id);
}

function handleSave(): void {
  validationError.value = validateDraft(draft.value, t);
  if (validationError.value) return;
  emit("save", buildSavePayload(draft.value, props.entry));
}
</script>

<template>
  <section
    class="flex min-h-[24rem] flex-1 flex-col rounded-xl border border-doodle-ink/20 bg-card"
  >
    <div class="border-b px-5 py-4">
      <p class="text-base font-semibold">
        {{
          isEditingExisting
            ? t("managedMcp.form.editTitle")
            : t("managedMcp.form.createTitle")
        }}
      </p>
      <p
        v-if="isEditingExisting"
        class="mt-1 text-sm text-muted-foreground"
      >
        {{ t("managedMcp.form.editDescription") }}
      </p>
    </div>

    <ScrollArea class="min-h-0 flex-1">
      <div class="px-5 py-4">
        <div
          v-if="entry"
          class="mb-4 rounded-md border border-doodle-ink/15 bg-muted/20 p-4"
        >
          <div class="flex flex-wrap gap-2">
            <span
              class="inline-flex items-center rounded-full border border-doodle-ink/15 bg-background px-2 py-1 text-xs font-mono text-muted-foreground"
            >
              {{ t("managedMcp.form.transport") }}:
              {{ transportLabel(entry.transport) }}
            </span>
            <McpStatusBadge
              :status="entry.status"
              size="md"
            />
          </div>

          <div
            v-if="entry.lastError"
            data-testid="managed-mcp-last-error"
            class="mt-3 text-sm text-rose-700"
          >
            <span class="font-medium">
              {{ t("managedMcp.form.lastError") }}:
            </span>
            <p
              class="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-rose-100 bg-rose-50/40 px-2 py-1 font-mono text-xs"
            >
              {{ truncateLastError(entry.lastError) }}
            </p>
          </div>
        </div>

        <div
          v-if="storeError"
          class="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
        >
          {{ storeError }}
        </div>

        <div
          v-if="validationError"
          class="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          {{ validationError }}
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <label class="block space-y-2">
            <span class="text-sm font-medium">
              {{ t("managedMcp.form.name") }}
            </span>
            <Input
              v-model="draft.name"
              data-testid="managed-mcp-name"
              :placeholder="t('managedMcp.form.namePlaceholder')"
            />
          </label>

          <label class="block space-y-2">
            <span class="text-sm font-medium">
              {{ t("managedMcp.form.transport") }}
            </span>
            <Select
              v-model="draft.transport"
              data-testid="managed-mcp-transport"
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="stdio">
                  {{ transportLabel("stdio") }}
                </SelectItem>
                <SelectItem value="http">
                  {{ transportLabel("http") }}
                </SelectItem>
                <SelectItem value="sse">
                  {{ transportLabel("sse") }}
                </SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>

        <div
          v-if="draft.transport === 'stdio'"
          class="mt-4 space-y-4"
        >
          <label class="block space-y-2">
            <span class="text-sm font-medium">
              {{ t("managedMcp.form.command") }}
            </span>
            <Input
              v-model="draft.command"
              data-testid="managed-mcp-command"
              :placeholder="t('managedMcp.form.commandPlaceholder')"
            />
          </label>

          <label class="block space-y-2">
            <span class="text-sm font-medium">
              {{ t("managedMcp.form.cwd") }}
            </span>
            <Input
              v-model="draft.cwd"
              data-testid="managed-mcp-cwd"
              :placeholder="t('managedMcp.form.cwdPlaceholder')"
            />
          </label>

          <div class="grid gap-4 lg:grid-cols-2">
            <div class="space-y-2">
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm font-medium">
                  {{ t("managedMcp.form.args") }}
                </span>
                <button
                  type="button"
                  data-testid="managed-mcp-arg-add"
                  class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-doodle-ink/20 bg-card text-foreground transition hover:bg-accent"
                  :title="t('common.add')"
                  :aria-label="t('common.add')"
                  @click="addArgRow"
                >
                  <Plus class="h-4 w-4" />
                </button>
              </div>
              <div
                v-if="draft.args.length === 0"
                class="whitespace-pre-line rounded-md border border-dashed border-doodle-ink/20 px-3 py-2 font-mono text-xs text-muted-foreground"
              >
                {{ t("managedMcp.form.argsHint") }}
              </div>
              <div
                v-for="arg in draft.args"
                :key="arg.id"
                class="flex items-center gap-2"
              >
                <Input
                  v-model="arg.value"
                  data-testid="managed-mcp-arg-input"
                  class="h-8"
                  :placeholder="t('managedMcp.form.argsPlaceholder')"
                />
                <button
                  type="button"
                  data-testid="managed-mcp-arg-remove"
                  class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-doodle-ink/20 bg-card text-foreground transition hover:bg-accent"
                  :title="t('common.delete')"
                  :aria-label="t('common.delete')"
                  @click="removeArgRow(arg.id)"
                >
                  <Trash2 class="h-4 w-4" />
                </button>
              </div>
            </div>

            <div class="space-y-2">
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm font-medium">
                  {{ t("managedMcp.form.env") }}
                </span>
                <button
                  type="button"
                  data-testid="managed-mcp-env-add"
                  class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-doodle-ink/20 bg-card text-foreground transition hover:bg-accent"
                  :title="t('common.add')"
                  :aria-label="t('common.add')"
                  @click="addEnvRow"
                >
                  <Plus class="h-4 w-4" />
                </button>
              </div>
              <div
                v-if="draft.envRows.length === 0"
                class="whitespace-pre-line rounded-md border border-dashed border-doodle-ink/20 px-3 py-2 font-mono text-xs text-muted-foreground"
              >
                {{ t("managedMcp.form.envHint") }}
              </div>
              <div
                v-for="envEntry in draft.envRows"
                :key="envEntry.id"
                class="flex items-center gap-2"
              >
                <Input
                  v-model="envEntry.key"
                  data-testid="managed-mcp-env-key-input"
                  class="h-8"
                  :placeholder="t('managedMcp.form.envKeyPlaceholder')"
                />
                <Input
                  v-model="envEntry.value"
                  data-testid="managed-mcp-env-value-input"
                  class="h-8"
                  :placeholder="t('managedMcp.form.envValuePlaceholder')"
                />
                <button
                  type="button"
                  data-testid="managed-mcp-env-remove"
                  class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-doodle-ink/20 bg-card text-foreground transition hover:bg-accent"
                  :title="t('common.delete')"
                  :aria-label="t('common.delete')"
                  @click="removeEnvRow(envEntry.id)"
                >
                  <Trash2 class="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <label
          v-else
          class="mt-4 block space-y-2"
        >
          <span class="text-sm font-medium">
            {{ t("managedMcp.form.url") }}
          </span>
          <Input
            v-model="draft.url"
            data-testid="managed-mcp-url"
            :placeholder="t('managedMcp.form.urlPlaceholder')"
          />
        </label>
      </div>
    </ScrollArea>

    <div class="flex items-center justify-end gap-2 border-t px-5 py-4">
      <Button
        v-if="isEditingExisting"
        data-testid="managed-mcp-test"
        variant="outline"
        :disabled="loading || pendingAction !== null"
        @click="emit('test')"
      >
        <Plug class="h-4 w-4" />
        {{
          pendingAction === "test"
            ? t("managedMcp.actions.testing")
            : t("managedMcp.actions.test")
        }}
      </Button>
      <Button
        v-if="isEditingExisting"
        data-testid="managed-mcp-delete"
        variant="outline"
        :disabled="loading"
        @click="emit('delete')"
      >
        <Trash2 class="h-4 w-4" />
        {{
          pendingAction === "delete"
            ? t("common.loading")
            : t("managedMcp.actions.delete")
        }}
      </Button>
      <Button
        data-testid="managed-mcp-save"
        :disabled="loading"
        @click="handleSave"
      >
        {{
          pendingAction === "save"
            ? t("common.saving")
            : isEditingExisting
              ? t("managedMcp.actions.save")
              : t("managedMcp.actions.create")
        }}
      </Button>
    </div>
  </section>
</template>
