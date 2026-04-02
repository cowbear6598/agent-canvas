import { describe, it, expect } from "vitest";
import { sanitizeErrorForUser } from "@/utils/errorSanitizer";

describe("errorSanitizer", () => {
  describe("sanitizeErrorForUser", () => {
    it("應該處理 Error 物件", () => {
      const error = new Error("測試錯誤訊息");
      const result = sanitizeErrorForUser(error);
      expect(result).toBe("測試錯誤訊息");
    });

    it("應該處理字串型別錯誤", () => {
      const result = sanitizeErrorForUser("這是錯誤訊息");
      expect(result).toBe("這是錯誤訊息");
    });

    it("應該處理含 message 屬性的物件", () => {
      const error = { message: "物件錯誤訊息" };
      const result = sanitizeErrorForUser(error);
      expect(result).toBe("物件錯誤訊息");
    });

    it("應該處理其他型別回傳未知錯誤", () => {
      const result1 = sanitizeErrorForUser(null);
      expect(result1).toBe("未知錯誤");

      const result2 = sanitizeErrorForUser(undefined);
      expect(result2).toBe("未知錯誤");

      const result3 = sanitizeErrorForUser(123);
      expect(result3).toBe("未知錯誤");
    });

    it("應該映射 ECONNREFUSED 錯誤代碼", () => {
      const result = sanitizeErrorForUser("ECONNREFUSED: connection refused");
      expect(result).toBe("無法連線到伺服器");
    });

    it("應該映射 ENOTFOUND 錯誤代碼", () => {
      const result = sanitizeErrorForUser("ENOTFOUND: domain not found");
      expect(result).toBe("找不到伺服器");
    });

    it("應該映射 ETIMEDOUT 錯誤代碼", () => {
      const result = sanitizeErrorForUser("ETIMEDOUT: connection timed out");
      expect(result).toBe("連線逾時");
    });

    it("應該映射 ECONNRESET 錯誤代碼", () => {
      const result = sanitizeErrorForUser("ECONNRESET: connection reset");
      expect(result).toBe("連線中斷");
    });

    it("應該移除 Windows 檔案路徑", () => {
      const result = sanitizeErrorForUser("Error at C:\\Users\\test\\file.js");
      expect(result).toContain("[已隱藏]");
      expect(result).not.toContain("C:\\Users\\test\\file.js");
    });

    it("應該移除 Unix 檔案路徑", () => {
      const result = sanitizeErrorForUser(
        "Error at /home/user/project/file.js",
      );
      expect(result).toContain("[已隱藏]");
      expect(result).not.toContain("/home/user/project/file.js");
    });

    it("應該移除 Email 地址", () => {
      const result = sanitizeErrorForUser("Error from user@example.com");
      expect(result).toContain("[已隱藏]");
      expect(result).not.toContain("user@example.com");
    });

    it("應該移除 IP 地址", () => {
      const result = sanitizeErrorForUser("Connection to 192.168.1.1 failed");
      expect(result).toContain("[已隱藏]");
      expect(result).not.toContain("192.168.1.1");
    });

    it("應該移除長 Token", () => {
      const token = "a".repeat(30);
      const result = sanitizeErrorForUser(`Token ${token} is invalid`);
      expect(result).toContain("[已隱藏]");
      expect(result).not.toContain(token);
    });

    it("應該移除堆疊追蹤", () => {
      const result = sanitizeErrorForUser(
        "Error at someFunction (file.js:10:5)",
      );
      expect(result).toContain("[已隱藏]");
      expect(result).not.toContain("at someFunction");
    });

    it("應該截斷超過 200 字元的錯誤訊息", () => {
      const longMessage = "錯誤訊息 ".repeat(50);
      const result = sanitizeErrorForUser(longMessage);
      expect(result.length).toBe(203);
      expect(result.endsWith("...")).toBe(true);
    });

    it("應該保留 200 字元以內的錯誤訊息", () => {
      const message = "錯誤 ".repeat(20);
      const result = sanitizeErrorForUser(message);
      expect(result).toBe(message);
      expect(result.endsWith("...")).toBe(false);
    });

    it("應該正確處理剛好 200 字元的錯誤訊息", () => {
      const message = "錯誤 ".repeat(40);
      const result = sanitizeErrorForUser(message);
      expect(result).toBe(message);
      expect(result.endsWith("...")).toBe(false);
    });

    it("應該同時處理錯誤代碼映射和敏感資訊移除", () => {
      const result = sanitizeErrorForUser("ECONNREFUSED");
      expect(result).toBe("無法連線到伺服器");
    });

    it("應該同時處理多種敏感資訊", () => {
      const result = sanitizeErrorForUser(
        "Error at /home/user/app.js from user@example.com at 192.168.1.1",
      );
      expect(result).toContain("[已隱藏]");
      expect(result).not.toContain("/home/user/app.js");
      expect(result).not.toContain("user@example.com");
      expect(result).not.toContain("192.168.1.1");
    });
  });
});
