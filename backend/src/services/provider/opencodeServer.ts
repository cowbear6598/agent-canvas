/**
 * opencodeServer — opencode 伺服器 singleton 管理模組
 *
 * 負責啟動、查詢狀態與停止 opencode 本地伺服器子程序。
 * 後端固定注入 full access permission config，避免 headless run 卡在 approval prompt。
 */

import { createOpencodeServer } from "@opencode-ai/sdk/v2/server";
import type { Config } from "@opencode-ai/sdk/v2";
import { buildOpencodeFullAccessServerConfig } from "./opencodeMcpConfigBuilder.js";
import { config } from "../../config/index.js";

// ================================================================
// 型別定義
// ================================================================

/** opencode 伺服器狀態 */
export type OpencodeServerStatus = "idle" | "starting" | "ready" | "failed";

/** opencode 伺服器實例的介面（可 mock 測試） */
export interface OpencodeServerInstance {
  url: string;
  close(): void;
}

/** 用於注入 launcher（讓測試可以 mock） */
export type OpencodeServerLauncher = (options?: {
  port?: number;
  timeout?: number;
  config?: Pick<Config, "mcp" | "permission">;
}) => Promise<OpencodeServerInstance>;

/** opencode 伺服器 singleton state */
interface OpencodeServerState {
  baseUrl: string | null;
  status: OpencodeServerStatus;
  failureReason: string | null;
  server: OpencodeServerInstance | null;
}

// ================================================================
// Singleton state
// ================================================================

const state: OpencodeServerState = {
  baseUrl: null,
  status: "idle",
  failureReason: null,
  server: null,
};

/** 預設的 launcher，直接呼叫 SDK */
const defaultLauncher: OpencodeServerLauncher = (options) =>
  createOpencodeServer(options);

// 當前使用的 launcher（測試可透過 setLauncher 替換）
let currentLauncher: OpencodeServerLauncher = defaultLauncher;

// in-flight restart 保護：若重啟已在進行中，後續呼叫等待同一個 promise
let restartInFlight: Promise<void> | null = null;

// ================================================================
// 供測試使用的 launcher 注入
// ================================================================

/**
 * 替換 launcher（僅測試使用）
 */
export function setOpencodeServerLauncher(
  launcher: OpencodeServerLauncher,
): void {
  currentLauncher = launcher;
}

/**
 * 重置 launcher 為預設值（測試 teardown 使用）
 */
export function resetOpencodeServerLauncher(): void {
  currentLauncher = defaultLauncher;
}

// ================================================================
// 核心 API
// ================================================================

/**
 * 啟動 opencode 伺服器。
 *
 * 成功：state.status = "ready"，state.baseUrl 寫入伺服器 URL。
 * 失敗：state.status = "failed"，state.failureReason 記錄錯誤說明；
 *       後端仍正常繼續啟動（不 throw，由呼叫端決定是否繼續）。
 */
export async function startOpencodeServer(): Promise<void> {
  state.status = "starting";
  state.baseUrl = null;
  state.failureReason = null;
  state.server = null;

  try {
    const server = await currentLauncher({
      port: config.opencodeServerPort,
      timeout: 30000,
      config: buildOpencodeFullAccessServerConfig(),
    });

    state.server = server;
    state.baseUrl = server.url;
    state.status = "ready";
  } catch (error) {
    const originalMessage =
      error instanceof Error ? error.message : String(error);
    const failureReason = `opencode 伺服器啟動失敗：${originalMessage}`;

    state.status = "failed";
    state.failureReason = failureReason;
    state.server = null;
    state.baseUrl = null;

    console.error("[opencodeServer] 啟動失敗，詳細原因：", error);
  }
}

/**
 * 取得目前 opencode 伺服器的 state 快照（唯讀）。
 */
export function getOpencodeServerState(): Readonly<OpencodeServerState> {
  return { ...state };
}

/**
 * 停止 opencode 伺服器並重置 state。
 * 供 graceful shutdown 使用。
 *
 * close() 成功時重置 state 為 idle；
 * close() 拋例外時設 status = "failed"，保留 server 參照以便診斷，不清除 state。
 */
export function stopOpencodeServer(): void {
  if (state.server) {
    try {
      state.server.close();
      // close 成功，重置 state
      state.baseUrl = null;
      state.status = "idle";
      state.failureReason = null;
      state.server = null;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[opencodeServer] 停止伺服器時發生錯誤：", error);
      // close 失敗：state 反映失敗，不清除 server 參照
      state.status = "failed";
      state.failureReason = `停止 opencode 子程序時發生錯誤：${msg}`;
    }
  } else {
    // 沒有現存 server，直接重置為 idle
    state.baseUrl = null;
    state.status = "idle";
    state.failureReason = null;
    state.server = null;
  }
}

/**
 * 重新啟動 opencode 子程序的 wrapper。
 *
 * 若重啟已在進行中，後續呼叫等待同一個 promise（in-flight 保護），
 * 避免連點重啟按鈕產生多個子程序。
 *
 * 先呼叫 stopOpencodeServer() 關閉現有子程序，
 * 再 await startOpencodeServer() 重新 spawn 子程序。
 * 呼叫端透過 getOpencodeServerState() 判斷重啟結果。
 */
export async function restartOpencodeServer(): Promise<void> {
  if (restartInFlight) {
    await restartInFlight;
    return;
  }

  restartInFlight = (async (): Promise<void> => {
    stopOpencodeServer();
    await startOpencodeServer();
  })();

  try {
    await restartInFlight;
  } finally {
    restartInFlight = null;
  }
}
