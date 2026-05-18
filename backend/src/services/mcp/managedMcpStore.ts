import { randomUUID } from "crypto";
import { getStmts } from "../../database/stmtsHelper.js";
import { safeJsonParse } from "../../utils/safeJsonParse.js";

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

function normalizeNullableString(value: string | undefined | null): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

class ManagedMcpStore {
  private get stmts(): ReturnType<typeof getStmts>["managedMcp"] {
    return getStmts().managedMcp;
  }

  private rowToRecord(row: ManagedMcpServerRow): ManagedMcpServerRecord {
    return {
      id: row.id,
      name: row.name,
      transport: row.transport,
      command: row.command,
      args: normalizeArgs(safeJsonParse<unknown>(row.args_json)),
      cwd: row.cwd,
      env: normalizeEnv(safeJsonParse<unknown>(row.env_json)),
      url: row.url,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastKnownStatus: row.last_known_status,
      lastError: row.last_error,
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
    url: string | null;
  } {
    if (input.transport === "stdio") {
      const command = input.command.trim();
      if (!command) {
        throw new Error("stdio transport 需要 command");
      }
      return {
        command,
        argsJson: JSON.stringify(input.args ?? []),
        cwd: normalizeNullableString(input.cwd),
        envJson: JSON.stringify(input.env ?? {}),
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
      url,
    };
  }

  list(): ManagedMcpServerRecord[] {
    const rows = this.stmts.selectAll.all() as ManagedMcpServerRow[];
    return rows.map((row) => this.rowToRecord(row));
  }

  getById(id: string): ManagedMcpServerRecord | undefined {
    const row = this.stmts.selectById.get(id) as ManagedMcpServerRow | undefined;
    return row ? this.rowToRecord(row) : undefined;
  }

  getByName(name: string): ManagedMcpServerRecord | undefined {
    const row = this.stmts.selectByName.get(
      name,
    ) as ManagedMcpServerRow | undefined;
    return row ? this.rowToRecord(row) : undefined;
  }

  save(input: ManagedMcpServerInput): ManagedMcpServerRecord {
    const name = input.name.trim();
    if (!name) {
      throw new Error("managed MCP name 不可為空");
    }

    const timestamps = {
      now: nowIsoString(),
    };
    const serialized = this.buildSerializedFields(input);

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
        $updatedAt: timestamps.now,
      });
      return this.getById(existing.id)!;
    }

    this.assertUniqueName(name);

    const id = randomUUID();
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
      $createdAt: timestamps.now,
      $updatedAt: timestamps.now,
      $lastKnownStatus: "unknown",
      $lastError: null,
    });

    return this.getById(id)!;
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
    return result.changes > 0;
  }
}

export const managedMcpStore = new ManagedMcpStore();
