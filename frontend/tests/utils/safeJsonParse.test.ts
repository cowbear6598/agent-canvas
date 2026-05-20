import { describe, it, expect } from "vitest";
import { safeJsonParse } from "@shared/safeJsonParse";

describe("safeJsonParse", () => {
  describe("合法 JSON 解析", () => {
    it("解析合法 JSON 物件字串應回傳正確物件", () => {
      const result = safeJsonParse<{ name: string }>('{"name":"測試"}');
      expect(result).toEqual({ name: "測試" });
    });

    it("解析合法 JSON 陣列字串應回傳正確陣列", () => {
      const result = safeJsonParse<number[]>("[1,2,3]");
      expect(result).toEqual([1, 2, 3]);
    });

    it("解析合法 JSON 字串純量值應回傳正確值", () => {
      const result = safeJsonParse<string>('"hello"');
      expect(result).toBe("hello");
    });

    it("解析合法 JSON 數字純量值應回傳正確值", () => {
      const result = safeJsonParse<number>("42");
      expect(result).toBe(42);
    });

    it("解析合法 JSON boolean 純量值應回傳正確值", () => {
      expect(safeJsonParse<boolean>("true")).toBe(true);
      expect(safeJsonParse<boolean>("false")).toBe(false);
    });

    it("解析合法 JSON null 應回傳 null", () => {
      const result = safeJsonParse<null>("null");
      expect(result).toBeNull();
    });
  });

  describe("不合法 JSON 處理", () => {
    it("解析不合法 JSON 字串應回傳 null，不應 throw", () => {
      expect(() => safeJsonParse("不合法的JSON")).not.toThrow();
      expect(safeJsonParse("不合法的JSON")).toBeNull();
    });

    it("解析空字串應回傳 null", () => {
      expect(safeJsonParse("")).toBeNull();
    });

    it("解析未閉合括號應回傳 null", () => {
      expect(safeJsonParse('{"key": "value"')).toBeNull();
    });
  });

  describe("泛型型別 T 使用", () => {
    it("使用泛型型別應能正確推斷回傳型別", () => {
      interface User {
        id: number;
        name: string;
      }
      const result = safeJsonParse<User>('{"id":1,"name":"Alice"}');
      expect(result?.id).toBe(1);
      expect(result?.name).toBe("Alice");
    });
  });
});
