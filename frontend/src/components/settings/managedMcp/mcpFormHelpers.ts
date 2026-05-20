import type {
  ManagedMcpRegistryInput,
  ManagedMcpRegistryItem,
  McpTransport,
} from "@/types/mcp";

export interface ManagedMcpFormState {
  id?: string;
  name: string;
  transport: McpTransport;
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

export function createArgRow(value = ""): { id: string; value: string } {
  return { id: nextDraftRowId("arg"), value };
}

export function createEnvRow(
  key = "",
  value = "",
): { id: string; key: string; value: string } {
  return { id: nextDraftRowId("env"), key, value };
}

export function createEmptyForm(): ManagedMcpFormState {
  return {
    name: "",
    transport: "stdio",
    command: "",
    args: [],
    cwd: "",
    envRows: [],
    url: "",
  };
}

export function createFormFromItem(
  item: ManagedMcpRegistryItem,
): ManagedMcpFormState {
  return {
    id: item.id,
    name: item.name,
    transport: item.transport,
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

/**
 * 從 form draft 與既有條目組裝儲存 payload。
 * enabled 沿用 selectedEntry 當下狀態（由左側 Switch 控管），新增時預設 true，
 * 避免 form 端持有 stale 副本而蓋掉 Switch 的最新切換結果。
 */
export function buildSavePayload(
  draft: ManagedMcpFormState,
  selectedEntry: ManagedMcpRegistryItem | null,
): ManagedMcpRegistryInput {
  const basePayload = {
    ...(draft.id ? { id: draft.id } : {}),
    name: draft.name.trim(),
    enabled: selectedEntry?.enabled ?? true,
  };

  if (draft.transport === "stdio") {
    return {
      ...basePayload,
      transport: "stdio",
      command: draft.command.trim(),
      args: parseArgs(draft.args),
      cwd: draft.cwd.trim() || null,
      env: parseEnv(draft.envRows),
    };
  }

  return {
    ...basePayload,
    transport: draft.transport,
    url: draft.url.trim(),
  };
}

export function validateDraft(
  draft: ManagedMcpFormState,
  t: (key: string) => string,
): string | null {
  if (!draft.name.trim()) {
    return t("common.validation.nameRequired");
  }

  if (draft.transport === "stdio" && draft.command.trim().length === 0) {
    return t("managedMcp.validation.commandRequired");
  }

  if (draft.transport !== "stdio" && draft.url.trim().length === 0) {
    return t("managedMcp.validation.urlRequired");
  }

  return null;
}

const LAST_ERROR_MAX_LENGTH = 800;

export function truncateLastError(message: string): string {
  if (message.length <= LAST_ERROR_MAX_LENGTH) return message;
  return `${message.slice(0, LAST_ERROR_MAX_LENGTH)}…（已截斷）`;
}
