import { describe, it, expect, vi, beforeEach } from "vitest";
import { setActivePinia } from "pinia";
import { setupTestPinia } from "../helpers/mockStoreFactory";

// Mock canvasStore
const mockGetCanvasPassword = vi.fn();

vi.mock("@/stores/canvasStore", () => ({
  useCanvasStore: () => ({
    getCanvasPassword: mockGetCanvasPassword,
  }),
}));

// Mock 全域 fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("fetchWithCanvasPassword", () => {
  let fetchWithCanvasPassword: typeof import("@/services/canvasPasswordFetch").fetchWithCanvasPassword;

  beforeEach(async () => {
    const pinia = setupTestPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
    // 每次 beforeEach 重新 import，避免 module cache 造成 mock 失效
    const module = await import("@/services/canvasPasswordFetch");
    fetchWithCanvasPassword = module.fetchWithCanvasPassword;
  });

  it("fetchWithCanvasPassword 對受保護的 canvas 應帶 X-Canvas-Password header", async () => {
    mockGetCanvasPassword.mockReturnValue("secret123");
    mockFetch.mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await fetchWithCanvasPassword("https://example.com/api/data", "canvas-1");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [_url, options] = mockFetch.mock.calls[0] as [
      string,
      RequestInit & { headers: Headers },
    ];
    const headers = options.headers as Headers;
    expect(headers.get("X-Canvas-Password")).toBe("secret123");
  });

  it("fetchWithCanvasPassword 對未保護的 canvas 不帶 X-Canvas-Password header", async () => {
    mockGetCanvasPassword.mockReturnValue(undefined);
    mockFetch.mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await fetchWithCanvasPassword("https://example.com/api/data", "canvas-2");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [_url, options] = mockFetch.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    // 無密碼時直接帶原始 options（undefined），沒有自訂 headers
    if (options && "headers" in options && options.headers instanceof Headers) {
      expect(options.headers.get("X-Canvas-Password")).toBeNull();
    } else {
      // options 為 undefined 或沒有 headers，表示沒有帶密碼 header
      expect(options).toBeUndefined();
    }
  });
});
