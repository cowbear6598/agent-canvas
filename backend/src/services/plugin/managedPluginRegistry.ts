import { getStmts } from "../../database/stmtsHelper.js";
import { getDb } from "../../database/index.js";
import { ok, err } from "../../types/result.js";
import type { Result } from "../../types/result.js";

export type ManagedBundleSourceType = "github" | "upload";

export interface ManagedBundleSource {
  type: ManagedBundleSourceType;
  ref: string;
}

export interface ManagedPluginRecord {
  id: string;
  source: ManagedBundleSource;
  githubRepo: string;
  displayName: string | null;
  description: string | null;
  installPath: string;
  sortIndex: number;
  installedAt: string;
  updatedAt: string;
}

type ManagedPluginInsertRecord = Omit<ManagedPluginRecord, "sortIndex"> &
  Partial<Pick<ManagedPluginRecord, "sortIndex">>;

interface ManagedPluginRow {
  id: string;
  github_repo: string;
  source_type: ManagedBundleSourceType;
  source_ref: string;
  display_name: string | null;
  description: string | null;
  install_path: string;
  sort_index: number;
  installed_at: string;
  updated_at: string;
}

function resolveSource(
  record:
    | Pick<ManagedPluginRecord, "id" | "githubRepo"> &
        Partial<Pick<ManagedPluginRecord, "source">>
    | ManagedPluginRow,
): ManagedBundleSource {
  if ("source" in record && record.source) {
    return record.source;
  }

  if ("source_type" in record && "source_ref" in record) {
    return {
      type: record.source_type,
      ref: record.source_ref,
    };
  }

  return {
    type: "github",
    ref: record.githubRepo || record.id,
  };
}

function nowIsoString(): string {
  return new Date().toISOString();
}

function rowToRecord(row: ManagedPluginRow): ManagedPluginRecord {
  return {
    id: row.id,
    source: resolveSource(row),
    githubRepo: row.github_repo,
    displayName: row.display_name,
    description: row.description,
    installPath: row.install_path,
    sortIndex: row.sort_index,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
  };
}

class ManagedPluginStore {
  private get stmts(): ReturnType<typeof getStmts>["managedPlugin"] {
    return getStmts().managedPlugin;
  }

  list(): ManagedPluginRecord[] {
    const rows = this.stmts.selectAll.all() as ManagedPluginRow[];
    return rows.map(rowToRecord);
  }

  getById(id: string): ManagedPluginRecord | null {
    const row = this.stmts.selectById.get(id) as ManagedPluginRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  getBySource(
    source: ManagedBundleSource,
  ): ManagedPluginRecord | null {
    const row = this.stmts.selectBySource.get(
      source.type,
      source.ref,
    ) as ManagedPluginRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  getByGithubRepo(repo: string): ManagedPluginRecord | null {
    const row = this.stmts.selectByGithubRepo.get(repo) as
      | ManagedPluginRow
      | undefined;
    return row ? rowToRecord(row) : null;
  }

  private nextSortIndex(): number {
    const row = this.stmts.selectMaxSortIndex.get() as { max_index: number };
    return row.max_index + 1;
  }

  insert(record: ManagedPluginInsertRecord): ManagedPluginRecord {
    const sortIndex = record.sortIndex ?? this.nextSortIndex();
    const source = resolveSource(record);
    this.stmts.insert.run({
      $id: record.id,
      $githubRepo: record.githubRepo,
      $sourceType: source.type,
      $sourceRef: source.ref,
      $displayName: record.displayName,
      $description: record.description,
      $installPath: record.installPath,
      $sortIndex: sortIndex,
      $installedAt: record.installedAt,
      $updatedAt: record.updatedAt,
    });
    return this.getById(record.id)!;
  }

  update(
    id: string,
    partial: Partial<
      Pick<
        ManagedPluginRecord,
        "displayName" | "description" | "installPath" | "updatedAt"
      >
    >,
  ): ManagedPluginRecord | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const now = nowIsoString();
    this.stmts.update.run({
      $id: id,
      $displayName:
        "displayName" in partial
          ? (partial.displayName ?? null)
          : existing.displayName,
      $description:
        "description" in partial
          ? (partial.description ?? null)
          : existing.description,
      $installPath: partial.installPath ?? existing.installPath,
      $updatedAt: partial.updatedAt ?? now,
    });
    return this.getById(id);
  }

  delete(id: string): boolean {
    const result = this.stmts.deleteById.run(id);
    return result.changes > 0;
  }

  reorder(pluginIds: string[]): Result<ManagedPluginRecord[]> {
    if (new Set(pluginIds).size !== pluginIds.length) {
      return err("PLUGIN_REORDER_DUPLICATE_IDS");
    }

    const plugins = this.list();
    const pluginMap = new Map(plugins.map((plugin) => [plugin.id, plugin]));
    for (const pluginId of pluginIds) {
      if (!pluginMap.has(pluginId)) {
        return err("PLUGIN_NOT_FOUND");
      }
    }

    const reorderedPluginIdSet = new Set(pluginIds);
    const remainingPluginIds = plugins
      .filter((plugin) => !reorderedPluginIdSet.has(plugin.id))
      .map((plugin) => plugin.id);
    const finalPluginIds = [...pluginIds, ...remainingPluginIds];

    const updateSortIndex = getDb().prepare(
      "UPDATE managed_plugins SET sort_index = ? WHERE id = ?",
    );
    const transaction = getDb().transaction(() => {
      finalPluginIds.forEach((pluginId, index) => {
        updateSortIndex.run(index, pluginId);
      });
    });
    transaction();

    return ok(this.list());
  }
}

export const managedPluginStore = new ManagedPluginStore();
