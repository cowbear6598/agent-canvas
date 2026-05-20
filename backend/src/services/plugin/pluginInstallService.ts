import path from "path";
import fs from "fs";
import { simpleGit } from "simple-git";
import { ok, err } from "../../types/result.js";
import type { Result } from "../../types/result.js";
import {
  gitOperation,
  gitOperationWithPath,
  fsOperation,
} from "../../utils/operationHelpers.js";
import { parseGithubRepo, GITHUB_HTTPS_PREFIX } from "./githubRepoParser.js";
import { resolveInstallPath } from "./pluginPaths.js";
import { managedPluginStore } from "./managedPluginRegistry.js";
import type { ManagedPluginRecord } from "./managedPluginRegistry.js";
import { getDb } from "../../database/index.js";
import { logger } from "../../utils/logger.js";

// ─── extractPluginMetadata ──────────────────────────────────────────────────

async function extractPluginMetadata(
  installPath: string,
  repo: string,
): Promise<{ displayName: string; description: string | null }> {
  try {
    const metaPath = path.join(installPath, ".claude-plugin", "plugin.json");
    const raw = await fs.promises.readFile(metaPath, "utf-8");
    const meta = JSON.parse(raw);
    const displayName =
      typeof meta?.name === "string" && meta.name ? meta.name : repo;
    const description =
      typeof meta?.description === "string" ? meta.description : null;
    return { displayName, description };
  } catch (error) {
    let reason: string;
    if (error instanceof SyntaxError) {
      reason = "JSON 損毀";
    } else if (error instanceof Error && "code" in error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        reason = "檔案不存在";
      } else if (code === "EACCES") {
        reason = "權限不足";
      } else {
        reason = error.message;
      }
    } else {
      reason = String(error);
    }
    logger.warn(
      "Plugin",
      "Warn",
      `讀取 plugin.json 失敗，路徑: ${installPath}，原因: ${reason}`,
    );
    return { displayName: repo, description: null };
  }
}

// ─── installPlugin ──────────────────────────────────────────────────────────

export async function installPlugin(
  githubRepo: string,
): Promise<Result<ManagedPluginRecord>> {
  const parsed = parseGithubRepo(githubRepo);
  if (!parsed) {
    return err("INVALID_GITHUB_REPO_FORMAT");
  }

  const { owner, repo, fullName } = parsed;
  const installPath = resolveInstallPath(fullName);

  // 重複安裝檢查
  const existing = managedPluginStore.getByGithubRepo(fullName);
  if (existing) {
    return err("PLUGIN_ALREADY_INSTALLED");
  }

  // Clone
  const httpsUrl = `${GITHUB_HTTPS_PREFIX}${owner}/${repo}.git`;
  const cloneResult = await gitOperation(
    () => simpleGit().clone(httpsUrl, installPath),
    `clone plugin ${fullName}`,
  );
  if (!cloneResult.success) {
    return err(
      typeof cloneResult.error === "string"
        ? cloneResult.error
        : cloneResult.error.key,
    );
  }

  // 讀取 metadata（best effort，失敗時使用 fallback）
  const { displayName, description } = await extractPluginMetadata(
    installPath,
    repo,
  );

  const now = new Date().toISOString();
  const record = managedPluginStore.insert({
    id: fullName,
    githubRepo: fullName,
    displayName,
    description,
    installPath,
    installedAt: now,
    updatedAt: now,
  });

  return ok(record);
}

// ─── removePlugin ───────────────────────────────────────────────────────────

export async function removePlugin(id: string): Promise<Result<void>> {
  const record = managedPluginStore.getById(id);
  if (!record) {
    return err("PLUGIN_NOT_FOUND");
  }

  const rmResult = await fsOperation(
    () => fs.promises.rm(record.installPath, { recursive: true, force: true }),
    `rm plugin dir ${record.installPath}`,
  );
  if (!rmResult.success) {
    return err(
      typeof rmResult.error === "string" ? rmResult.error : rmResult.error.key,
    );
  }

  // 手動清除所有 Pod 對此 plugin 的勾選（pod_plugin_ids 無 FK 指向 managed_plugins）
  getDb().prepare("DELETE FROM pod_plugin_ids WHERE plugin_id = ?").run(id);

  managedPluginStore.delete(id);

  return ok();
}

// ─── updatePlugin ───────────────────────────────────────────────────────────

export async function updatePlugin(
  id: string,
): Promise<Result<ManagedPluginRecord>> {
  const record = managedPluginStore.getById(id);
  if (!record) {
    return err("PLUGIN_NOT_FOUND");
  }

  const parsed = parseGithubRepo(record.githubRepo);
  if (!parsed) {
    return err("INVALID_GITHUB_REPO_FORMAT");
  }

  const { owner, repo } = parsed;

  // 刪除舊目錄
  const rmResult = await fsOperation(
    () => fs.promises.rm(record.installPath, { recursive: true, force: true }),
    `rm plugin dir ${record.installPath}`,
  );
  if (!rmResult.success) {
    return err(
      typeof rmResult.error === "string" ? rmResult.error : rmResult.error.key,
    );
  }

  // 重新 clone
  const httpsUrl = `${GITHUB_HTTPS_PREFIX}${owner}/${repo}.git`;
  const cloneResult = await gitOperation(
    () => simpleGit().clone(httpsUrl, record.installPath),
    `update clone plugin ${record.githubRepo}`,
  );
  if (!cloneResult.success) {
    return err(
      typeof cloneResult.error === "string"
        ? cloneResult.error
        : cloneResult.error.key,
    );
  }

  // 重新讀取 metadata
  const { displayName, description } = await extractPluginMetadata(
    record.installPath,
    repo,
  );

  const updatedRecord = managedPluginStore.update(id, {
    displayName,
    description,
    updatedAt: new Date().toISOString(),
  });

  if (!updatedRecord) {
    return err("PLUGIN_UPDATE_FAILED");
  }

  return ok(updatedRecord);
}

// ─── refreshAllPlugins ──────────────────────────────────────────────────────

export async function refreshAllPlugins(): Promise<
  Result<ManagedPluginRecord[]>
> {
  const records = managedPluginStore.list();

  const refreshOnePlugin = async (
    record: ManagedPluginRecord,
  ): Promise<ManagedPluginRecord> => {
    const refreshResult = await gitOperationWithPath(
      record.installPath,
      async (git) => {
        await git.fetch();
        const head = await git.revparse(["HEAD"]);
        const remoteHead = await git.revparse(["@{u}"]);
        if (head !== remoteHead) {
          await git.pull();
          return true; // 有 pull
        }
        return false; // 無更新
      },
      `refresh plugin ${record.githubRepo}`,
    );

    if (refreshResult.success && refreshResult.data === true) {
      // 有 pull，更新 updatedAt
      const updated = managedPluginStore.update(record.id, {
        updatedAt: new Date().toISOString(),
      });
      return updated ?? record;
    }

    return record;
  };

  const updatedRecords = await Promise.all(records.map(refreshOnePlugin));
  return ok(updatedRecords);
}
