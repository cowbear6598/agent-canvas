import { describe, it, expect } from "vitest";
import {
  RESOURCE_NAME_PATTERN,
  BRANCH_NAME_PATTERN,
  validateResourceName,
  validateGitUrl,
  isValidBranchName,
} from "@/lib/validators";

describe("validators", () => {
  describe("RESOURCE_NAME_PATTERN", () => {
    it("應接受英數字", () => {
      expect(RESOURCE_NAME_PATTERN.test("abc123")).toBe(true);
    });

    it("應接受底線", () => {
      expect(RESOURCE_NAME_PATTERN.test("my_repo")).toBe(true);
    });

    it("應接受連字號", () => {
      expect(RESOURCE_NAME_PATTERN.test("my-repo")).toBe(true);
    });

    it("應拒絕空格", () => {
      expect(RESOURCE_NAME_PATTERN.test("my repo")).toBe(false);
    });

    it("應拒絕斜線", () => {
      expect(RESOURCE_NAME_PATTERN.test("my/repo")).toBe(false);
    });

    it("應拒絕中文", () => {
      expect(RESOURCE_NAME_PATTERN.test("資料夾")).toBe(false);
    });
  });

  describe("BRANCH_NAME_PATTERN", () => {
    it("應接受英數字", () => {
      expect(BRANCH_NAME_PATTERN.test("feature123")).toBe(true);
    });

    it("應接受斜線", () => {
      expect(BRANCH_NAME_PATTERN.test("feature/my-branch")).toBe(true);
    });

    it("應接受底線", () => {
      expect(BRANCH_NAME_PATTERN.test("my_branch")).toBe(true);
    });

    it("應接受連字號", () => {
      expect(BRANCH_NAME_PATTERN.test("my-branch")).toBe(true);
    });

    it("應拒絕空格", () => {
      expect(BRANCH_NAME_PATTERN.test("my branch")).toBe(false);
    });

    it("應拒絕中文", () => {
      expect(BRANCH_NAME_PATTERN.test("分支")).toBe(false);
    });
  });

  describe("validateResourceName", () => {
    it("空字串應回傳空值錯誤訊息", () => {
      expect(validateResourceName("", "請輸入名稱", "格式錯誤")).toBe(
        "請輸入名稱",
      );
    });

    it("純空白應回傳空值錯誤訊息", () => {
      expect(validateResourceName("   ", "請輸入名稱", "格式錯誤")).toBe(
        "請輸入名稱",
      );
    });

    it("包含空格應回傳格式錯誤訊息", () => {
      expect(validateResourceName("my folder", "請輸入名稱", "格式錯誤")).toBe(
        "格式錯誤",
      );
    });

    it("包含中文應回傳格式錯誤訊息", () => {
      expect(validateResourceName("資料夾", "請輸入名稱", "格式錯誤")).toBe(
        "格式錯誤",
      );
    });

    it("合法名稱應回傳 null", () => {
      expect(
        validateResourceName("my-repo_123", "請輸入名稱", "格式錯誤"),
      ).toBeNull();
    });
  });

  describe("validateGitUrl", () => {
    it("空字串應回傳錯誤", () => {
      expect(validateGitUrl("")).toBe("請輸入 Git Repository URL");
    });

    it("純空白應回傳錯誤", () => {
      expect(validateGitUrl("   ")).toBe("請輸入 Git Repository URL");
    });

    it("非 https 或 git@ 開頭應回傳錯誤", () => {
      expect(validateGitUrl("http://github.com/user/repo")).toBe(
        "URL 必須以 https:// 或 git@ 開頭",
      );
    });

    it("ftp:// 開頭應回傳錯誤", () => {
      expect(validateGitUrl("ftp://github.com/user/repo")).toBe(
        "URL 必須以 https:// 或 git@ 開頭",
      );
    });

    it("https:// 開頭應通過", () => {
      expect(validateGitUrl("https://github.com/user/repo")).toBeNull();
    });

    it("git@ 開頭應通過", () => {
      expect(validateGitUrl("git@github.com:user/repo.git")).toBeNull();
    });

    it("前後空白應自動 trim 後驗證", () => {
      expect(validateGitUrl("  https://github.com/user/repo  ")).toBeNull();
    });
  });

  describe("isValidBranchName", () => {
    it("英數字應合法", () => {
      expect(isValidBranchName("feature123")).toBe(true);
    });

    it("包含斜線應合法", () => {
      expect(isValidBranchName("feature/my-branch")).toBe(true);
    });

    it("包含底線應合法", () => {
      expect(isValidBranchName("my_branch")).toBe(true);
    });

    it("包含連字號應合法", () => {
      expect(isValidBranchName("my-branch")).toBe(true);
    });

    it("包含空格應不合法", () => {
      expect(isValidBranchName("my branch")).toBe(false);
    });

    it("連續斜線應不合法", () => {
      expect(isValidBranchName("feature//branch")).toBe(false);
    });

    it("以斜線開頭應不合法", () => {
      expect(isValidBranchName("/feature")).toBe(false);
    });

    it("以斜線結尾應不合法", () => {
      expect(isValidBranchName("feature/")).toBe(false);
    });

    it("包含中文應不合法", () => {
      expect(isValidBranchName("分支")).toBe(false);
    });
  });
});
