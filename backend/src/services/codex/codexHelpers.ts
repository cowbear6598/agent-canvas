/**
 * codexHelpers
 *
 * codexProvider 與 codexService 共用的底層 helper 函數與常數。
 * 涵蓋敏感資訊遮蔽、stderr 收集等重複邏輯。
 */

import { logger } from "../../utils/logger.js";

// ─── 敏感資訊遮蔽 ────────────────────────────────────────────────────────────

/**
 * 將文字中的敏感資訊遮蔽，避免 OPENAI_API_KEY 或 Bearer token 等資訊寫進 server log。
 */
export function maskSensitiveText(text: string): string {
  return text
    .replace(/OPENAI_API_KEY\s*=\s*\S+/gi, "OPENAI_API_KEY=[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/Authorization\s*:\s*\S+/gi, "Authorization: [REDACTED]")
    .replace(/api[_-]?key\s*[=:]\s*\S+/gi, "api_key=[REDACTED]")
    .replace(/sk-[A-Za-z0-9]{8,}/g, "sk-[REDACTED]");
}

// ─── stderr 收集 ─────────────────────────────────────────────────────────────

/** stderr 收集上限（64KB），避免長時間執行時記憶體爆掉 */
export const STDERR_MAX_BYTES = 64 * 1024;

/**
 * 並行收集 codex subprocess 的 stderr，上限 STDERR_MAX_BYTES。
 * 必須在 stdout 消費「之前」啟動（或並行），避免 stderr buffer 滿導致 subprocess 卡住。
 *
 * @param proc Bun.Subprocess
 * @param abortSignal abort 控制（中止時停止收集）
 * @param logPrefix 用於 log 訊息的模組識別前綴（如 "[CodexProvider]" / "[CodexService]"）
 * @returns 收集到的 stderr 文字（已截斷標記、已遮蔽敏感資訊）
 */
export async function collectStderr(
  proc: Bun.Subprocess<"pipe", "pipe", "pipe">,
  abortSignal: AbortSignal,
  logPrefix: string = "[Codex]",
): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let truncated = false;

  for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
    if (abortSignal.aborted) break;
    const buf = Buffer.from(chunk as Uint8Array);
    if (totalBytes + buf.byteLength <= STDERR_MAX_BYTES) {
      chunks.push(buf);
      totalBytes += buf.byteLength;
    } else {
      truncated = true;
      break;
    }
  }

  let text = Buffer.concat(chunks).toString("utf-8").trim();
  if (truncated) {
    logger.warn(
      "Chat",
      "Warn",
      `${logPrefix} stderr 已達上限（${STDERR_MAX_BYTES} bytes），後續輸出已截斷`,
    );
    text += "\n[TRUNCATED]";
  }
  return maskSensitiveText(text);
}
