import { getStmts } from "../../database/stmtsHelper.js";

export interface ManagedPluginRecord {
  id: string;
  githubRepo: string;
  displayName: string | null;
  description: string | null;
  installPath: string;
  installedAt: string;
  updatedAt: string;
}

interface ManagedPluginRow {
  id: string;
  github_repo: string;
  display_name: string | null;
  description: string | null;
  install_path: string;
  installed_at: string;
  updated_at: string;
}

function nowIsoString(): string {
  return new Date().toISOString();
}

function rowToRecord(row: ManagedPluginRow): ManagedPluginRecord {
  return {
    id: row.id,
    githubRepo: row.github_repo,
    displayName: row.display_name,
    description: row.description,
    installPath: row.install_path,
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

  getByGithubRepo(repo: string): ManagedPluginRecord | null {
    const row = this.stmts.selectByGithubRepo.get(repo) as
      | ManagedPluginRow
      | undefined;
    return row ? rowToRecord(row) : null;
  }

  insert(record: ManagedPluginRecord): ManagedPluginRecord {
    this.stmts.insert.run({
      $id: record.id,
      $githubRepo: record.githubRepo,
      $displayName: record.displayName,
      $description: record.description,
      $installPath: record.installPath,
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
}

export const managedPluginStore = new ManagedPluginStore();
