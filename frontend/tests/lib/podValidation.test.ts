import { describe, it, expect, vi, beforeEach } from "vitest";
import { setActivePinia } from "pinia";
import { enrichPod } from "@/lib/podValidation";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { setupTestPinia } from "../helpers/mockStoreFactory";
import type { Pod } from "@/types";

/** 建立最小合法的 raw Pod，方便各 case 覆寫特定欄位 */
function makeRawPod(overrides: Partial<Pod> = {}): Pod {
  return {
    id: "pod-1",
    name: "test-pod",
    x: 100,
    y: 150,
    rotation: 0,
    output: [],
    provider: "claude",
    providerConfig: { model: "claude-opus-4-5" },
    ...overrides,
  };
}

describe("enrichPod", () => {
  beforeEach(() => {
    const pinia = setupTestPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
  });

  // --- case 1：缺 provider 時補 'claude' ---
  describe("缺 provider 時預設補 claude", () => {
    it("provider 未定義時應補為 claude", () => {
      // 刻意使用 as any 繞過 TypeScript 的必填限制，模擬後端舊資料
      const raw = makeRawPod({ provider: undefined as any });
      const enriched = enrichPod(raw);
      expect(enriched.provider).toBe("claude");
    });
  });

  // --- case 2：store 已載入 defaultOptions → enrichPod 對 Claude Pod 套用 store default ---
  describe("store 已載入 defaultOptions 時，enrichPod 套用 store default", () => {
    it("Claude Pod 缺 providerConfig 時，應從 store 取得 claude default model", () => {
      const store = useProviderCapabilityStore();
      store.syncFromPayload([
        {
          name: "claude",
          capabilities: {
            chat: true,
            plugin: false,
            repository: true,
            command: true,
            mcp: true,
            integration: true,
            runMode: true,
          },
          defaultOptions: { model: "claude-opus-4-5" },
        },
      ]);

      const raw = makeRawPod({
        provider: "claude",
        providerConfig: undefined as any,
      });
      const enriched = enrichPod(raw);

      expect(enriched.providerConfig).toEqual({ model: "claude-opus-4-5" });
    });

    it("Codex Pod 缺 providerConfig 時，應從 store 取得 codex default model", () => {
      const store = useProviderCapabilityStore();
      store.syncFromPayload([
        {
          name: "codex",
          capabilities: {
            chat: true,
            plugin: false,
            repository: false,
            command: false,
            mcp: false,
            integration: false,
            runMode: false,
          },
          defaultOptions: { model: "gpt-5.4" },
        },
      ]);

      const raw = makeRawPod({
        provider: "codex",
        providerConfig: undefined as any,
      });
      const enriched = enrichPod(raw);

      expect(enriched.providerConfig).toEqual({ model: "gpt-5.4" });
    });
  });

  // --- case 3：store 未載入（空 {}）→ enrichPod 回 placeholder 且發 warn ---
  describe("store 未載入（後端尚未送 defaultOptions）", () => {
    it("已知 provider 但 defaultOptions 為 {} 時，應回 placeholder { model: '' } 並發 console.warn", () => {
      // 寫入 capabilities 但不帶 defaultOptions（模擬後端 Phase 6 前的狀態）
      const store = useProviderCapabilityStore();
      store.syncFromPayload([
        {
          name: "claude",
          capabilities: {
            chat: true,
            plugin: false,
            repository: true,
            command: true,
            mcp: true,
            integration: true,
            runMode: true,
          },
          // 刻意不帶 defaultOptions，syncFromPayload 會寫入 {}
        },
      ]);

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const raw = makeRawPod({
        provider: "claude",
        providerConfig: undefined as any,
      });
      const enriched = enrichPod(raw);

      expect(enriched.providerConfig).toEqual({ model: "" });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("未知 provider 或 provider metadata 尚未載入"),
      );

      warnSpy.mockRestore();
    });

    it("store 完全空（metadata 未載入）時，應回 placeholder { model: '' } 並發 console.warn", () => {
      // 不呼叫 syncFromPayload，store 維持初始空物件
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const raw = makeRawPod({
        provider: "claude",
        providerConfig: undefined as any,
      });
      const enriched = enrichPod(raw);

      expect(enriched.providerConfig).toEqual({ model: "" });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("未知 provider 或 provider metadata 尚未載入"),
      );

      warnSpy.mockRestore();
    });
  });

  // --- case 4：既有 providerConfig 不被覆蓋 ---
  describe("既有 providerConfig 應原樣保留", () => {
    it("claude pod 的自訂 model 不應被覆蓋", () => {
      const customConfig = {
        model: "claude-haiku-4-5",
      };
      const raw = makeRawPod({
        provider: "claude",
        providerConfig: customConfig,
      });
      const enriched = enrichPod(raw);
      expect(enriched.providerConfig).toEqual(customConfig);
    });

    it("codex pod 的自訂 model 不應被覆蓋", () => {
      const customConfig = {
        model: "gpt-4o",
      };
      const raw = makeRawPod({
        provider: "codex",
        providerConfig: customConfig,
      });
      const enriched = enrichPod(raw);
      expect(enriched.providerConfig).toEqual(customConfig);
    });
  });

  // --- case 5：未知 provider 的 Pod → enrichPod 不 crash，回 placeholder ---
  describe("未知 provider 的 Pod", () => {
    it("enrichPod 應不 crash，回傳 placeholder { model: '' } 並發 console.warn", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const raw = makeRawPod({
        provider: "unknown-provider" as any,
        providerConfig: undefined as any,
      });
      const enriched = enrichPod(raw);

      expect(enriched.providerConfig).toEqual({ model: "" });
      expect(enriched.provider).toBe("unknown-provider");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("未知 provider 或 provider metadata 尚未載入"),
      );

      warnSpy.mockRestore();
    });
  });
});
