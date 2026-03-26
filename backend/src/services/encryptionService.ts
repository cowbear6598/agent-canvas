import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

const KEY_FILE_NAME = "encryption.key";
const IV_LENGTH = 12; // AES-GCM 標準 IV 長度
const AUTH_TAG_LENGTH = 16; // AES-GCM 標準 authTag 長度
const KEY_LENGTH = 32; // AES-256 金鑰長度
const MIN_ENCRYPTED_LENGTH = IV_LENGTH + AUTH_TAG_LENGTH; // 28 bytes
const ENCRYPTION_PREFIX = "enc1:"; // 新格式識別前綴

class EncryptionService {
  private key: Buffer | null = null;

  private get keyFilePath(): string {
    return path.join(config.appDataRoot, KEY_FILE_NAME);
  }

  async initializeKey(): Promise<void> {
    try {
      const keyBuffer = await fs.readFile(this.keyFilePath);
      if (keyBuffer.length !== KEY_LENGTH) {
        throw new Error(
          `加密金鑰長度不正確：預期 ${KEY_LENGTH} bytes，實際 ${keyBuffer.length} bytes`,
        );
      }
      this.key = keyBuffer;
      logger.log("Encryption", "Init", "已載入既有加密金鑰");
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const newKey = crypto.randomBytes(KEY_LENGTH);
        await fs.writeFile(this.keyFilePath, newKey, { mode: 0o600 });
        this.key = newKey;
        logger.log("Encryption", "Init", "已產生並寫入新的加密金鑰");
      } else {
        throw error;
      }
    }
  }

  private getKey(): Buffer {
    if (!this.key) {
      throw new Error("加密服務尚未初始化，請先呼叫 initializeKey()");
    }
    return this.key;
  }

  encrypt(plaintext: string): string {
    const key = this.getKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    const combined = Buffer.concat([iv, authTag, encrypted]);
    return ENCRYPTION_PREFIX + combined.toString("base64");
  }

  decrypt(encrypted: string): string {
    const key = this.getKey();

    // 支援新格式（有 prefix）與舊格式（純 base64）
    const base64 = encrypted.startsWith(ENCRYPTION_PREFIX)
      ? encrypted.slice(ENCRYPTION_PREFIX.length)
      : encrypted;

    const combined = Buffer.from(base64, "base64");

    if (combined.length < MIN_ENCRYPTED_LENGTH) {
      throw new Error("加密資料格式不正確：長度不足");
    }

    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  }

  isEncrypted(value: string): boolean {
    // 新格式：有 prefix，直接判斷
    if (value.startsWith(ENCRYPTION_PREFIX)) {
      return true;
    }

    // 舊格式相容：JSON.parse 失敗 + base64 長度 >= 28 bytes
    return this.isLegacyEncrypted(value);
  }

  /**
   * 判斷是否為舊格式加密（無 prefix 的純 base64）
   * 用於遷移時識別需要升級為新格式的資料
   */
  isLegacyEncrypted(value: string): boolean {
    // 新格式不屬於舊格式
    if (value.startsWith(ENCRYPTION_PREFIX)) {
      return false;
    }

    try {
      JSON.parse(value);
      return false;
    } catch {
      // JSON.parse 失敗 → 可能是舊格式加密過的 base64
    }

    try {
      const decoded = Buffer.from(value, "base64");
      if (decoded.toString("base64") !== value) {
        return false;
      }
      return decoded.length >= MIN_ENCRYPTED_LENGTH;
    } catch {
      return false;
    }
  }
}

export const encryptionService = new EncryptionService();
