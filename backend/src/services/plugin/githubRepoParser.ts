export const GITHUB_HTTPS_PREFIX = "https://github.com/";

const VALID_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

export interface ParsedGithubRepo {
  owner: string;
  repo: string;
  fullName: string;
}

/**
 * 解析 "owner/repo" 格式字串。
 * owner 與 repo 各自只允許 [A-Za-z0-9._-] 且不可為空。
 * 驗證失敗時回傳 null。
 */
export function parseGithubRepo(input: string): ParsedGithubRepo | null {
  if (!input || typeof input !== "string") return null;

  const parts = input.trim().split("/");
  if (parts.length !== 2) return null;

  const [owner, repo] = parts;
  if (!owner || !repo) return null;
  if (!VALID_SEGMENT_RE.test(owner) || !VALID_SEGMENT_RE.test(repo))
    return null;

  return { owner, repo, fullName: `${owner}/${repo}` };
}
