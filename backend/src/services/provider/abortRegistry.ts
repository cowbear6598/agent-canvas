/**
 * AbortRegistry — 全站唯一的 AbortController 管理中心
 *
 * 用途：取代 claudeService.externalControllers / registerAbortKey / unregisterAbortKey
 *       以及 streamingChatExecutor.withCodexAbort，成為整個系統唯一的 AbortController 來源。
 *
 * key 命名慣例：
 *   - 一般場景（normal）：podId
 *   - Run 場景：`${runId}:${podId}`
 *
 * key 的意義由呼叫端決定，registry 本身不解析 key 格式。
 */

class AbortRegistry {
  /** 內部儲存：key → AbortController */
  private readonly controllers = new Map<string, AbortController>();

  /**
   * 為指定 key 建立並註冊一個新的 AbortController。
   *
   * 若同一 key 已存在，會先 abort 並覆蓋舊的 controller（避免 Memory Leak）。
   * 呼叫端取得回傳的 controller 後，從 controller.signal 傳入 provider 使用。
   */
  register(key: string): AbortController {
    // 若已有同名 key，先 abort 舊的再覆蓋，避免舊 controller 洩漏
    const existing = this.controllers.get(key);
    if (existing) {
      existing.abort();
    }

    const controller = new AbortController();
    this.controllers.set(key, controller);
    return controller;
  }

  /**
   * 觸發指定 key 的 abort，並將其從 map 中移除。
   *
   * @returns 若 key 存在（且已 abort）則回傳 true；key 不存在則回傳 false（不拋錯）
   */
  abort(key: string): boolean {
    const controller = this.controllers.get(key);
    if (!controller) {
      return false;
    }

    controller.abort();
    this.controllers.delete(key);
    return true;
  }

  /**
   * 在串流正常結束時清除 key，防止 Memory Leak。
   *
   * 與 abort() 的差異：unregister 不觸發 abort，純粹移除 map 紀錄。
   */
  unregister(key: string): void {
    this.controllers.delete(key);
  }

  /**
   * Abort 所有正在進行的請求，並清空 map。
   * 供 graceful shutdown 使用。
   *
   * @returns 被 abort 的 controller 數量
   */
  abortAll(): number {
    const count = this.controllers.size;
    for (const controller of this.controllers.values()) {
      controller.abort();
    }
    this.controllers.clear();
    return count;
  }

  /**
   * 檢查指定 key 是否存在於 map 中。
   * 主要供測試使用。
   */
  has(key: string): boolean {
    return this.controllers.has(key);
  }
}

/** 全站唯一的 AbortRegistry singleton */
export const abortRegistry = new AbortRegistry();
