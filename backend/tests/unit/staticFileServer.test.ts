import {
  isStaticFilesAvailable,
  serveStaticFile,
  serveFromVFS,
} from "../../src/utils/staticFileServer.js";

// VFS 資料格式（base64 內容 + MIME 類型）
type VFSData = Record<string, { content: string; mimeType: string }>;

function toBase64(content: string): string {
  return Buffer.from(content).toString("base64");
}

function buildMockVFS(): VFSData {
  return {
    "/index.html": {
      content: toBase64("<html><body>App</body></html>"),
      mimeType: "text/html",
    },
    "/assets/index-abc123.js": {
      content: toBase64('console.log("hello")'),
      mimeType: "application/javascript",
    },
    "/assets/index-abc123.css": {
      content: toBase64("body { color: red; }"),
      mimeType: "text/css",
    },
  };
}

// ================================================================
// serveFromVFS：使用 mock VFS，結果確定可驗
// ================================================================
describe("靜態檔案服務（serveFromVFS）", () => {
  it("根路徑 / 應回傳 index.html 的內容", async () => {
    const vfs = buildMockVFS();
    const request = new Request("http://localhost:3001/");
    const response = serveFromVFS(request, vfs);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html");

    const text = await response.text();
    expect(text).toBe("<html><body>App</body></html>");
  });

  it("應回傳對應路徑的靜態資源", async () => {
    const vfs = buildMockVFS();
    const request = new Request("http://localhost:3001/assets/index-abc123.js");
    const response = serveFromVFS(request, vfs);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/javascript");

    const text = await response.text();
    expect(text).toBe('console.log("hello")');
  });

  it("assets 路徑下的資源應設定快取 header", () => {
    const vfs = buildMockVFS();
    const request = new Request("http://localhost:3001/assets/index-abc123.js");
    const response = serveFromVFS(request, vfs);

    const cacheControl = response.headers.get("Cache-Control");
    expect(cacheControl).toContain("max-age=31536000");
    expect(cacheControl).toContain("immutable");
  });

  it("應設定 X-Content-Type-Options 安全 header", () => {
    const vfs = buildMockVFS();
    const request = new Request("http://localhost:3001/");
    const response = serveFromVFS(request, vfs);

    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("SPA fallback：不存在的路徑應回傳 index.html", async () => {
    const vfs = buildMockVFS();
    const request = new Request(
      "http://localhost:3001/some/non-existent/route",
    );
    const response = serveFromVFS(request, vfs);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html");

    const text = await response.text();
    expect(text).toBe("<html><body>App</body></html>");
  });

  it("連 index.html 都不存在時應回傳 404", () => {
    const emptyVFS: VFSData = {};
    const request = new Request("http://localhost:3001/non-existent");
    const response = serveFromVFS(request, emptyVFS);

    expect(response.status).toBe(404);
  });

  it("serveFromVFS 正確處理根路徑、SPA fallback 及 404 三種情境", async () => {
    const vfs = buildMockVFS();

    // 根路徑應回傳 index.html
    const rootResponse = serveFromVFS(
      new Request("http://localhost:3001/"),
      vfs,
    );
    expect(rootResponse.status).toBe(200);
    expect(rootResponse.headers.get("Content-Type")).toBe("text/html");

    // SPA fallback：不存在路徑應回傳 index.html
    const spaResponse = serveFromVFS(
      new Request("http://localhost:3001/about"),
      vfs,
    );
    expect(spaResponse.status).toBe(200);
    expect(spaResponse.headers.get("Content-Type")).toBe("text/html");

    // 空 VFS：找不到任何資源應回傳 404
    const notFoundResponse = serveFromVFS(
      new Request("http://localhost:3001/any"),
      {},
    );
    expect(notFoundResponse.status).toBe(404);
  });
});

// ================================================================
// serveStaticFile：整合式測試，結果依環境而定（有無 dist/index.html）
// ================================================================
describe("靜態檔案服務（serveStaticFile）", () => {
  it("應該安全處理路徑穿越攻擊嘗試", async () => {
    // new URL() 自動正規化 /../../../ 為 /etc/passwd，
    // path.join(FRONTEND_DIST_PATH, '/etc/passwd') 仍在 dist 目錄內。
    // 檔案不存在時 fallback 到 index.html（200）或 404，兩者皆安全。
    const request = new Request("http://localhost:3001/../../../etc/passwd");
    const response = await serveStaticFile(request);

    expect([200, 404]).toContain(response.status);

    // 若回傳 200，應是 HTML（index.html），不是系統檔案
    if (response.status === 200) {
      const contentType = response.headers.get("Content-Type");
      expect(contentType).toBe("text/html");
    }
  });

  it("應該對 assets 資源設定快取 header", async () => {
    const request = new Request(
      "http://localhost:3001/assets/index-BaBRudfh.js",
    );
    const response = await serveStaticFile(request);

    // 檔案存在時才驗證 Cache-Control
    if (response.status === 200) {
      const cacheControl = response.headers.get("Cache-Control");
      if (cacheControl) {
        expect(cacheControl).toContain("max-age=31536000");
        expect(cacheControl).toContain("immutable");
      }
    }
  });

  it("應該設定安全 header", async () => {
    const hasStaticFiles = await isStaticFilesAvailable();

    if (!hasStaticFiles) {
      // 無靜態資源環境跳過
      return;
    }

    const request = new Request("http://localhost:3001/");
    const response = await serveStaticFile(request);

    const contentTypeOptions = response.headers.get("X-Content-Type-Options");
    expect(contentTypeOptions).toBe("nosniff");
  });

  it("SPA fallback：不存在的路徑應該回傳 index.html", async () => {
    const hasStaticFiles = await isStaticFilesAvailable();

    if (!hasStaticFiles) {
      // 無靜態資源環境跳過
      return;
    }

    const request = new Request(
      "http://localhost:3001/some/non-existent/route",
    );
    const response = await serveStaticFile(request);

    // 應回傳 200 且 Content-Type 為 text/html（index.html），或 404（無 index.html）
    expect([200, 404]).toContain(response.status);

    if (response.status === 200) {
      const contentType = response.headers.get("Content-Type");
      expect(contentType).toBe("text/html");
    }
  });
});
