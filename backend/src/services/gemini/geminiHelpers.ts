/**
 * geminiHelpers
 *
 * geminiProvider 與 geminiService 共用的底層 helper 函數與常數。
 * 涵蓋環境變數篩選、stderr 收集等重複邏輯。
 * 此版本對標 codexHelpers.ts，差異：白名單不含 API key（OAuth flow），不做敏感資訊遮蔽。
 */

import { logger } from "../../utils/logger.js";

// ─── 環境變數白名單 ──────────────────────────────────────────────────────────

/**
 * 傳入 gemini subprocess 的環境變數白名單。
 * 不含 GEMINI_API_KEY，因為 Gemini 使用 OAuth flow，不透過環境變數傳遞 API key。
 */
export const GEMINI_ENV_WHITELIST = new Set([
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "TERM",
]);

/**
 * 篩選環境變數白名單，建構傳入 gemini subprocess 的環境物件。
 * 每次呼叫時讀取 process.env 快照；caller 可自行決定要否快取結果
 * （目前 geminiProvider 在模組載入時快取一次，以避免重複建立物件）。
 */
export function buildGeminiEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (GEMINI_ENV_WHITELIST.has(key)) {
      out[key] = value;
    }
  }
  return out;
}

// ─── stderr 收集 ─────────────────────────────────────────────────────────────

/** stderr 收集上限（64KB），避免長時間執行時記憶體爆掉 */
export const STDERR_MAX_BYTES = 64 * 1024;

export interface CollectStderrOptions {
  logPrefix?: string;
  onLine?: (line: string) => void;
}

/**
 * 並行收集 gemini subprocess 的 stderr，上限 STDERR_MAX_BYTES。
 * 必須在 stdout 消費「之前」啟動（或並行），避免 stderr buffer 滿導致 subprocess 卡住。
 * 注意：此版本不做敏感資訊遮蔽，因為 Gemini 使用 OAuth flow，無 API key 洩漏風險。
 *
 * @param proc Bun.Subprocess
 * @param abortSignal abort 控制（中止時停止收集）
 * @param logPrefix 用於 log 訊息的模組識別前綴（如 "[GeminiProvider]" / "[GeminiService]"）
 * @returns 收集到的 stderr 文字（已截斷標記）
 */
export async function collectStderr(
  // stdin 可以是 "pipe" 或 "ignore"，只需要 stderr 存在即可
  proc: Bun.Subprocess<"pipe" | "ignore", "pipe", "pipe">,
  abortSignal: AbortSignal,
  options: string | CollectStderrOptions = "[Gemini]",
): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let truncated = false;
  let lineBuffer = "";
  const textDecoder = new TextDecoder("utf-8");
  const logPrefix =
    typeof options === "string" ? options : (options.logPrefix ?? "[Gemini]");
  const onLine = typeof options === "string" ? undefined : options.onLine;

  for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
    if (abortSignal.aborted) break;
    const buf = Buffer.from(chunk as Uint8Array);
    if (totalBytes + buf.byteLength <= STDERR_MAX_BYTES) {
      chunks.push(buf);
      totalBytes += buf.byteLength;
    } else {
      truncated = true;
      const remainingBytes = STDERR_MAX_BYTES - totalBytes;
      if (remainingBytes > 0) {
        chunks.push(buf.subarray(0, remainingBytes));
        totalBytes += remainingBytes;
      }
    }

    if (onLine) {
      lineBuffer += textDecoder.decode(chunk as Uint8Array, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        onLine(line);
      }
    }
  }

  if (onLine) {
    lineBuffer += textDecoder.decode();
    if (lineBuffer.trim()) {
      onLine(lineBuffer);
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
  return text;
}
