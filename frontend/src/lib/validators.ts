import { t } from "@/i18n";

/** 資源名稱驗證模式：只允許英數字、底線、連字號 */
export const RESOURCE_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** 分支名稱驗證模式：允許英數字、底線、連字號和斜線 */
export const BRANCH_NAME_PATTERN = /^[a-zA-Z0-9_\-/]+$/;

const invalidBranchNameRules: Array<(name: string) => boolean> = [
  (name): boolean => !BRANCH_NAME_PATTERN.test(name),
  (name): boolean => !name || name.length > 200,
  (name): boolean => name.startsWith("-"),
  (name): boolean => name.includes("//"),
  (name): boolean => name.includes("..") || name.includes("@{"),
  (name): boolean =>
    name === "." || name.endsWith(".") || name.endsWith(".lock"),
  (name): boolean => name.startsWith("/") || name.endsWith("/"),
];

/**
 * 驗證資源名稱（Repository 等）
 * @param name 名稱字串
 * @param emptyMessage 空值時的錯誤訊息
 * @param invalidMessage 格式錯誤時的錯誤訊息
 * @returns 錯誤訊息，若驗證通過則回傳 null
 */
export const validateResourceName = (
  name: string,
  emptyMessage: string,
  invalidMessage: string,
): string | null => {
  if (!name.trim()) {
    return emptyMessage;
  }
  if (!RESOURCE_NAME_PATTERN.test(name)) {
    return invalidMessage;
  }
  return null;
};

/**
 * 驗證 Git Repository URL
 * @param url URL 字串
 * @returns 錯誤訊息，若驗證通過則回傳 null
 */
export const validateGitUrl = (url: string): string | null => {
  const trimmedUrl = url.trim();

  if (!trimmedUrl) {
    return t("validation.gitUrlRequired");
  }

  if (!trimmedUrl.startsWith("https://") && !trimmedUrl.startsWith("git@")) {
    return t("validation.gitUrlPrefix");
  }

  return null;
};

/**
 * 驗證分支名稱
 * @param name 分支名稱
 * @returns 是否合法
 */
export const isValidBranchName = (name: string): boolean => {
  return !invalidBranchNameRules.some((isInvalid) => isInvalid(name));
};
