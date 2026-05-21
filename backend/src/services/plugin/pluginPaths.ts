import path from "path";
import { config } from "../../config/index.js";

export function getPluginsRoot(): string {
  return config.pluginsRoot;
}

/**
 * 將 GitHub owner/repo 轉換為安全的檔案系統資料夾名稱：
 * 把 `/` 換成 `__`，並過濾掉不允許的字元（只保留 A-Za-z0-9._-）
 */
export function sanitizeGithubRepoForFs(owner: string, repo: string): string {
  const combined = `${owner}__${repo}`;
  return combined.replace(/[^A-Za-z0-9._-]/g, "");
}

/**
 * 回傳指定 githubRepo（owner/repo 格式）的絕對安裝路徑
 */
export function resolveInstallPath(githubRepo: string): string {
  const [owner, repo] = githubRepo.split("/");
  const folderName = sanitizeGithubRepoForFs(owner ?? "", repo ?? "");
  return path.join(getPluginsRoot(), folderName);
}
