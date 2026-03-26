import { beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

// mock config，讓 keyFilePath 指向暫存目錄
vi.mock("../../src/config/index.js", () => ({
  config: {
    appDataRoot: path.join(os.tmpdir(), "encryption-test-" + process.pid),
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { encryptionService } from "../../src/services/encryptionService.js";
import { config } from "../../src/config/index.js";

const KEY_LENGTH = 32;
const keyFilePath = path.join(config.appDataRoot, "encryption.key");

describe("EncryptionService", () => {
  beforeEach(async () => {
    // 重置 singleton 的 key 狀態
    (encryptionService as unknown as { key: Buffer | null }).key = null;

    // 確保暫存目錄存在，並刪除可能殘留的金鑰檔
    await fs.mkdir(config.appDataRoot, { recursive: true });
    await fs.rm(keyFilePath, { force: true });
  });

  describe("initializeKey", () => {
    it("金鑰檔案不存在時自動產生並寫入", async () => {
      await encryptionService.initializeKey();

      const written = await fs.readFile(keyFilePath);
      expect(written.length).toBe(KEY_LENGTH);
    });

    it("金鑰檔案已存在時正確讀取", async () => {
      const existingKey = crypto.randomBytes(KEY_LENGTH);
      await fs.writeFile(keyFilePath, existingKey);

      await encryptionService.initializeKey();

      // 能正常 encrypt 就代表 key 已被載入
      expect(() => encryptionService.encrypt("test")).not.toThrow();
    });

    it("金鑰長度不正確時拋出錯誤", async () => {
      // 寫入長度不對的金鑰
      await fs.writeFile(keyFilePath, crypto.randomBytes(16));

      await expect(encryptionService.initializeKey()).rejects.toThrow(
        "加密金鑰長度不正確",
      );
    });
  });

  describe("encrypt / decrypt", () => {
    beforeEach(async () => {
      await encryptionService.initializeKey();
    });

    it("基本加解密 round-trip", () => {
      const plaintext = '{"botToken":"xoxb-test","signingSecret":"secret"}';

      const encrypted = encryptionService.encrypt(plaintext);
      const decrypted = encryptionService.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it("相同明文每次加密產生不同密文", () => {
      const plaintext = "same plaintext";

      const encrypted1 = encryptionService.encrypt(plaintext);
      const encrypted2 = encryptionService.encrypt(plaintext);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it("密文被竄改時 decrypt 拋出錯誤", () => {
      const plaintext = "hello world";
      const encrypted = encryptionService.encrypt(plaintext);

      // 竄改 base64 中間的字元
      const tampered = encrypted.slice(0, -4) + "XXXX";

      expect(() => encryptionService.decrypt(tampered)).toThrow();
    });

    it("密文過短時拋出錯誤", () => {
      // 不足 28 bytes 的 base64 字串
      const tooShort = Buffer.from("short").toString("base64");

      expect(() => encryptionService.decrypt(tooShort)).toThrow(
        "加密資料格式不正確：長度不足",
      );
    });

    it("加密結果包含 enc1: 前綴", () => {
      const encrypted = encryptionService.encrypt("test");
      expect(encrypted.startsWith("enc1:")).toBe(true);
    });

    it("支援新格式（enc1: 前綴）解密", () => {
      const plaintext = '{"botToken":"xoxb-test"}';
      const encrypted = encryptionService.encrypt(plaintext);
      expect(encrypted.startsWith("enc1:")).toBe(true);
      expect(encryptionService.decrypt(encrypted)).toBe(plaintext);
    });

    it("支援舊格式（無前綴純 base64）解密", () => {
      // 模擬舊格式：直接用底層產生無 prefix 的加密資料
      const key = (encryptionService as unknown as { key: Buffer }).key;
      const crypto = require("crypto");
      const IV_LENGTH = 12;
      const iv = crypto.randomBytes(IV_LENGTH);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([
        cipher.update("legacy plaintext", "utf8"),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();
      const combined = Buffer.concat([iv, authTag, encrypted]);
      const legacyEncrypted = combined.toString("base64");

      expect(encryptionService.decrypt(legacyEncrypted)).toBe(
        "legacy plaintext",
      );
    });
  });

  describe("isEncrypted", () => {
    beforeEach(async () => {
      await encryptionService.initializeKey();
    });

    it("明文 JSON 回傳 false", () => {
      expect(encryptionService.isEncrypted('{"botToken":"xoxb-test"}')).toBe(
        false,
      );
    });

    it("新格式加密後的字串（含 enc1: 前綴）回傳 true", () => {
      const encrypted = encryptionService.encrypt('{"botToken":"xoxb-test"}');
      expect(encrypted.startsWith("enc1:")).toBe(true);
      expect(encryptionService.isEncrypted(encrypted)).toBe(true);
    });

    it("舊格式加密字串（無前綴純 base64，長度足夠）回傳 true", () => {
      // 模擬舊格式加密資料：長度 >= 28 bytes 且非有效 JSON
      const legacyData = Buffer.alloc(40, 0x42); // 40 bytes，非 JSON
      expect(encryptionService.isEncrypted(legacyData.toString("base64"))).toBe(
        true,
      );
    });

    it("隨意非 JSON 非有效加密的字串回傳 false", () => {
      expect(encryptionService.isEncrypted("just a plain string")).toBe(false);
    });

    it("enc1: 前綴字串直接回傳 true，不做啟發式判斷", () => {
      expect(encryptionService.isEncrypted("enc1:anyvalue")).toBe(true);
    });
  });

  describe("isLegacyEncrypted", () => {
    beforeEach(async () => {
      await encryptionService.initializeKey();
    });

    it("新格式（enc1: 前綴）回傳 false", () => {
      const encrypted = encryptionService.encrypt("test");
      expect(encryptionService.isLegacyEncrypted(encrypted)).toBe(false);
    });

    it("明文 JSON 回傳 false", () => {
      expect(
        encryptionService.isLegacyEncrypted('{"botToken":"xoxb-test"}'),
      ).toBe(false);
    });

    it("舊格式純 base64（長度足夠）回傳 true", () => {
      const legacyData = Buffer.alloc(40, 0x42);
      expect(
        encryptionService.isLegacyEncrypted(legacyData.toString("base64")),
      ).toBe(true);
    });

    it("短字串回傳 false", () => {
      expect(
        encryptionService.isLegacyEncrypted(
          Buffer.from("short").toString("base64"),
        ),
      ).toBe(false);
    });
  });

  describe("未初始化時", () => {
    it("呼叫 encrypt 應拋出錯誤", () => {
      expect(() => encryptionService.encrypt("test")).toThrow(
        "加密服務尚未初始化",
      );
    });

    it("呼叫 decrypt 應拋出錯誤", () => {
      expect(() => encryptionService.decrypt("test")).toThrow(
        "加密服務尚未初始化",
      );
    });
  });
});
