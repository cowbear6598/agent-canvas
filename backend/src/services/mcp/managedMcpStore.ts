import { randomUUID } from "crypto";
import { getStmts } from "../../database/stmtsHelper.js";
import { safeJsonParse } from "@shared/safeJsonParse.js";
import { secretStore } from "../secretStore.js";
import { logger } from "../../utils/logger.js";

const SECRET_STORAGE_VERSION = 1;

export type ManagedMcpTransport = "stdio" | "http" | "sse";
export type ManagedMcpRuntimeStatus =
  | "healthy"
  | "starting"
  | "error"
  | "idle"
  | "disabled"
  | "unknown";

interface ManagedMcpServerRow {
  id: string;
  name: string;
  transport: ManagedMcpTransport;
  command: string | null;
  args_json: string;
  cwd: string | null;
  env_json: string;
  url: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
  last_known_status: ManagedMcpRuntimeStatus;
  last_error: string | null;
  secret_storage_version: number;
}

interface ManagedMcpServerBaseInput {
  id?: string;
  name: string;
  enabled: boolean;
}

export type ManagedMcpServerInput =
  | (ManagedMcpServerBaseInput & {
      transport: "stdio";
      command: string;
      args?: string[];
      cwd?: string | null;
      env?: Record<string, string>;
      url?: never;
    })
  | (ManagedMcpServerBaseInput & {
      transport: "http" | "sse";
      url: string;
      command?: never;
      args?: never;
      cwd?: never;
      env?: never;
    });

export interface ManagedMcpServerRecord {
  id: string;
  name: string;
  transport: ManagedMcpTransport;
  command: string | null;
  args: string[];
  cwd: string | null;
  env: Record<string, string>;
  url: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastKnownStatus: ManagedMcpRuntimeStatus;
  lastError: string | null;
  requiresSecretSetup: boolean;
}

function nowIsoString(): string {
  return new Date().toISOString();
}

function normalizeArgs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string");
}

function normalizeEnv(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};

  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function normalizeNullableString(
  value: string | undefined | null,
): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function maskEnvValues(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.keys(env).map((key) => [key, ""]));
}

class ManagedMcpStore {
  private get stmts(): ReturnType<typeof getStmts>["managedMcp"] {
    return getStmts().managedMcp;
  }

  private rowToRecord(row: ManagedMcpServerRow): ManagedMcpServerRecord {
    const publicEnv = normalizeEnv(safeJsonParse<unknown>(row.env_json));
    const usesSecretStore =
      row.secret_storage_version >= SECRET_STORAGE_VERSION;
    const storedEnv = usesSecretStore
      ? secretStore.get("managed-mcp", row.id)
      : undefined;
    const requiresSecretSetup =
      usesSecretStore &&
      Object.keys(publicEnv).length > 0 &&
      storedEnv === undefined;
    const env = storedEnv ? normalizeEnv(storedEnv) : publicEnv;

    return {
      id: row.id,
      name: row.name,
      transport: row.transport,
      command: row.command,
      args: normalizeArgs(safeJsonParse<unknown>(row.args_json)),
      cwd: row.cwd,
      env,
      url: row.url,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastKnownStatus: row.last_known_status,
      lastError: row.last_error,
      requiresSecretSetup,
    };
  }

  private assertUniqueName(name: string, excludeId?: string): void {
    const existing = this.getByName(name);
    if (existing && existing.id !== excludeId) {
      throw new Error(`managed MCP name 已存在：${name}`);
    }
  }

  private buildSerializedFields(input: ManagedMcpServerInput): {
    command: string | null;
    argsJson: string;
    cwd: string | null;
    envJson: string;
    secretEnv: Record<string, string>;
    url: string | null;
  } {
    if (input.transport === "stdio") {
      const command = input.command.trim();
      if (!command) {
        throw new Error("stdio transport 需要 command");
      }
      const secretEnv = input.env ?? {};
      return {
        command,
        argsJson: JSON.stringify(input.args ?? []),
        cwd: normalizeNullableString(input.cwd),
        envJson: JSON.stringify(maskEnvValues(secretEnv)),
        secretEnv,
        url: null,
      };
    }

    const url = input.url.trim();
    if (!url) {
      throw new Error(`${input.transport} transport 需要 url`);
    }
    return {
      command: null,
      argsJson: JSON.stringify([]),
      cwd: null,
      envJson: JSON.stringify({}),
      secretEnv: {},
      url,
    };
  }

  list(): ManagedMcpServerRecord[] {
    const rows = this.stmts.selectAll.all() as ManagedMcpServerRow[];
    return rows.map((row) => this.rowToRecord(row));
  }

  getById(id: string): ManagedMcpServerRecord | undefined {
    const row = this.stmts.selectById.get(id) as
      | ManagedMcpServerRow
      | undefined;
    return row ? this.rowToRecord(row) : undefined;
  }

  getByName(name: string): ManagedMcpServerRecord | undefined {
    const row = this.stmts.selectByName.get(name) as
      | ManagedMcpServerRow
      | undefined;
    return row ? this.rowToRecord(row) : undefined;
  }

  private getRequiredById(id: string): ManagedMcpServerRecord {
    const record = this.getById(id);
    if (!record) {
      throw new Error(`寫入 managed MCP 後找不到資料：${id}`);
    }
    return record;
  }

  /**
   * 將 canvas.db 舊版 env_json 內的值搬到 secrets.db。
   */
  migrateSecrets(): void {
    const rows = this.stmts.selectAll.all() as ManagedMcpServerRow[];
    let migratedCount = 0;

    for (const row of rows) {
      if (row.secret_storage_version >= SECRET_STORAGE_VERSION) continue;

      const env = normalizeEnv(safeJsonParse<unknown>(row.env_json));
      if (Object.keys(env).length > 0) {
        secretStore.set("managed-mcp", row.id, env);
      }
      this.stmts.updateEnvAndSecretVersion.run({
        $id: row.id,
        $envJson: JSON.stringify(maskEnvValues(env)),
        $secretStorageVersion: SECRET_STORAGE_VERSION,
      });
      migratedCount += 1;
    }

    if (migratedCount > 0) {
      logger.log(
        "McpServer",
        "Update",
        `已將 ${migratedCount} 筆 managed MCP 環境變數搬移至 secrets.db`,
      );
    }
  }

  save(input: ManagedMcpServerInput): ManagedMcpServerRecord {
    const name = input.name.trim();
    if (!name) {
      throw new Error("managed MCP name 不可為空");
    }

    const serialized = this.buildSerializedFields(input);
    const now = nowIsoString();
    const id = input.id ?? randomUUID();
    const previousSecret = input.id
      ? secretStore.get("managed-mcp", input.id)
      : undefined;

    if (Object.keys(serialized.secretEnv).length > 0) {
      secretStore.set("managed-mcp", id, serialized.secretEnv);
    } else {
      secretStore.delete("managed-mcp", id);
    }

    try {
      if (input.id) {
        const existing = this.getById(input.id);
        if (!existing) {
          throw new Error(`managed MCP 不存在：${input.id}`);
        }
        this.assertUniqueName(name, existing.id);
        this.stmts.update.run({
          $id: existing.id,
          $name: name,
          $transport: input.transport,
          $command: serialized.command,
          $argsJson: serialized.argsJson,
          $cwd: serialized.cwd,
          $envJson: serialized.envJson,
          $url: serialized.url,
          $enabled: input.enabled ? 1 : 0,
          $updatedAt: now,
          $secretStorageVersion: SECRET_STORAGE_VERSION,
        });
        return this.getRequiredById(existing.id);
      }

      this.assertUniqueName(name);
      this.stmts.insert.run({
        $id: id,
        $name: name,
        $transport: input.transport,
        $command: serialized.command,
        $argsJson: serialized.argsJson,
        $cwd: serialized.cwd,
        $envJson: serialized.envJson,
        $url: serialized.url,
        $enabled: input.enabled ? 1 : 0,
        $createdAt: now,
        $updatedAt: now,
        $lastKnownStatus: "unknown",
        $lastError: null,
        $secretStorageVersion: SECRET_STORAGE_VERSION,
      });
      return this.getRequiredById(id);
    } catch (error) {
      if (previousSecret) {
        secretStore.set("managed-mcp", id, previousSecret);
      } else {
        secretStore.delete("managed-mcp", id);
      }
      throw error;
    }
  }

  updateRuntimeState(
    name: string,
    status: ManagedMcpRuntimeStatus,
    lastError: string | null = null,
  ): ManagedMcpServerRecord | undefined {
    const existing = this.getByName(name);
    if (!existing) return undefined;

    this.stmts.updateRuntimeState.run({
      $name: name,
      $lastKnownStatus: status,
      $lastError: lastError,
      $updatedAt: nowIsoString(),
    });

    return this.getByName(name);
  }

  delete(id: string): boolean {
    const result = this.stmts.deleteById.run(id);
    if (result.changes > 0) {
      secretStore.delete("managed-mcp", id);
    }
    return result.changes > 0;
  }
}

export const managedMcpStore = new ManagedMcpStore();
