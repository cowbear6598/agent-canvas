import fs from "fs";
import os from "os";
import path from "path";

const WHITELIST_FILE_NAME = "sandbox-whitelist.txt";

const DEFAULT_DOMAINS: string[] = [
  "registry.npmjs.org",
  "registry.yarnpkg.com",
  "pypi.org",
  "*.pypi.org",
  "pypi.python.org",
  "files.pythonhosted.org",
  "api.github.com",
  "github.com",
  "*.githubusercontent.com",
  "api.anthropic.com",
  "*.atlassian.net",
  "api.atlassian.com",
  "slack.com",
  "*.slack.com",
  "hooks.slack.com",
  "sentry.io",
  "*.sentry.io",
  "threads.net",
  "*.threads.net",
  "graph.threads.net",
  "graph.facebook.com",
  "discord.com",
  "*.discord.com",
  "gitlab.com",
];

/**
 * 回傳 AgentCanvas 的資料目錄路徑。
 *
 * 獨立計算，不依賴 cli.ts，避免循環引用。
 */
export function getDataDir(): string {
  return path.join(os.homedir(), "Documents", "AgentCanvas");
}

/**
 * 載入網域白名單。
 *
 * - 若白名單檔案不存在 → 初始化預設清單並直接回傳
 * - 若白名單檔案存在 → 讀取並回傳（過濾空行）
 */
export function loadDomainWhitelist(dataDir = getDataDir()): string[] {
  const file = path.join(dataDir, WHITELIST_FILE_NAME);

  if (!fs.existsSync(file)) {
    initDefaultWhitelist(dataDir);
    return DEFAULT_DOMAINS;
  }

  return fs
    .readFileSync(file, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * 新增網域至白名單。
 *
 * - 驗證失敗 → throw
 * - 已存在 → 回傳 `{ added: false }`
 * - 新增成功 → 回傳 `{ added: true }`
 */
export function addDomain(
  domain: string,
  dataDir = getDataDir(),
): { added: boolean } {
  validateDomain(domain);

  const existing = loadDomainWhitelist(dataDir);

  if (existing.includes(domain)) {
    return { added: false };
  }

  const file = path.join(dataDir, WHITELIST_FILE_NAME);
  fs.appendFileSync(file, domain + "\n");
  return { added: true };
}

/**
 * 從白名單移除網域。
 *
 * - 不存在 → throw
 * - 移除成功 → 重寫整個白名單檔案
 */
export function removeDomain(domain: string, dataDir = getDataDir()): void {
  const existing = loadDomainWhitelist(dataDir);

  if (!existing.includes(domain)) {
    throw new Error(`${domain} 不在白名單中`);
  }

  const file = path.join(dataDir, WHITELIST_FILE_NAME);
  const updated = existing.filter((d) => d !== domain);
  fs.writeFileSync(file, updated.join("\n") + "\n");
}

/**
 * 驗證網域格式。驗證失敗時 throw Error。
 *
 * 規則：
 * - 不可為空字串
 * - 不可含 `://`、`/`、空白字元
 * - 不可等於 `*`
 * - `*` 只能出現在開頭
 * - 開頭 `*` 後一字元必須是 `.`（只允許 `*.foo.com`，拒絕 `*foo.com`）
 * - 不可以 `.` 開頭或結尾
 */
export function validateDomain(domain: string): void {
  if (domain === "") {
    throw new Error("網域不可為空字串");
  }

  if (domain.includes("://")) {
    throw new Error(
      `網域不可包含協議（如 https://），請只填入網域名稱：${domain}`,
    );
  }

  if (domain.includes("/")) {
    throw new Error(`網域不可包含路徑字元 /：${domain}`);
  }

  if (/\s/.test(domain)) {
    throw new Error(`網域不可包含空白字元：${domain}`);
  }

  if (domain === "*") {
    throw new Error("不允許使用萬用字元 * 作為網域");
  }

  const wildcardIndex = domain.indexOf("*");
  if (wildcardIndex !== -1 && wildcardIndex !== 0) {
    throw new Error(`萬用字元 * 只能出現在開頭：${domain}`);
  }

  if (domain.startsWith("*") && domain[1] !== ".") {
    throw new Error(
      `萬用字元開頭必須接 .（例如 *.foo.com），不允許：${domain}`,
    );
  }

  if (domain.startsWith(".")) {
    throw new Error(`網域不可以 . 開頭：${domain}`);
  }

  if (domain.endsWith(".")) {
    throw new Error(`網域不可以 . 結尾：${domain}`);
  }
}

/**
 * 初始化預設白名單檔案。
 *
 * 確保目錄存在後，將 DEFAULT_DOMAINS 寫入白名單檔案。
 */
function initDefaultWhitelist(dataDir: string): void {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, WHITELIST_FILE_NAME);
  fs.writeFileSync(file, DEFAULT_DOMAINS.join("\n") + "\n");
}
