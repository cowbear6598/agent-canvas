<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
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
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import ModalBackButton from "@/components/ui/ModalBackButton.vue";
import { useToast } from "@/composables/useToast";
import { useSecurityStore } from "@/stores/securityStore";
import {
  createAgentAccessToken,
  downloadAgentCanvasSkill,
  getAgentAccessInfo,
  listAgentAccessTokens,
  revokeAgentAccessToken,
  updateAgentAccessSettings,
  type AgentAccessCanvas,
  type AgentAccessExpiration,
  type AgentAccessInfo,
  type AgentAccessScope,
  type AgentAccessToken,
} from "@/services/agentAccessApi";

const props = defineProps<{ open: boolean; showBackButton?: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean]; back: [] }>();
const { t } = useI18n();
const { toast } = useToast();
const securityStore = useSecurityStore();

const info = ref<AgentAccessInfo | null>(null);
const tokens = ref<AgentAccessToken[]>([]);
const canvases = ref<AgentAccessCanvas[]>([]);
const advertisedUrl = ref("");
const name = ref("");
const expiration = ref<AgentAccessExpiration>("90d");
const scopes = ref<AgentAccessScope[]>([]);
const canvasIds = ref<string[]>([]);
const revealedToken = ref<string | null>(null);
const loading = ref(false);
const saving = ref(false);
const revoking = ref(false);
const error = ref("");
const copiedTarget = ref<"baseUrl" | "token" | "connection" | null>(null);
const tokenToRevoke = ref<AgentAccessToken | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

const scopeOptions: AgentAccessScope[] = [
  "canvas:read",
  "canvas:create",
  "canvas:write",
  "canvas:execute",
];
const canCreateToken = computed(
  () =>
    name.value.trim().length > 0 &&
    scopes.value.length > 0 &&
    canvasIds.value.length > 0,
);
const connectionConfig = computed(() =>
  revealedToken.value && info.value
    ? [
        `AGENT_CANVAS_BASE_URL=${JSON.stringify(info.value.apiBaseUrl)}`,
        `AGENT_CANVAS_TOKEN=${JSON.stringify(revealedToken.value)}`,
      ].join("\n")
    : "",
);

function isCanvasSelectable(canvas: AgentAccessCanvas): boolean {
  return !canvas.isProtected || securityStore.isCanvasUnlocked(canvas.id);
}

function toggleSelection<T>(items: T[], value: T): T[] {
  return items.includes(value)
    ? items.filter((item) => item !== value)
    : [...items, value];
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const [loadedInfo, tokenList] = await Promise.all([
      getAgentAccessInfo(),
      listAgentAccessTokens(),
    ]);
    info.value = loadedInfo;
    advertisedUrl.value = loadedInfo.advertisedUrl ?? "";
    tokens.value = tokenList.tokens;
    canvases.value = tokenList.canvases;
  } catch {
    error.value = t("agentAccess.errors.load");
  } finally {
    loading.value = false;
  }
}

async function saveAdvertisedUrl(): Promise<void> {
  saving.value = true;
  error.value = "";
  try {
    info.value = await updateAgentAccessSettings(
      advertisedUrl.value.trim() || null,
    );
    advertisedUrl.value = info.value.advertisedUrl ?? "";
  } catch {
    error.value = t("agentAccess.errors.url");
  } finally {
    saving.value = false;
  }
}

async function createToken(): Promise<void> {
  if (!canCreateToken.value) return;
  saving.value = true;
  error.value = "";
  try {
    const created = await createAgentAccessToken({
      name: name.value.trim(),
      scopes: scopes.value,
      canvasIds: canvasIds.value,
      expiration: expiration.value,
    });
    revealedToken.value = created.token;
    tokens.value = [created.record, ...tokens.value];
    name.value = "";
    scopes.value = [];
    canvasIds.value = [];
    expiration.value = "90d";
  } catch {
    error.value = t("agentAccess.errors.create");
  } finally {
    saving.value = false;
  }
}

function requestRevokeToken(token: AgentAccessToken): void {
  tokenToRevoke.value = token;
}

function closeRevokeConfirmation(): void {
  if (revoking.value) return;
  tokenToRevoke.value = null;
}

async function confirmRevokeToken(): Promise<void> {
  const token = tokenToRevoke.value;
  if (!token || revoking.value) return;
  revoking.value = true;
  error.value = "";
  try {
    await revokeAgentAccessToken(token.id);
    tokens.value = tokens.value.filter((item) => item.id !== token.id);
    tokenToRevoke.value = null;
    toast({ title: t("agentAccess.tokens.revoked") });
  } catch {
    error.value = t("agentAccess.errors.revoke");
  } finally {
    revoking.value = false;
  }
}

function copyViaExecCommand(value: string): boolean {
  const container = document.querySelector("[role='dialog']") ?? document.body;
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  container.appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    container.removeChild(textarea);
  }
}

async function copy(
  value: string,
  target: "baseUrl" | "token" | "connection",
): Promise<void> {
  const copied = await copyViaClipboard(value);
  if (!copied) {
    error.value = t("agentAccess.errors.copy");
    return;
  }

  error.value = "";
  copiedTarget.value = target;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copiedTarget.value = null;
    copiedTimer = null;
  }, 2000);
}

async function copyViaClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Clipboard API 被拒絕時改用非安全環境也可運作的 fallback。
  }
  return copyViaExecCommand(value);
}

watch(
  () => props.open,
  (open) => {
    if (open) void load();
    else revealedToken.value = null;
  },
);
</script>

<template>
  <Dialog
    :open="open"
    @update:open="emit('update:open', false)"
  >
    <DialogContent class="max-w-2xl">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <ModalBackButton
            v-if="showBackButton"
            @back="emit('back')"
          />
          {{ t("agentAccess.title") }}
        </DialogTitle>
      </DialogHeader>

      <ScrollArea class="h-[620px] pr-4">
        <div class="space-y-6 py-2">
          <p
            v-if="error"
            class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {{ error }}
          </p>
          <p
            v-if="loading"
            class="text-sm text-muted-foreground"
          >
            {{ t("common.loading") }}
          </p>

          <section
            v-if="info"
            class="space-y-3"
          >
            <h3 class="font-medium">
              {{ t("agentAccess.connection.title") }}
            </h3>
            <div class="flex gap-2">
              <Input
                :model-value="info.apiBaseUrl"
                class="flat-field"
                readonly
              />
              <Button
                data-testid="agent-access-copy-base-url"
                variant="outline"
                class="flat-button"
                @click="copy(info.apiBaseUrl, 'baseUrl')"
              >
                {{ copiedTarget === "baseUrl" ? t("common.success.copy") : t("common.copy") }}
              </Button>
            </div>
            <div class="flex gap-2">
              <Input
                v-model="advertisedUrl"
                class="flat-field"
                :placeholder="t('agentAccess.connection.advertisedPlaceholder')"
              />
              <Button
                class="flat-button flat-button--primary"
                :disabled="saving"
                @click="saveAdvertisedUrl"
              >
                {{ t("common.save") }}
              </Button>
            </div>
            <Button
              variant="outline"
              class="flat-button"
              @click="downloadAgentCanvasSkill"
            >
              {{ t("agentAccess.connection.downloadSkill") }}
            </Button>
          </section>

          <div class="border-t border-border" />

          <section class="space-y-3">
            <h3 class="font-medium">
              {{ t("agentAccess.create.title") }}
            </h3>
            <div class="space-y-2">
              <Label>{{ t("agentAccess.create.name") }}</Label>
              <Input
                v-model="name"
                data-testid="agent-access-token-name"
                class="flat-field"
              />
            </div>
            <div class="space-y-2">
              <Label>{{ t("agentAccess.create.expiration") }}</Label>
              <select
                v-model="expiration"
                class="flat-field h-10 w-full rounded-md border px-3 text-sm"
              >
                <option value="7d">
                  {{ t("agentAccess.expirations.7d") }}
                </option>
                <option value="30d">
                  {{ t("agentAccess.expirations.30d") }}
                </option>
                <option value="90d">
                  {{ t("agentAccess.expirations.90d") }}
                </option>
                <option value="never">
                  {{ t("agentAccess.expirations.never") }}
                </option>
              </select>
            </div>
            <div class="space-y-2">
              <Label>{{ t("agentAccess.create.scopes") }}</Label>
              <label
                v-for="scope in scopeOptions"
                :key="scope"
                class="flex items-center gap-2 text-sm"
              >
                <input
                  class="flat-checkbox"
                  type="checkbox"
                  :checked="scopes.includes(scope)"
                  @change="scopes = toggleSelection(scopes, scope)"
                >
                {{ scope }}
              </label>
              <p
                v-if="scopes.length === 0"
                class="text-xs text-muted-foreground"
              >
                {{ t("agentAccess.create.scopeRequired") }}
              </p>
            </div>
            <div class="space-y-2">
              <Label>{{ t("agentAccess.create.canvases") }}</Label>
              <p
                v-if="canvases.length === 0"
                class="text-xs text-muted-foreground"
              >
                {{ t("agentAccess.create.noCanvases") }}
              </p>
              <label
                v-for="canvas in canvases"
                :key="canvas.id"
                class="flex items-center gap-2 text-sm"
                :class="!isCanvasSelectable(canvas) && 'opacity-50'"
              >
                <input
                  class="flat-checkbox"
                  type="checkbox"
                  :disabled="!isCanvasSelectable(canvas)"
                  :checked="canvasIds.includes(canvas.id)"
                  @change="canvasIds = toggleSelection(canvasIds, canvas.id)"
                >
                {{ canvas.name }}
                <span v-if="canvas.isProtected && !isCanvasSelectable(canvas)">
                  {{ t("agentAccess.create.locked") }}
                </span>
              </label>
              <p
                v-if="canvases.length > 0 && canvasIds.length === 0"
                class="text-xs text-muted-foreground"
              >
                {{ t("agentAccess.create.canvasRequired") }}
              </p>
            </div>
            <Button
              data-testid="agent-access-create-token"
              class="flat-button flat-button--primary"
              :disabled="saving || !canCreateToken"
              @click="createToken"
            >
              {{ t("agentAccess.create.submit") }}
            </Button>
          </section>

          <section
            v-if="revealedToken"
            class="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-4"
          >
            <h3 class="font-medium">
              {{ t("agentAccess.reveal.title") }}
            </h3>
            <p class="text-xs text-muted-foreground">
              {{ t("agentAccess.reveal.hint") }}
            </p>
            <div class="flex gap-2">
              <Input
                :model-value="revealedToken"
                class="flat-field"
                readonly
              />
              <Button
                data-testid="agent-access-copy-token"
                class="flat-button"
                @click="copy(revealedToken, 'token')"
              >
                {{ copiedTarget === "token" ? t("common.success.copy") : t("common.copy") }}
              </Button>
            </div>
            <Button
              data-testid="agent-access-copy-connection"
              variant="outline"
              class="flat-button"
              @click="copy(connectionConfig, 'connection')"
            >
              {{ copiedTarget === "connection" ? t("common.success.copy") : t("agentAccess.reveal.copyConnection") }}
            </Button>
          </section>

          <div class="border-t border-border" />

          <section class="space-y-3">
            <h3 class="font-medium">
              {{ t("agentAccess.tokens.title") }}
            </h3>
            <p
              v-if="tokens.length === 0"
              class="text-sm text-muted-foreground"
            >
              {{ t("agentAccess.tokens.empty") }}
            </p>
            <div
              v-for="token in tokens"
              :key="token.id"
              class="flex items-start justify-between gap-3 rounded-md border p-3"
            >
              <div class="min-w-0 space-y-1">
                <p class="font-medium">
                  {{ token.name }}
                </p>
                <p class="font-mono text-xs text-muted-foreground">
                  {{ token.tokenHint }}
                </p>
                <p class="text-xs text-muted-foreground">
                  {{ token.scopes.join(" · ") }}
                </p>
                <p class="text-xs text-muted-foreground">
                  {{ token.expiresAt ? new Date(token.expiresAt).toLocaleDateString() : t("agentAccess.expirations.never") }}
                </p>
              </div>
              <Button
                v-if="!token.revokedAt"
                :data-testid="`agent-access-revoke-${token.id}`"
                variant="outline"
                size="sm"
                class="flat-button flat-button--danger"
                @click="requestRevokeToken(token)"
              >
                {{ t("agentAccess.tokens.revoke") }}
              </Button>
            </div>
          </section>
        </div>
      </ScrollArea>
    </DialogContent>
  </Dialog>

  <Dialog
    :open="tokenToRevoke !== null"
    @update:open="(open) => { if (!open) closeRevokeConfirmation() }"
  >
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t("agentAccess.tokens.confirmTitle") }}</DialogTitle>
        <DialogDescription>
          {{ t("agentAccess.tokens.confirmDescription", { name: tokenToRevoke?.name ?? "" }) }}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button
          variant="outline"
          :disabled="revoking"
          @click="closeRevokeConfirmation"
        >
          {{ t("common.cancel") }}
        </Button>
        <Button
          data-testid="agent-access-confirm-revoke"
          variant="destructive"
          :disabled="revoking"
          @click="confirmRevokeToken"
        >
          {{ t("agentAccess.tokens.revoke") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
