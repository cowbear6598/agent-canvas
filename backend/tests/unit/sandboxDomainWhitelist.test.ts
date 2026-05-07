import fs from "fs";
import path from "path";
import os from "os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loadDomainWhitelist,
  addDomain,
  removeDomain,
  validateDomain,
} from "../../src/services/claude/sandboxDomainWhitelist.js";

// 每個 test 使用獨立的 tmp 目錄，避免測試間互相干擾
let TMP_DIR: string;

beforeEach(() => {
  TMP_DIR = path.join(
    os.tmpdir(),
    `sandbox-whitelist-test-${crypto.randomUUID()}`,
  );
  fs.mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

// ────────────────────────────────────────────────
// B1 & B2 & B3: loadDomainWhitelist
// ────────────────────────────────────────────────
describe("loadDomainWhitelist", () => {
  describe("B1: 白名單檔案不存在時，自動建立預設清單", () => {
    it("呼叫後白名單檔案應被建立", () => {
      loadDomainWhitelist(TMP_DIR);
      const file = path.join(TMP_DIR, "sandbox-whitelist.txt");
      expect(fs.existsSync(file)).toBe(true);
    });

    it("自動建立的檔案應包含 27 行預設 domain", () => {
      loadDomainWhitelist(TMP_DIR);
      const file = path.join(TMP_DIR, "sandbox-whitelist.txt");
      const lines = fs
        .readFileSync(file, "utf-8")
        .split("\n")
        .filter((l) => l.trim() !== "");
      expect(lines).toHaveLength(27);
    });

    it("回傳值應包含 27 個預設 domain", () => {
      const result = loadDomainWhitelist(TMP_DIR);
      expect(result).toHaveLength(27);
    });
  });

  describe("B2: 白名單檔案存在時，讀取並回傳每行的 domain", () => {
    it("回傳值應與檔案內容相符", () => {
      const file = path.join(TMP_DIR, "sandbox-whitelist.txt");
      fs.writeFileSync(file, "foo.com\nbar.com\nbaz.org\n", "utf-8");

      const result = loadDomainWhitelist(TMP_DIR);
      expect(result).toEqual(["foo.com", "bar.com", "baz.org"]);
    });
  });

  describe("B3: 檔案內含空白行或前後空白時，仍回傳乾淨清單", () => {
    it("過濾空白行並 trim 每個 domain", () => {
      const file = path.join(TMP_DIR, "sandbox-whitelist.txt");
      fs.writeFileSync(file, "\n  foo.com  \n\n  bar.com\n\n", "utf-8");

      const result = loadDomainWhitelist(TMP_DIR);
      expect(result).toEqual(["foo.com", "bar.com"]);
    });
  });
});

// ────────────────────────────────────────────────
// B4 & B5 & B6: addDomain
// ────────────────────────────────────────────────
describe("addDomain", () => {
  describe("B4: 新增有效 domain 時，寫入檔案尾巴並回傳 { added: true }", () => {
    it("新 domain 出現在檔案最後一行", () => {
      // 先建立含有一個 domain 的白名單
      const file = path.join(TMP_DIR, "sandbox-whitelist.txt");
      fs.writeFileSync(file, "foo.com\n", "utf-8");

      const result = addDomain("bar.com", TMP_DIR);
      expect(result).toEqual({ added: true });

      const domains = loadDomainWhitelist(TMP_DIR);
      expect(domains).toContain("bar.com");
      expect(domains[domains.length - 1]).toBe("bar.com");
    });

    it("新增 wildcard domain 也應成功", () => {
      const file = path.join(TMP_DIR, "sandbox-whitelist.txt");
      fs.writeFileSync(file, "foo.com\n", "utf-8");

      const result = addDomain("*.example.com", TMP_DIR);
      expect(result).toEqual({ added: true });

      const domains = loadDomainWhitelist(TMP_DIR);
      expect(domains).toContain("*.example.com");
    });
  });

  describe("B5: 新增已存在的 domain 時，回傳 { added: false } 且檔案不變", () => {
    it("回傳 { added: false }", () => {
      const file = path.join(TMP_DIR, "sandbox-whitelist.txt");
      fs.writeFileSync(file, "foo.com\n", "utf-8");

      const result = addDomain("foo.com", TMP_DIR);
      expect(result).toEqual({ added: false });
    });

    it("檔案內容行數不增加", () => {
      const file = path.join(TMP_DIR, "sandbox-whitelist.txt");
      fs.writeFileSync(file, "foo.com\n", "utf-8");

      addDomain("foo.com", TMP_DIR);
      const domains = loadDomainWhitelist(TMP_DIR);
      expect(domains).toHaveLength(1);
    });
  });

  describe("B6: 新增無效格式的 domain 時，throw 並附明確錯誤", () => {
    it("含有 scheme 前綴（https://）應 throw", () => {
      expect(() => addDomain("https://example.com", TMP_DIR)).toThrow();
    });

    it("含有路徑字元（/）應 throw", () => {
      expect(() => addDomain("example.com/path", TMP_DIR)).toThrow();
    });

    it("單獨 * 應 throw", () => {
      expect(() => addDomain("*", TMP_DIR)).toThrow();
    });

    it("suffix wildcard（x.*）應 throw，* 只能在開頭", () => {
      expect(() => addDomain("example.*", TMP_DIR)).toThrow();
    });

    it("含空白字元應 throw", () => {
      expect(() => addDomain("example .com", TMP_DIR)).toThrow();
    });
  });
});

// ────────────────────────────────────────────────
// B7 & B8: removeDomain
// ────────────────────────────────────────────────
describe("removeDomain", () => {
  describe("B7: 移除存在的 domain 時，從檔案中刪除", () => {
    it("移除後 domain 不再出現在清單中", () => {
      const file = path.join(TMP_DIR, "sandbox-whitelist.txt");
      fs.writeFileSync(file, "foo.com\nbar.com\nbaz.org\n", "utf-8");

      removeDomain("bar.com", TMP_DIR);
      const domains = loadDomainWhitelist(TMP_DIR);
      expect(domains).not.toContain("bar.com");
      expect(domains).toContain("foo.com");
      expect(domains).toContain("baz.org");
    });

    it("移除後清單長度減少一個", () => {
      const file = path.join(TMP_DIR, "sandbox-whitelist.txt");
      fs.writeFileSync(file, "foo.com\nbar.com\nbaz.org\n", "utf-8");

      removeDomain("bar.com", TMP_DIR);
      const domains = loadDomainWhitelist(TMP_DIR);
      expect(domains).toHaveLength(2);
    });
  });

  describe("B8: 移除不存在的 domain 時，throw 並附「不在白名單中」訊息", () => {
    it("錯誤訊息應包含「不在白名單中」", () => {
      const file = path.join(TMP_DIR, "sandbox-whitelist.txt");
      fs.writeFileSync(file, "foo.com\n", "utf-8");

      expect(() => removeDomain("nonexistent.com", TMP_DIR)).toThrow(
        "不在白名單中",
      );
    });

    it("錯誤訊息應包含被移除的 domain 名稱", () => {
      const file = path.join(TMP_DIR, "sandbox-whitelist.txt");
      fs.writeFileSync(file, "foo.com\n", "utf-8");

      expect(() => removeDomain("ghost.com", TMP_DIR)).toThrow("ghost.com");
    });
  });
});

// ────────────────────────────────────────────────
// B9 & B10: validateDomain
// ────────────────────────────────────────────────
describe("validateDomain", () => {
  describe("B9: 接受合法格式", () => {
    it("純 domain（foo.com）應通過驗證", () => {
      expect(() => validateDomain("foo.com")).not.toThrow();
    });

    it("多層純 domain（api.example.co.uk）應通過驗證", () => {
      expect(() => validateDomain("api.example.co.uk")).not.toThrow();
    });

    it("前綴 wildcard（*.foo.com）應通過驗證", () => {
      expect(() => validateDomain("*.foo.com")).not.toThrow();
    });

    it("前綴 wildcard 多層（*.sub.example.com）應通過驗證", () => {
      expect(() => validateDomain("*.sub.example.com")).not.toThrow();
    });
  });

  describe("B10: 拒絕無效格式", () => {
    it("含有 https:// 應 throw", () => {
      expect(() => validateDomain("https://x.com")).toThrow();
    });

    it("含有路徑字元（x/y）應 throw", () => {
      expect(() => validateDomain("x/y")).toThrow();
    });

    it("單獨 * 應 throw", () => {
      expect(() => validateDomain("*")).toThrow();
    });

    it("suffix wildcard（x.*）應 throw", () => {
      expect(() => validateDomain("x.*")).toThrow();
    });

    it("wildcard 不接 .（*x.com）應 throw", () => {
      expect(() => validateDomain("*x.com")).toThrow();
    });

    it("含空白字元應 throw", () => {
      expect(() => validateDomain("foo .com")).toThrow();
    });

    it("空字串應 throw", () => {
      expect(() => validateDomain("")).toThrow();
    });

    it("以 . 開頭應 throw", () => {
      expect(() => validateDomain(".foo.com")).toThrow();
    });

    it("以 . 結尾應 throw", () => {
      expect(() => validateDomain("foo.com.")).toThrow();
    });
  });
});
