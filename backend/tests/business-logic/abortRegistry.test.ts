/**
 * abortRegistry 單元測試
 *
 * 對應 User Flow：
 *   - 「Claude 中止」：呼叫 abort(podId) 觸發 Claude 串流中斷
 *   - 「Codex 中止」：呼叫 abort(podId) 觸發 Codex subprocess kill
 *   - 「多 Pod 同時運作中止其一不影響另一」：不同 key 的 abort 彼此隔離
 */

import { describe, it, expect, beforeEach } from "vitest";
import { abortRegistry } from "../../src/services/provider/abortRegistry.js";

// 每個 test 執行前先確保 registry 為空狀態（避免 singleton 跨 test 污染）
beforeEach(() => {
  abortRegistry.abortAll();
});

// ================================================================
// register
// ================================================================
describe("register", () => {
  it("register(key) 應回傳 AbortController 且 signal 尚未 abort", () => {
    const controller = abortRegistry.register("pod-001");

    expect(controller).toBeInstanceOf(AbortController);
    expect(controller.signal.aborted).toBe(false);
  });

  it("register 後 has(key) 應回傳 true", () => {
    abortRegistry.register("pod-002");

    expect(abortRegistry.has("pod-002")).toBe(true);
  });

  it("同一 key 重複 register 時，舊 controller 應被 abort 並以新 controller 覆蓋", () => {
    const first = abortRegistry.register("pod-dup");

    // 重複 register 同一 key
    const second = abortRegistry.register("pod-dup");

    // 舊 controller 應已被 abort
    expect(first.signal.aborted).toBe(true);

    // 新 controller 應尚未 abort
    expect(second.signal.aborted).toBe(false);

    // map 中應存放新的 controller（has 依然為 true）
    expect(abortRegistry.has("pod-dup")).toBe(true);
  });
});

// ================================================================
// abort
// ================================================================
describe("abort", () => {
  it("abort(key) 應觸發 signal.aborted 並回傳 true", () => {
    const controller = abortRegistry.register("pod-003");

    const result = abortRegistry.abort("pod-003");

    expect(result).toBe(true);
    expect(controller.signal.aborted).toBe(true);
  });

  it("abort(key) 後，has(key) 應回傳 false（controller 已從 map 移除）", () => {
    abortRegistry.register("pod-004");
    abortRegistry.abort("pod-004");

    expect(abortRegistry.has("pod-004")).toBe(false);
  });

  it("abort(unknownKey) 應回傳 false 且不拋錯", () => {
    expect(() => {
      const result = abortRegistry.abort("key-not-exist");
      expect(result).toBe(false);
    }).not.toThrow();
  });
});

// ================================================================
// unregister
// ================================================================
describe("unregister", () => {
  it("unregister(key) 後 has(key) 應回傳 false", () => {
    abortRegistry.register("pod-005");
    abortRegistry.unregister("pod-005");

    expect(abortRegistry.has("pod-005")).toBe(false);
  });

  it("unregister(key) 不應 abort signal，signal 仍維持未 abort 狀態", () => {
    const controller = abortRegistry.register("pod-006");
    abortRegistry.unregister("pod-006");

    // unregister 只是清除 map，不觸發 abort
    expect(controller.signal.aborted).toBe(false);
  });

  it("unregister 後呼叫 abort(key) 應回傳 false（key 已不存在）", () => {
    abortRegistry.register("pod-007");
    abortRegistry.unregister("pod-007");

    const result = abortRegistry.abort("pod-007");

    expect(result).toBe(false);
  });
});

// ================================================================
// 多 key 隔離（多 Pod 同時運作中止其一不影響另一）
// ================================================================
describe("多 key 隔離", () => {
  it("abort(keyA) 不應影響 keyB 的 signal（多 Pod abort 隔離關鍵測試）", () => {
    const controllerA = abortRegistry.register("pod-A");
    const controllerB = abortRegistry.register("pod-B");

    // 只 abort pod-A
    abortRegistry.abort("pod-A");

    // pod-A signal 應已 abort
    expect(controllerA.signal.aborted).toBe(true);

    // pod-B signal 應仍正常（未 abort）
    expect(controllerB.signal.aborted).toBe(false);

    // pod-B 仍在 map 中
    expect(abortRegistry.has("pod-B")).toBe(true);
  });

  it("Run 場景：${runId}:${podId} 格式的 key 應與一般 podId key 互相隔離", () => {
    const podController = abortRegistry.register("pod-X");
    const runController = abortRegistry.register("run-001:pod-X");

    // abort run 場景的 key
    abortRegistry.abort("run-001:pod-X");

    // run 場景的 signal 應已 abort
    expect(runController.signal.aborted).toBe(true);

    // 一般 pod key 的 signal 應不受影響
    expect(podController.signal.aborted).toBe(false);
    expect(abortRegistry.has("pod-X")).toBe(true);
  });
});

// ================================================================
// abortAll
// ================================================================
describe("abortAll", () => {
  it("abortAll() 應觸發所有 signal、清空 map，並回傳被 abort 的數量", () => {
    const c1 = abortRegistry.register("pod-all-1");
    const c2 = abortRegistry.register("pod-all-2");
    const c3 = abortRegistry.register("pod-all-3");

    const count = abortRegistry.abortAll();

    // 回傳數量應與 register 數量一致
    expect(count).toBe(3);

    // 所有 signal 均應已 abort
    expect(c1.signal.aborted).toBe(true);
    expect(c2.signal.aborted).toBe(true);
    expect(c3.signal.aborted).toBe(true);

    // map 應已清空
    expect(abortRegistry.has("pod-all-1")).toBe(false);
    expect(abortRegistry.has("pod-all-2")).toBe(false);
    expect(abortRegistry.has("pod-all-3")).toBe(false);
  });

  it("map 為空時呼叫 abortAll() 應回傳 0 且不拋錯", () => {
    // beforeEach 已確保 map 為空
    expect(() => {
      const count = abortRegistry.abortAll();
      expect(count).toBe(0);
    }).not.toThrow();
  });
});
