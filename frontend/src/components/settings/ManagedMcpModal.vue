<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Plug, Plus, RefreshCw, Trash2 } from "lucide-vue-next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { useManagedMcpStore } from "@/stores/managedMcpStore";
import { useToast } from "@/composables/useToast";
import type {
  ManagedMcpRegistryInput,
  ManagedMcpRegistryItem,
  McpDisplayStatus,
  McpTransport,
} from "@/types/mcp";

interface Props {
  open: boolean;
}

type PendingAction = "refresh" | "save" | "delete" | "test" | null;

interface ManagedMcpFormState {
  id?: string;
  name: string;
  transport: McpTransport;
  enabled: boolean;
  command: string;
  args: Array<{ id: string; value: string }>;
  cwd: string;
  envRows: Array<{ id: string; key: string; value: string }>;
  url: string;
}

let draftRowCounter = 0;

function nextDraftRowId(prefix: "arg" | "env"): string {
  draftRowCounter += 1;
  return `${prefix}-${draftRowCounter}`;
}

function createArgRow(value = ""): { id: string; value: string } {
  return { id: nextDraftRowId("arg"), value };
}

function createEnvRow(
  key = "",
  value = "",
): { id: string; key: string; value: string } {
  return { id: nextDraftRowId("env"), key, value };
}

const props = defineProps<Props>();

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const { t } = useI18n();
const managedMcpStore = useManagedMcpStore();
const { showSuccessToast, showErrorToast } = useToast();

const selectedId = ref<string | null>(null);
const pendingAction = ref<PendingAction>(null);
const validationError = ref<string | null>(null);
const draft = ref<ManagedMcpFormState>(createEmptyForm());

const selectedEntry = computed<ManagedMcpRegistryItem | null>(
  () =>
    managedMcpStore.registry.find((item) => item.id === selectedId.value) ??
    null,
);
const isEditingExisting = computed<boolean>(() => selectedEntry.value !== null);

function createEmptyForm(): ManagedMcpFormState {
  return {
    name: "",
    transport: "stdio",
    enabled: true,
    command: "",
    args: [],
    cwd: "",
    envRows: [],
    url: "",
  };
}

function createFormFromItem(item: ManagedMcpRegistryItem): ManagedMcpFormState {
  return {
    id: item.id,
    name: item.name,
    transport: item.transport,
    enabled: item.enabled,
    command: item.command ?? "",
    args: item.args.map((arg) => createArgRow(arg)),
    cwd: item.cwd ?? "",
    envRows: Object.entries(item.env).map(([key, value]) =>
      createEnvRow(key, value),
    ),
    url: item.url ?? "",
  };
}

function parseArgs(args: Array<{ id: string; value: string }>): string[] {
  return args
    .map((entry) => entry.value.trim())
    .filter((value) => value.length > 0);
}

function parseEnv(
  envRows: Array<{ id: string; key: string; value: string }>,
): Record<string, string> {
  return Object.fromEntries(
    envRows
      .map((entry) => [entry.key.trim(), entry.value] as const)
      .filter(([key]) => key.length > 0),
  );
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

function buildSavePayload(): ManagedMcpRegistryInput {
  const basePayload = {
    ...(draft.value.id ? { id: draft.value.id } : {}),
    name: draft.value.name.trim(),
    enabled: draft.value.enabled,
  };

  if (draft.value.transport === "stdio") {
    return {
      ...basePayload,
      transport: "stdio",
      command: draft.value.command.trim(),
      args: parseArgs(draft.value.args),
      cwd: draft.value.cwd.trim() || null,
      env: parseEnv(draft.value.envRows),
    };
  }

  return {
    ...basePayload,
    transport: draft.value.transport,
    url: draft.value.url.trim(),
  };
}

const LAST_ERROR_MAX_LENGTH = 800;

function truncateLastError(message: string): string {
  if (message.length <= LAST_ERROR_MAX_LENGTH) return message;
  return `${message.slice(0, LAST_ERROR_MAX_LENGTH)}…（已截斷）`;
}

function statusBadgeClass(status: McpDisplayStatus): string {
  switch (status) {
    case "healthy":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "starting":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "error":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "running":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "completed":
      return "border-violet-200 bg-violet-50 text-violet-700";
    case "blocked":
      return "border-orange-200 bg-orange-50 text-orange-700";
    case "disabled":
      return "border-zinc-200 bg-zinc-100 text-zinc-700";
    case "idle":
      return "border-slate-200 bg-slate-100 text-slate-700";
    case "unknown":
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

function selectRegistryItem(item: ManagedMcpRegistryItem): void {
  selectedId.value = item.id;
  draft.value = createFormFromItem(item);
  validationError.value = null;
}

function startCreateFlow(): void {
  selectedId.value = null;
  draft.value = createEmptyForm();
  validationError.value = null;
}

function syncSelectionWithRegistry(): void {
  if (selectedId.value) {
    const matched = managedMcpStore.registry.find(
      (item) => item.id === selectedId.value,
    );
    if (matched) return;
  }

  const firstItem = managedMcpStore.registry[0];
  if (firstItem) {
    selectRegistryItem(firstItem);
    return;
  }

  startCreateFlow();
}

async function refreshRegistry(force = false): Promise<void> {
  if (managedMcpStore.loaded && !force) {
    syncSelectionWithRegistry();
    return;
  }

  pendingAction.value = "refresh";
  try {
    await managedMcpStore.refresh();
    syncSelectionWithRegistry();
  } finally {
    pendingAction.value = null;
  }
}

function validateDraft(): string | null {
  if (!draft.value.name.trim()) {
    return t("common.validation.nameRequired");
  }

  if (
    draft.value.transport === "stdio" &&
    draft.value.command.trim().length === 0
  ) {
    return t("managedMcp.validation.commandRequired");
  }

  if (
    draft.value.transport !== "stdio" &&
    draft.value.url.trim().length === 0
  ) {
    return t("managedMcp.validation.urlRequired");
  }

  return null;
}

async function handleRefresh(): Promise<void> {
  await refreshRegistry(true);
}

async function handleSave(): Promise<void> {
  validationError.value = validateDraft();
  if (validationError.value) return;

  pendingAction.value = "save";
  try {
    const saved = await managedMcpStore.saveRegistry(buildSavePayload());
    await managedMcpStore.refresh();

    if (saved) {
      const refreshed =
        managedMcpStore.registry.find((item) => item.id === saved.id) ?? saved;
      selectRegistryItem(refreshed);
    } else {
      syncSelectionWithRegistry();
    }
  } catch {
    // 錯誤訊息由 store.error 承接
  } finally {
    pendingAction.value = null;
  }
}

async function handleTest(): Promise<void> {
  const id = selectedId.value;
  if (!id) return;

  pendingAction.value = "test";
  try {
    const outcome = await managedMcpStore.testRegistryConnection(id);
    if (outcome.status === "healthy") {
      showSuccessToast("Mcp", t("managedMcp.actions.testSuccess"));
    } else {
      showErrorToast(
        "Mcp",
        t("managedMcp.actions.testFailed"),
        outcome.lastError ?? t("managedMcp.actions.testUnknownError"),
      );
    }
  } catch (err) {
    showErrorToast(
      "Mcp",
      t("managedMcp.actions.testFailed"),
      err instanceof Error ? err.message : undefined,
    );
  } finally {
    pendingAction.value = null;
  }
}

async function handleQuickToggle(
  item: ManagedMcpRegistryItem,
  enabled: boolean,
): Promise<void> {
  if (item.enabled === enabled) return;

  const basePayload = { id: item.id, name: item.name, enabled };
  const payload: ManagedMcpRegistryInput =
    item.transport === "stdio"
      ? {
          ...basePayload,
          transport: "stdio",
          command: item.command ?? "",
          args: item.args,
          cwd: item.cwd,
          env: item.env,
        }
      : {
          ...basePayload,
          transport: item.transport,
          url: item.url ?? "",
        };

  try {
    await managedMcpStore.saveRegistry(payload);
  } catch {
    // 錯誤訊息由 store.error 承接，避免 toggle 時 throw 影響 UI
  }
}

async function handleDelete(): Promise<void> {
  if (!selectedId.value) return;

  pendingAction.value = "delete";
  try {
    await managedMcpStore.deleteRegistryById(selectedId.value);
    syncSelectionWithRegistry();
  } catch {
    // 錯誤訊息由 store.error 承接
  } finally {
    pendingAction.value = null;
  }
}

function handleClose(): void {
  emit("update:open", false);
}

function transportLabel(transport: McpTransport): string {
  return t(`managedMcp.transport.${transport}` as const);
}

function statusLabel(status: McpDisplayStatus): string {
  return t(`managedMcp.status.${status}` as const);
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      pendingAction.value = null;
      validationError.value = null;
      return;
    }

    void refreshRegistry();
  },
  { immediate: true },
);
</script>

<template>
  <Dialog
    :open="open"
    @update:open="handleClose"
  >
    <DialogContent class="max-w-5xl">
      <DialogHeader>
        <DialogTitle>{{ t("managedMcp.modal.title") }}</DialogTitle>
        <DialogDescription class="sr-only">
          {{ t("managedMcp.modal.description") }}
        </DialogDescription>
      </DialogHeader>

      <div
        data-testid="managed-mcp-modal"
        class="flex max-h-[72vh] flex-col gap-4 lg:flex-row"
      >
        <aside
          class="flex min-h-[18rem] flex-col rounded-xl border border-doodle-ink/20 bg-muted/20 lg:w-[20rem]"
        >
          <div
            class="flex items-start justify-between gap-3 border-b px-4 py-3"
          >
            <div>
              <p class="text-sm font-semibold">
                {{ t("managedMcp.list.title") }}
              </p>
              <p class="mt-1 text-xs text-muted-foreground">
                {{ t("managedMcp.list.description") }}
              </p>
            </div>

            <div class="flex items-center gap-2">
              <button
                data-testid="managed-mcp-new"
                class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-doodle-ink/20 bg-card text-foreground transition hover:bg-accent"
                :title="t('managedMcp.actions.create')"
                @click="startCreateFlow"
              >
                <Plus class="h-4 w-4" />
              </button>
              <button
                data-testid="managed-mcp-refresh"
                class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-doodle-ink/20 bg-card text-foreground transition hover:bg-accent"
                :title="t('managedMcp.actions.refresh')"
                :disabled="managedMcpStore.loading"
                @click="handleRefresh"
              >
                <RefreshCw
                  class="h-4 w-4"
                  :class="{ 'animate-spin': pendingAction === 'refresh' }"
                />
              </button>
            </div>
          </div>

          <div
            v-if="
              managedMcpStore.loading &&
                pendingAction === 'refresh' &&
                managedMcpStore.registry.length === 0
            "
            class="px-4 py-6 text-sm text-muted-foreground"
          >
            {{ t("common.loading") }}
          </div>

          <div
            v-else-if="
              managedMcpStore.loaded && managedMcpStore.registry.length === 0
            "
            data-testid="managed-mcp-empty"
            class="px-4 py-6 text-sm text-muted-foreground"
          >
            <p class="font-medium text-foreground">
              {{ t("managedMcp.empty.title") }}
            </p>
            <p class="mt-1">
              {{ t("managedMcp.empty.description") }}
            </p>
          </div>

          <ScrollArea
            v-else
            class="h-[18rem] lg:h-[32rem]"
          >
            <div class="space-y-2 p-3">
              <div
                v-for="item in managedMcpStore.registry"
                :key="item.id"
                :data-testid="`managed-mcp-entry-${item.id}`"
                role="button"
                tabindex="0"
                :class="[
                  'w-full cursor-pointer rounded-xl border px-3 py-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  selectedId === item.id
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-doodle-ink/15 bg-card hover:border-doodle-ink/30 hover:bg-accent/30',
                ]"
                @click="selectRegistryItem(item)"
                @keydown.enter.prevent="selectRegistryItem(item)"
                @keydown.space.prevent="selectRegistryItem(item)"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="truncate text-sm font-semibold text-foreground">
                      {{ item.name }}
                    </p>
                    <div class="mt-2 flex flex-wrap gap-2">
                      <span
                        class="inline-flex items-center rounded-full border border-doodle-ink/15 bg-background px-2 py-0.5 text-[11px] font-mono uppercase tracking-wide text-muted-foreground"
                      >
                        {{ transportLabel(item.transport) }}
                      </span>
                      <span
                        :class="[
                          'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-mono',
                          statusBadgeClass(item.status),
                        ]"
                      >
                        {{ statusLabel(item.status) }}
                      </span>
                      <span
                        v-if="!item.enabled"
                        class="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-[11px] font-mono text-zinc-700"
                      >
                        {{ t("managedMcp.badge.configDisabled") }}
                      </span>
                    </div>
                  </div>
                  <Switch
                    :model-value="item.enabled"
                    :data-testid="`managed-mcp-quick-toggle-${item.id}`"
                    :aria-label="t('managedMcp.form.enabled')"
                    @click.stop
                    @update:model-value="
                      (val: boolean) => handleQuickToggle(item, val)
                    "
                  />
                </div>

                <p
                  v-if="item.lastError"
                  class="mt-2 line-clamp-2 text-xs text-rose-700"
                >
                  {{ item.lastError }}
                </p>
              </div>
            </div>
          </ScrollArea>
        </aside>

        <section
          class="flex min-h-[24rem] flex-1 flex-col rounded-xl border border-doodle-ink/20 bg-card"
        >
          <div class="border-b px-5 py-4">
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="text-base font-semibold">
                  {{
                    isEditingExisting
                      ? t("managedMcp.form.editTitle")
                      : t("managedMcp.form.createTitle")
                  }}
                </p>
                <p class="mt-1 text-sm text-muted-foreground">
                  {{
                    isEditingExisting
                      ? t("managedMcp.form.editDescription")
                      : t("managedMcp.form.createDescription")
                  }}
                </p>
              </div>

              <label class="inline-flex items-center gap-2 text-xs font-mono">
                <input
                  v-model="draft.enabled"
                  type="checkbox"
                  class="h-4 w-4 rounded border-input text-primary"
                >
                <span>{{ t("managedMcp.form.enabled") }}</span>
              </label>
            </div>
          </div>

          <div class="flex-1 overflow-y-auto px-5 py-4">
            <div
              class="mb-4 rounded-md border border-amber-500/40 bg-amber-50/60 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200"
              data-testid="managed-mcp-security-warning"
            >
              {{ t("managedMcp.form.securityWarning") }}
            </div>
            <div
              v-if="selectedEntry"
              class="mb-4 rounded-xl border border-doodle-ink/15 bg-muted/20 p-4"
            >
              <div class="flex flex-wrap gap-2">
                <span
                  class="inline-flex items-center rounded-full border border-doodle-ink/15 bg-background px-2 py-1 text-xs font-mono text-muted-foreground"
                >
                  {{ t("managedMcp.form.transport") }}:
                  {{ transportLabel(selectedEntry.transport) }}
                </span>
                <span
                  :class="[
                    'inline-flex items-center rounded-full border px-2 py-1 text-xs font-mono',
                    statusBadgeClass(selectedEntry.status),
                  ]"
                >
                  {{ t("managedMcp.form.status") }}:
                  {{ statusLabel(selectedEntry.status) }}
                </span>
              </div>

              <div
                v-if="selectedEntry.lastError"
                data-testid="managed-mcp-last-error"
                class="mt-3 text-sm text-rose-700"
              >
                <span class="font-medium">
                  {{ t("managedMcp.form.lastError") }}:
                </span>
                <p
                  class="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded border border-rose-100 bg-rose-50/40 px-2 py-1 font-mono text-xs"
                >
                  {{ truncateLastError(selectedEntry.lastError) }}
                </p>
              </div>
            </div>

            <div
              v-if="managedMcpStore.error"
              class="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
            >
              {{ managedMcpStore.error }}
            </div>

            <div
              v-if="validationError"
              class="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
            >
              {{ validationError }}
            </div>

            <div class="grid gap-4 md:grid-cols-2">
              <label class="space-y-2">
                <span class="text-sm font-medium">
                  {{ t("managedMcp.form.name") }}
                </span>
                <Input
                  v-model="draft.name"
                  data-testid="managed-mcp-name"
                  :placeholder="t('managedMcp.form.namePlaceholder')"
                />
              </label>

              <label class="space-y-2">
                <span class="text-sm font-medium">
                  {{ t("managedMcp.form.transport") }}
                </span>
                <select
                  v-model="draft.transport"
                  data-testid="managed-mcp-transport"
                  class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-ring"
                >
                  <option value="stdio">
                    {{ transportLabel("stdio") }}
                  </option>
                  <option value="http">
                    {{ transportLabel("http") }}
                  </option>
                  <option value="sse">
                    {{ transportLabel("sse") }}
                  </option>
                </select>
              </label>
            </div>

            <div
              v-if="draft.transport === 'stdio'"
              class="mt-4 space-y-4"
            >
              <label class="space-y-2">
                <span class="text-sm font-medium">
                  {{ t("managedMcp.form.command") }}
                </span>
                <Input
                  v-model="draft.command"
                  data-testid="managed-mcp-command"
                  :placeholder="t('managedMcp.form.commandPlaceholder')"
                />
              </label>

              <label class="space-y-2">
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
                      class="inline-flex items-center rounded-md border border-doodle-ink/20 bg-card px-2 py-1 text-xs font-mono transition hover:bg-accent"
                      @click="addArgRow"
                    >
                      {{ t("common.add") }}
                    </button>
                  </div>
                  <div
                    v-if="draft.args.length === 0"
                    class="rounded-md border border-dashed border-doodle-ink/20 px-3 py-2 text-xs text-muted-foreground"
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
                      :placeholder="t('managedMcp.form.argsPlaceholder')"
                    />
                    <button
                      type="button"
                      data-testid="managed-mcp-arg-remove"
                      class="inline-flex items-center rounded-md border border-doodle-ink/20 bg-card px-2 py-2 text-xs font-mono transition hover:bg-accent"
                      @click="removeArgRow(arg.id)"
                    >
                      {{ t("common.delete") }}
                    </button>
                  </div>
                  <p class="text-xs text-muted-foreground">
                    {{ t("managedMcp.form.argsHint") }}
                  </p>
                </div>

                <div class="space-y-2">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-sm font-medium">
                      {{ t("managedMcp.form.env") }}
                    </span>
                    <button
                      type="button"
                      data-testid="managed-mcp-env-add"
                      class="inline-flex items-center rounded-md border border-doodle-ink/20 bg-card px-2 py-1 text-xs font-mono transition hover:bg-accent"
                      @click="addEnvRow"
                    >
                      {{ t("common.add") }}
                    </button>
                  </div>
                  <div
                    v-if="draft.envRows.length === 0"
                    class="rounded-md border border-dashed border-doodle-ink/20 px-3 py-2 text-xs text-muted-foreground"
                  >
                    {{ t("managedMcp.form.envHint") }}
                  </div>
                  <div
                    v-for="entry in draft.envRows"
                    :key="entry.id"
                    class="flex items-center gap-2"
                  >
                    <Input
                      v-model="entry.key"
                      data-testid="managed-mcp-env-key-input"
                      :placeholder="t('managedMcp.form.envKeyPlaceholder')"
                    />
                    <Input
                      v-model="entry.value"
                      data-testid="managed-mcp-env-value-input"
                      :placeholder="t('managedMcp.form.envValuePlaceholder')"
                    />
                    <button
                      type="button"
                      data-testid="managed-mcp-env-remove"
                      class="inline-flex items-center rounded-md border border-doodle-ink/20 bg-card px-2 py-2 text-xs font-mono transition hover:bg-accent"
                      @click="removeEnvRow(entry.id)"
                    >
                      {{ t("common.delete") }}
                    </button>
                  </div>
                  <p class="text-xs text-muted-foreground">
                    {{ t("managedMcp.form.envHint") }}
                  </p>
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

          <div class="flex items-center justify-end gap-2 border-t px-5 py-4">
            <Button
              v-if="isEditingExisting"
              data-testid="managed-mcp-test"
              variant="outline"
              :disabled="managedMcpStore.loading || pendingAction !== null"
              @click="handleTest"
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
              :disabled="managedMcpStore.loading"
              @click="handleDelete"
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
              :disabled="managedMcpStore.loading"
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
      </div>
    </DialogContent>
  </Dialog>
</template>
