/**
 * AbortRegistry — 全站唯一的 AbortController 管理中心
 *
 * 用途：取代 claudeService.externalControllers / registerAbortKey / unregisterAbortKey
 *       以及 streamingChatExecutor.withCodexAbort，成為整個系統唯一的 AbortController 來源。
 *
 * key 命名慣例：
 *   - Run 場景：`${runId}:${podId}`
 *
 * key 的意義由呼叫端決定，registry 本身不解析 key 格式。
 *
 * 雙層索引：
 *   - controllers: queryKey → AbortController（主索引）
 *   - podIndex: podId → Set<queryKey>（二級索引，供 abortByPodId 使用）
 */

class AbortRegistry {
  /** 主索引：queryKey → AbortController */
  private readonly controllers = new Map<string, AbortController>();
  /** 二級索引：podId → Set<queryKey>，供 abortByPodId 快速查詢 */
  private readonly podIndex = new Map<string, Set<string>>();
  /** 反向索引：queryKey → podId，供 abort/unregister 清理二級索引使用 */
  private readonly keyToPodId = new Map<string, string>();

  /**
   * 為指定 key 建立並註冊一個新的 AbortController。
   *
   * 若同一 key 已存在，會先 abort 並覆蓋舊的 controller（避免 Memory Leak）。
   * 呼叫端取得回傳的 controller 後，從 controller.signal 傳入 provider 使用。
   *
   * @param queryKey - 唯一查詢鍵（Run 場景為 `${runId}:${podId}`）
   * @param podId - 所屬 Pod ID，用於建立二級索引以支援 abortByPodId。
   *               若提供，會同步建立 podIndex 與反向索引；未提供則不建立二級索引。
   */
  register(queryKey: string, podId?: string): AbortController {
    // 若已有同名 key，先 abort 舊的再覆蓋，避免舊 controller 洩漏
    const existing = this.controllers.get(queryKey);
    if (existing) {
      existing.abort();
    }

    const controller = new AbortController();
    this.controllers.set(queryKey, controller);

    // 有 podId 時才建立二級索引（供 abortByPodId 使用）
    if (podId !== undefined) {
      this.keyToPodId.set(queryKey, podId);

      if (!this.podIndex.has(podId)) {
        this.podIndex.set(podId, new Set());
      }
      this.podIndex.get(podId)!.add(queryKey);
    }

    return controller;
  }

  /**
   * 觸發指定 key 的 abort，並將其從 map 中移除（含二級索引）。
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
    this._cleanupIndexes(key);
    return true;
  }

  /**
   * 在串流正常結束時清除 key，防止 Memory Leak。
   *
   * 與 abort() 的差異：unregister 不觸發 abort，純粹移除 map 紀錄。
   *
   * @param queryKey - 要移除的查詢鍵
   * @param podId - 所屬 Pod ID（備用，優先從反向索引取）
   */
  unregister(queryKey: string, _podId?: string): void {
    this.controllers.delete(queryKey);
    this._cleanupIndexes(queryKey);
  }

  /** 清理反向索引與二級索引（共用邏輯，供 abort / unregister 呼叫） */
  private _cleanupIndexes(queryKey: string): void {
    const podId = this.keyToPodId.get(queryKey);
    this.keyToPodId.delete(queryKey);

    if (podId) {
      const podKeys = this.podIndex.get(podId);
      if (podKeys) {
        podKeys.delete(queryKey);
        if (podKeys.size === 0) {
          this.podIndex.delete(podId);
        }
      }
    }
  }

  /**
   * 透過 podId 找出該 Pod 所有 active queries 並逐一 abort。
   *
   * 用於 multi-run 場景：一個 pod 可能同時有多個 active queries（多個 Run 並行執行），
   * 呼叫此方法可一次 abort 全部。
   *
   * @returns 是否有 abort 任何 query（true=至少 abort 一個，false=無 active query）
   */
  abortByPodId(podId: string): boolean {
    const queryKeys = this.podIndex.get(podId);
    if (!queryKeys || queryKeys.size === 0) {
      return false;
    }

    // 複製一份 keys，避免在 iterate 時修改 set（_cleanupIndexes 會修改 podIndex）
    const keysToAbort = [...queryKeys];
    for (const queryKey of keysToAbort) {
      const controller = this.controllers.get(queryKey);
      if (controller) {
        controller.abort();
        this.controllers.delete(queryKey);
        this._cleanupIndexes(queryKey);
      }
    }

    return true;
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
    this.podIndex.clear();
    this.keyToPodId.clear();
    return count;
  }

  /**
   * 取得指定 key 的 AbortController，若不存在則回傳 undefined。
   * 與 register() 的差異：不建立新的 controller，不觸發 abort，純粹讀取。
   * 主要供 branch decider 等需要「共用現有 signal」的場景使用。
   */
  get(key: string): AbortController | undefined {
    return this.controllers.get(key);
  }

  /**
   * 檢查指定 key 是否存在於 map 中。
   * 主要供測試使用。
   */
  has(key: string): boolean {
    return this.controllers.has(key);
  }

  /** 檢查指定 Pod 是否仍有任何進行中的 provider 查詢。 */
  hasActiveForPod(podId: string): boolean {
    return (this.podIndex.get(podId)?.size ?? 0) > 0;
  }
}

/** 全站唯一的 AbortRegistry singleton */
export const abortRegistry = new AbortRegistry();
