import { beforeEach, describe, expect, it } from "vitest";
import { initTestDb, closeDb, getDb } from "../../src/database/index.js";
import {
  resetStatements,
  getStatements,
} from "../../src/database/statements.js";
import { podStore } from "../../src/services/podStore.js";
import {
  resolveProvider,
  resolveProviderConfig,
} from "../../src/services/pod/providerConfigResolver.js";

/**
 * 清除 podStore 內部以 DB 實例為基礎的 PreparedStatement 快取。
 * 跨測試時 DB 實例會重建（initTestDb + closeDb），舊 statement 快取必須清除，
 * 否則重用已關閉 DB 的 statement 會導致查詢失效或崩潰。
 */
function clearPodStoreCache(): void {
  type PodStoreTestHooks = {
    stmtCache: Map<string, unknown>;
  };
  const store = podStore as unknown as PodStoreTestHooks;
  store.stmtCache.clear();
}
import { integrationAppStore } from "../../src/services/integration/integrationAppStore.js";
import { integrationRegistry } from "../../src/services/integration/integrationRegistry.js";
import { logger } from "../../src/utils/logger.js";
import { z } from "zod";
import type {
  IntegrationProvider,
  IntegrationApp,
  IntegrationResource,
  NormalizedEvent,
} from "../../src/services/integration/types.js";
import type { Result } from "../../src/types/index.js";
import { ok } from "../../src/types/index.js";

/**
 * @testonly 此 mock 僅供測試環境使用，不可被 production code 引用。
 *
 * 測試用 mock：跳過真實加密以加速測試，不涵蓋加密失敗邊界。
 * 使用 Base64 模擬加密行為，讓 encrypt/decrypt 可驗算但不進行真實 AES 操作。
 */
vi.mock("../../src/services/encryptionService.js", () => ({
  encryptionService: {
    encrypt: (text: string) => Buffer.from(text).toString("base64"),
    decrypt: (text: string) => Buffer.from(text, "base64").toString("utf8"),
    isEncrypted: (value: string) => {
      // 測試專用：Base64 編碼後的加密字串無法被 JSON.parse 解析；
      // 用此判斷代理「字串是否已加密」，不反映真實 AES 判斷邏輯。
      try {
        JSON.parse(value);
        return false;
      } catch {
        return true;
      }
    },
    initializeKey: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToAll: vi.fn(),
    emitToCanvas: vi.fn(),
    emitToConnection: vi.fn(),
  },
}));

vi.mock("../../src/services/canvasStore.js", () => ({
  canvasStore: {
    getCanvasDir: vi.fn(() => "/tmp/test-canvas"),
    getById: vi.fn((id: string) => ({ id, name: "test-canvas", sortIndex: 0 })),
    list: vi.fn(() => [
      { id: "test-canvas-001", name: "test-canvas", sortIndex: 0 },
    ]),
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function makeProvider(name: string): IntegrationProvider {
  return {
    name,
    displayName: name,
    createAppSchema: z.object({}),
    validateCreate(): Result<void> {
      return ok();
    },
    sanitizeConfig(): Record<string, unknown> {
      return {};
    },
    async initialize(_app: IntegrationApp): Promise<void> {},
    destroy(_appId: string): void {},
    destroyAll(): void {},
    async refreshResources(_appId: string): Promise<IntegrationResource[]> {
      return [];
    },
    formatEventMessage(
      _event: unknown,
      _app: IntegrationApp,
    ): NormalizedEvent | null {
      return null;
    },
  };
}

function setupTestCanvas(): string {
  const canvasId = "test-canvas-001";
  const stmts = getStatements(getDb());
  stmts.canvas.insert.run({
    $id: canvasId,
    $name: "test-canvas",
    $sortIndex: 0,
  });
  return canvasId;
}

describe("PodStore - Integration Binding", () => {
  let canvasId: string;
  let appId: string;

  beforeEach(() => {
    vi.clearAllMocks();
    initTestDb();
    resetStatements();
    clearPodStoreCache();

    (
      integrationRegistry as unknown as {
        providers: Map<string, IntegrationProvider>;
      }
    ).providers.clear();
    integrationRegistry.register(makeProvider("slack"));
    integrationRegistry.register(makeProvider("telegram"));
    integrationRegistry.register(makeProvider("jira"));

    canvasId = setupTestCanvas();

    const result = integrationAppStore.create("slack", "Test Slack App", {
      botToken: "test-token-slack",
    });
    if (!result.success) throw new Error("Failed to create app");
    appId = result.data!.id;
  });

  afterEach(() => {
    closeDb();
  });

  function createTestPod(name: string) {
    const { pod } = podStore.create(canvasId, {
      name,
      x: 0,
      y: 0,
      rotation: 0,
    });
    return pod;
  }

  describe("addIntegrationBinding", () => {
    it("新增 binding 後 getById 可讀取", () => {
      const pod = createTestPod("pod-binding-read");

      podStore.addIntegrationBinding(canvasId, pod.id, {
        provider: "slack",
        appId,
        resourceId: "C12345",
      });

      const found = podStore.getById(canvasId, pod.id);
      const slackBinding = found?.integrationBindings?.find(
        (b) => b.provider === "slack",
      );
      expect(slackBinding).toBeDefined();
      expect(slackBinding?.appId).toBe(appId);
      expect(slackBinding?.resourceId).toBe("C12345");
    });

    it("相同 provider 的 binding 應覆蓋（upsert）", () => {
      const pod = createTestPod("pod-binding-upsert");

      podStore.addIntegrationBinding(canvasId, pod.id, {
        provider: "slack",
        appId,
        resourceId: "C11111",
      });

      podStore.addIntegrationBinding(canvasId, pod.id, {
        provider: "slack",
        appId,
        resourceId: "C22222",
      });

      const found = podStore.getById(canvasId, pod.id);
      // integrationBindings 為 optional 欄位，先以 ?? [] 展開再 filter，語意更清晰
      const slackBindings = (found?.integrationBindings ?? []).filter(
        (b) => b.provider === "slack",
      );
      expect(slackBindings).toHaveLength(1);
      expect(slackBindings[0].resourceId).toBe("C22222");
    });

    it("extra JSON 正確序列化和反序列化", () => {
      const pod = createTestPod("pod-binding-extra");
      const extra = { threadTs: "1234567890.123456", chatType: "private" };

      podStore.addIntegrationBinding(canvasId, pod.id, {
        provider: "slack",
        appId,
        resourceId: "C12345",
        extra,
      });

      const found = podStore.getById(canvasId, pod.id);
      const slackBinding = found?.integrationBindings?.find(
        (b) => b.provider === "slack",
      );
      expect(slackBinding?.extra).toEqual(extra);
    });
  });

  describe("removeIntegrationBinding", () => {
    it("移除後不再有該 provider binding", () => {
      const pod = createTestPod("pod-binding-remove");

      podStore.addIntegrationBinding(canvasId, pod.id, {
        provider: "slack",
        appId,
        resourceId: "C12345",
      });

      podStore.removeIntegrationBinding(canvasId, pod.id, "slack");

      const found = podStore.getById(canvasId, pod.id);
      const slackBinding = found?.integrationBindings?.find(
        (b) => b.provider === "slack",
      );
      expect(slackBinding).toBeUndefined();
    });

    it("移除不存在的 binding 不應拋出錯誤", () => {
      const pod = createTestPod("pod-binding-remove-nonexistent");

      expect(() => {
        podStore.removeIntegrationBinding(canvasId, pod.id, "slack");
      }).not.toThrow();
    });

    it("移除特定 provider 不影響其他 provider 的 binding", () => {
      const telegramResult = integrationAppStore.create(
        "telegram",
        "Test Telegram App",
        { botToken: "test-token-telegram" },
      );
      const telegramAppId = telegramResult.data!.id;

      const pod = createTestPod("pod-binding-remove-selective");

      podStore.addIntegrationBinding(canvasId, pod.id, {
        provider: "slack",
        appId,
        resourceId: "C12345",
      });

      podStore.addIntegrationBinding(canvasId, pod.id, {
        provider: "telegram",
        appId: telegramAppId,
        resourceId: "999888",
      });

      podStore.removeIntegrationBinding(canvasId, pod.id, "slack");

      const found = podStore.getById(canvasId, pod.id);
      expect(
        found?.integrationBindings?.find((b) => b.provider === "slack"),
      ).toBeUndefined();
      expect(
        found?.integrationBindings?.find((b) => b.provider === "telegram"),
      ).toBeDefined();
    });
  });

  describe("findByIntegrationApp", () => {
    it("找到綁定該 appId 的所有 Pod", () => {
      const pod1 = createTestPod("pod-find-app-1");
      const pod2 = createTestPod("pod-find-app-2");
      const pod3 = createTestPod("pod-find-app-other");

      const otherResult = integrationAppStore.create(
        "slack",
        "Other Slack App",
        { botToken: "test-token-slack-other" },
      );
      const otherAppId = otherResult.data!.id;

      podStore.addIntegrationBinding(canvasId, pod1.id, {
        provider: "slack",
        appId,
        resourceId: "C1",
      });
      podStore.addIntegrationBinding(canvasId, pod2.id, {
        provider: "slack",
        appId,
        resourceId: "C2",
      });
      podStore.addIntegrationBinding(canvasId, pod3.id, {
        provider: "slack",
        appId: otherAppId,
        resourceId: "C3",
      });

      const boundPods = podStore.findByIntegrationApp(appId);
      const podIds = boundPods.map((p) => p.pod.id);

      expect(podIds).toContain(pod1.id);
      expect(podIds).toContain(pod2.id);
      expect(podIds).not.toContain(pod3.id);
    });

    it("無 Pod 綁定時回傳空陣列", () => {
      const result = podStore.findByIntegrationApp(appId);
      expect(result).toEqual([]);
    });
  });

  describe("findByIntegrationAppAndResource", () => {
    it("找到特定 appId + resourceId 的 Pod", () => {
      const pod1 = createTestPod("pod-find-resource-1");
      const pod2 = createTestPod("pod-find-resource-2");

      podStore.addIntegrationBinding(canvasId, pod1.id, {
        provider: "slack",
        appId,
        resourceId: "C-TARGET",
      });
      podStore.addIntegrationBinding(canvasId, pod2.id, {
        provider: "slack",
        appId,
        resourceId: "C-OTHER",
      });

      const result = podStore.findByIntegrationAppAndResource(
        appId,
        "C-TARGET",
      );
      const podIds = result.map((p) => p.pod.id);

      expect(podIds).toContain(pod1.id);
      expect(podIds).not.toContain(pod2.id);
    });

    it("不符合的 resourceId 回傳空陣列", () => {
      const pod = createTestPod("pod-find-resource-no-match");
      podStore.addIntegrationBinding(canvasId, pod.id, {
        provider: "slack",
        appId,
        resourceId: "C-EXIST",
      });

      const result = podStore.findByIntegrationAppAndResource(
        appId,
        "C-NONEXISTENT",
      );
      expect(result).toEqual([]);
    });
  });
});

describe("PodStore - providerConfig 白名單過濾", () => {
  let canvasId: string;

  beforeEach(() => {
    vi.clearAllMocks();
    initTestDb();
    resetStatements();
    clearPodStoreCache();

    const stmts = getStatements(getDb());
    canvasId = "test-canvas-sanitize";
    stmts.canvas.insert.run({
      $id: canvasId,
      $name: "test-canvas-sanitize",
      $sortIndex: 0,
    });
  });

  afterEach(() => {
    closeDb();
  });

  it("DB 中存有舊格式 {provider,model} 時，getById 回傳的 providerConfig 只含 model", () => {
    // 先建立 Pod 取得合法 id
    const { pod } = podStore.create(canvasId, {
      name: "pod-legacy-read",
      x: 0,
      y: 0,
      rotation: 0,
    });

    // 直接將舊格式（含 provider key）寫進 DB，模擬 cfe6d9b 以前的歷史資料
    getDb()
      .prepare("UPDATE pods SET provider_config_json = ? WHERE id = ?")
      .run('{"provider":"claude","model":"haiku"}', pod.id);

    const found = podStore.getById(canvasId, pod.id);

    expect(found).toBeDefined();
    expect(found!.providerConfig).toEqual({ model: "haiku" });
    expect(
      (found!.providerConfig as Record<string, unknown>).provider,
    ).toBeUndefined();
  });

  it("DB 中存有舊格式 {provider,model} 時，list 回傳的 providerConfig 只含 model", () => {
    const { pod } = podStore.create(canvasId, {
      name: "pod-legacy-list",
      x: 0,
      y: 0,
      rotation: 0,
    });

    getDb()
      .prepare("UPDATE pods SET provider_config_json = ? WHERE id = ?")
      .run('{"provider":"codex","model":"gpt-5.4"}', pod.id);

    const pods = podStore.list(canvasId);
    const found = pods.find((p) => p.id === pod.id);

    expect(found).toBeDefined();
    expect(found!.providerConfig).toEqual({ model: "gpt-5.4" });
    expect(
      (found!.providerConfig as Record<string, unknown>).provider,
    ).toBeUndefined();
  });

  it("create 收到含 provider key 的 providerConfig 時，DB 寫入的 provider_config_json 只含 model", () => {
    const { pod } = podStore.create(canvasId, {
      name: "pod-create-sanitize",
      x: 0,
      y: 0,
      rotation: 0,
      provider: "codex",
      // 傳入包含多餘 provider key 的物件，模擬舊格式資料流入
      providerConfig: { provider: "codex", model: "gpt-5.4" } as Record<
        string,
        unknown
      >,
    });

    const row = getDb()
      .prepare("SELECT provider_config_json FROM pods WHERE id = ?")
      .get(pod.id) as { provider_config_json: string };

    const parsed = JSON.parse(row.provider_config_json) as Record<
      string,
      unknown
    >;

    expect(parsed).toEqual({ model: "gpt-5.4" });
    expect(parsed.provider).toBeUndefined();
  });

  it("update 收到含 provider key 的 providerConfig 時，DB 寫入的 provider_config_json 只含 model", () => {
    const { pod } = podStore.create(canvasId, {
      name: "pod-update-sanitize",
      x: 0,
      y: 0,
      rotation: 0,
    });

    podStore.update(canvasId, pod.id, {
      providerConfig: { provider: "claude", model: "sonnet" } as Record<
        string,
        unknown
      >,
    });

    const row = getDb()
      .prepare("SELECT provider_config_json FROM pods WHERE id = ?")
      .get(pod.id) as { provider_config_json: string };

    const parsed = JSON.parse(row.provider_config_json) as Record<
      string,
      unknown
    >;

    expect(parsed).toEqual({ model: "sonnet" });
    expect(parsed.provider).toBeUndefined();
  });
});

describe("PodStore - resetAllBusyPods", () => {
  let canvasId: string;

  beforeEach(() => {
    vi.clearAllMocks();
    initTestDb();
    resetStatements();
    clearPodStoreCache();

    const stmts = getStatements(getDb());
    canvasId = "test-canvas-reset";
    stmts.canvas.insert.run({
      $id: canvasId,
      $name: "test-canvas-reset",
      $sortIndex: 0,
    });
  });

  afterEach(() => {
    closeDb();
  });

  function createTestPod(name: string) {
    const { pod } = podStore.create(canvasId, {
      name,
      x: 0,
      y: 0,
      rotation: 0,
    });
    return pod;
  }

  it("有 chatting/summarizing Pod 時應重設為 idle 並回傳正確數量", () => {
    const pod1 = createTestPod("pod-chatting");
    const pod2 = createTestPod("pod-summarizing");
    const pod3 = createTestPod("pod-idle");

    // 直接更新 DB 狀態，繞過 socketService 廣播
    getDb()
      .prepare("UPDATE pods SET status = 'chatting' WHERE id = ?")
      .run(pod1.id);
    getDb()
      .prepare("UPDATE pods SET status = 'summarizing' WHERE id = ?")
      .run(pod2.id);

    const count = podStore.resetAllBusyPods();

    expect(count).toBe(2);
    expect(podStore.getById(canvasId, pod1.id)?.status).toBe("idle");
    expect(podStore.getById(canvasId, pod2.id)?.status).toBe("idle");
    expect(podStore.getById(canvasId, pod3.id)?.status).toBe("idle");
  });

  it("無 busy Pod 時應回傳 0", () => {
    createTestPod("pod-idle-only");

    const count = podStore.resetAllBusyPods();

    expect(count).toBe(0);
  });

  it("idle Pod 不應被更動", () => {
    const pod = createTestPod("pod-stays-idle");

    podStore.resetAllBusyPods();

    expect(podStore.getById(canvasId, pod.id)?.status).toBe("idle");
  });
});

describe("PodStore - hasName", () => {
  let canvasId: string;

  beforeEach(() => {
    vi.clearAllMocks();
    initTestDb();
    resetStatements();
    clearPodStoreCache();

    const stmts = getStatements(getDb());
    canvasId = "test-canvas-hasname";
    stmts.canvas.insert.run({
      $id: canvasId,
      $name: "test-canvas-hasname",
      $sortIndex: 0,
    });
  });

  afterEach(() => {
    closeDb();
  });

  it("存在的名稱回傳 true", () => {
    const { pod } = podStore.create(canvasId, {
      name: "existing-pod",
      x: 0,
      y: 0,
      rotation: 0,
    });

    expect(podStore.hasName(canvasId, pod.name)).toBe(true);
  });

  it("不存在的名稱回傳 false", () => {
    expect(podStore.hasName(canvasId, "non-existent-pod")).toBe(false);
  });

  it("excludePodId 排除自己，同名不視為衝突", () => {
    const { pod } = podStore.create(canvasId, {
      name: "self-pod",
      x: 0,
      y: 0,
      rotation: 0,
    });

    // 排除自己時不應算作名稱衝突
    expect(podStore.hasName(canvasId, pod.name, pod.id)).toBe(false);
  });

  it("excludePodId 只排除自己，其他存在的不同名 pod 不影響查詢結果", () => {
    // 建立 pod1 命名為 "pod-conflict-target"
    const { pod: pod1 } = podStore.create(canvasId, {
      name: "pod-conflict-target",
      x: 0,
      y: 0,
      rotation: 0,
    });
    // 建立 pod2 命名為 "pod-conflict-other"（不同名）
    const { pod: pod2 } = podStore.create(canvasId, {
      name: "pod-conflict-other",
      x: 10,
      y: 10,
      rotation: 0,
    });

    // 排除 pod2，查詢 "pod-conflict-target"：pod1 存在，應回傳 true
    expect(podStore.hasName(canvasId, "pod-conflict-target", pod2.id)).toBe(
      true,
    );
    // 排除 pod1，查詢 "pod-conflict-target"：pod1 被排除，應回傳 false
    expect(podStore.hasName(canvasId, "pod-conflict-target", pod1.id)).toBe(
      false,
    );
  });
});

describe("PodStore - create 回傳 integrationBindings", () => {
  let canvasId: string;

  beforeEach(() => {
    vi.clearAllMocks();
    initTestDb();
    resetStatements();
    clearPodStoreCache();

    const stmts = getStatements(getDb());
    canvasId = "test-canvas-create-bindings";
    stmts.canvas.insert.run({
      $id: canvasId,
      $name: "test-canvas-create-bindings",
      $sortIndex: 0,
    });
  });

  afterEach(() => {
    closeDb();
  });

  it("create 直接回傳的 Pod 含 integrationBindings 空陣列", () => {
    const { pod } = podStore.create(canvasId, {
      name: "new-pod",
      x: 0,
      y: 0,
      rotation: 0,
    });

    // create 路徑應直接含 integrationBindings 欄位，與 getById/list 路徑一致
    expect(pod.integrationBindings).toBeDefined();
    expect(Array.isArray(pod.integrationBindings)).toBe(true);
    expect(pod.integrationBindings).toHaveLength(0);
  });
});

// ================================================================
// PodStore - Provider / Model 驗證（create / update / resolveProvider / resolveProviderConfig）
// ================================================================
describe("PodStore - Provider / Model 驗證", () => {
  let canvasId: string;

  beforeEach(() => {
    initTestDb();
    resetStatements();
    clearPodStoreCache();

    // 清除 logger mock 的歷史呼叫紀錄，避免跨測試污染 warn 斷言
    vi.clearAllMocks();

    const stmts = getStatements(getDb());
    canvasId = "test-canvas-provider-validation";
    stmts.canvas.insert.run({
      $id: canvasId,
      $name: "test-canvas-provider-validation",
      $sortIndex: 0,
    });
  });

  afterEach(() => {
    closeDb();
  });

  // ─── create / update + model 驗證 ─────────────────────────────────────────

  it("create 傳入非法 model 時應 throw，且 DB 不應寫入新紀錄", () => {
    const podName = "pod-create-invalid-model";

    expect(() =>
      podStore.create(canvasId, {
        name: podName,
        x: 0,
        y: 0,
        rotation: 0,
        provider: "claude",
        providerConfig: { model: "not-a-model" },
      }),
    ).toThrow(/claude/);

    // DB 內應查不到此 Pod（create 失敗時不該有殘留資料）
    // bun:sqlite 查無資料時回傳 null，故以 toBeFalsy 同時涵蓋 null / undefined
    const row = getDb()
      .prepare("SELECT id FROM pods WHERE canvas_id = ? AND name = ?")
      .get(canvasId, podName);
    expect(row).toBeFalsy();
  });

  it("update 傳入非法 model 時應 throw，且 DB 內容不應被變動", () => {
    // 先建立一個合法 Pod
    const { pod } = podStore.create(canvasId, {
      name: "pod-update-invalid-model",
      x: 0,
      y: 0,
      rotation: 0,
      provider: "claude",
      providerConfig: { model: "opus" },
    });

    // 取得改動前的 DB 狀態快照
    const before = getDb()
      .prepare("SELECT provider, provider_config_json FROM pods WHERE id = ?")
      .get(pod.id) as { provider: string; provider_config_json: string };

    expect(() =>
      podStore.update(canvasId, pod.id, {
        providerConfig: { model: "bogus-model" },
      }),
    ).toThrow(/claude/);

    // 改動後 DB 應與改動前完全一致
    const after = getDb()
      .prepare("SELECT provider, provider_config_json FROM pods WHERE id = ?")
      .get(pod.id) as { provider: string; provider_config_json: string };

    expect(after).toEqual(before);
  });

  it("create 傳入合法 model 時應成功建立並可從 DB 讀出", () => {
    const { pod } = podStore.create(canvasId, {
      name: "pod-create-valid-codex",
      x: 0,
      y: 0,
      rotation: 0,
      provider: "codex",
      providerConfig: { model: "gpt-5.5" },
    });

    const found = podStore.getById(canvasId, pod.id);
    expect(found).toBeDefined();
    expect(found!.provider).toBe("codex");
    expect(found!.providerConfig).toEqual({ model: "gpt-5.5" });

    // DB 原始欄位亦應同步寫入
    const row = getDb()
      .prepare("SELECT provider, provider_config_json FROM pods WHERE id = ?")
      .get(pod.id) as { provider: string; provider_config_json: string };
    expect(row.provider).toBe("codex");
    expect(JSON.parse(row.provider_config_json)).toEqual({ model: "gpt-5.5" });
  });

  it("create 傳入 provider='gemini' 與合法 model 時應成功，pod.provider === 'gemini'", () => {
    const { pod } = podStore.create(canvasId, {
      name: "pod-create-valid-gemini",
      x: 0,
      y: 0,
      rotation: 0,
      provider: "gemini",
      providerConfig: { model: "gemini-2.5-pro" },
    });

    const found = podStore.getById(canvasId, pod.id);
    expect(found).toBeDefined();
    expect(found!.provider).toBe("gemini");
    expect(found!.providerConfig).toEqual({ model: "gemini-2.5-pro" });

    // DB 原始欄位亦應同步寫入
    const row = getDb()
      .prepare("SELECT provider, provider_config_json FROM pods WHERE id = ?")
      .get(pod.id) as { provider: string; provider_config_json: string };
    expect(row.provider).toBe("gemini");
    expect(JSON.parse(row.provider_config_json)).toEqual({
      model: "gemini-2.5-pro",
    });
  });

  it("create 傳入 provider='gemini' 與非法 model 時應 throw，且 DB 不應寫入新紀錄", () => {
    const podName = "pod-gemini-invalid-model";

    expect(() =>
      podStore.create(canvasId, {
        name: podName,
        x: 0,
        y: 0,
        rotation: 0,
        provider: "gemini",
        providerConfig: { model: "not-a-gemini-model" },
      }),
    ).toThrow(/gemini/);

    // create 失敗時不應有殘留資料
    const row = getDb()
      .prepare("SELECT id FROM pods WHERE canvas_id = ? AND name = ?")
      .get(canvasId, podName);
    expect(row).toBeFalsy();
  });

  it("update 傳入另一個合法 model 時應成功更新 DB", () => {
    const { pod } = podStore.create(canvasId, {
      name: "pod-update-valid-model",
      x: 0,
      y: 0,
      rotation: 0,
      provider: "claude",
      providerConfig: { model: "opus" },
    });

    podStore.update(canvasId, pod.id, {
      providerConfig: { model: "sonnet" },
    });

    const row = getDb()
      .prepare("SELECT provider_config_json FROM pods WHERE id = ?")
      .get(pod.id) as { provider_config_json: string };
    expect(JSON.parse(row.provider_config_json)).toEqual({ model: "sonnet" });

    const found = podStore.getById(canvasId, pod.id);
    expect(found!.providerConfig).toEqual({ model: "sonnet" });
  });

  // ─── resolveProvider ─────────────────────────────────────────────────────

  it("resolveProvider 傳入合法 provider 字串時應回傳原值且不呼叫 logger.warn", () => {
    // 直接呼叫純函式，傳入 provider 字串
    expect(resolveProvider("claude")).toBe("claude");
    expect(resolveProvider("codex")).toBe("codex");
    expect(resolveProvider("gemini")).toBe("gemini");

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("resolveProvider 傳入未知 provider 字串時應 fallback 為 claude 並呼叫 logger.warn 至少一次", () => {
    const result = resolveProvider("unknown-xyz");

    expect(result).toBe("claude");
    expect(logger.warn).toHaveBeenCalled();
    // 至少有一次 warn 的訊息帶有 provider 關鍵字與 fallback 字樣（zh-TW）
    const warnCalls = (
      logger.warn as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    const matched = warnCalls.some((call) =>
      call.some(
        (arg) => typeof arg === "string" && arg.includes("unknown-xyz"),
      ),
    );
    expect(matched).toBe(true);
  });

  // ─── resolveProviderConfig ───────────────────────────────────────────────

  it("resolveProviderConfig 在 DB row 缺少 model 時應補上 provider 的 defaultOptions.model", () => {
    // 模擬 DB row：provider_config_json 為空物件，沒有 model 欄位
    // 純函式接受已 JSON.parse 的 rawConfig，需先解析 provider_config_json
    const rawConfig = JSON.parse("{}") as Record<string, unknown>;
    const cfg = resolveProviderConfig(rawConfig, "claude", "row-missing-model");

    // claude 的 defaultOptions.model 為 "opus"
    expect(cfg.model).toBe("opus");
    // 不應因為補預設值觸發 warn（僅當 model 存在但非法才會 warn）
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("resolveProviderConfig 在 DB row 帶有非法 model 時應保留原值不 throw 並呼叫 logger.warn 至少一次", () => {
    // 模擬舊資料：providerConfig.model 為 availableModels 外的歷史值
    // 純函式接受已 JSON.parse 的 rawConfig，需先解析 provider_config_json
    const rawConfig = JSON.parse(
      JSON.stringify({ model: "legacy-unknown-model" }),
    ) as Record<string, unknown>;

    let cfg: Record<string, unknown> = {};
    expect(() => {
      cfg = resolveProviderConfig(
        rawConfig,
        "claude",
        "row-legacy-illegal-model",
      );
    }).not.toThrow();

    // 保留原值，讓舊 pod 仍能被開啟
    expect(cfg.model).toBe("legacy-unknown-model");
    expect(logger.warn).toHaveBeenCalled();
    const warnCalls = (
      logger.warn as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    const matched = warnCalls.some((call) =>
      call.some(
        (arg) =>
          typeof arg === "string" && arg.includes("legacy-unknown-model"),
      ),
    );
    expect(matched).toBe(true);
  });
});

// ================================================================
// PodStore - Provider 切換保留 Note 綁定
// ================================================================
describe("Provider 切換保留 Note 綁定", () => {
  let canvasId: string;

  beforeEach(() => {
    vi.clearAllMocks();
    initTestDb();
    resetStatements();
    clearPodStoreCache();

    const stmts = getStatements(getDb());
    canvasId = "test-canvas-provider-switch";
    stmts.canvas.insert.run({
      $id: canvasId,
      $name: "test-canvas-provider-switch",
      $sortIndex: 0,
    });
  });

  afterEach(() => {
    closeDb();
  });

  function createPodWithNoteBindings(opts: {
    name: string;
    provider: string;
    commandId?: string;
    repositoryId?: string;
  }) {
    const { pod } = podStore.create(canvasId, {
      name: opts.name,
      x: 0,
      y: 0,
      rotation: 0,
      provider: opts.provider as never,
    });

    // 直接設定 commandId / repositoryId
    if (opts.commandId !== undefined) {
      podStore.setCommandId(canvasId, pod.id, opts.commandId);
    }
    if (opts.repositoryId !== undefined) {
      podStore.setRepositoryId(canvasId, pod.id, opts.repositoryId);
    }
    return pod;
  }

  it("claude → gemini：commandId 保留", () => {
    const pod = createPodWithNoteBindings({
      name: "pod-switch-cmd-claude-gemini",
      provider: "claude",
      commandId: "X",
    });

    // 切換 provider 時需同步帶入目標 provider 的合法 model
    podStore.update(canvasId, pod.id, {
      provider: "gemini" as never,
      providerConfig: { model: "gemini-2.5-pro" },
    });

    const found = podStore.getById(canvasId, pod.id);
    expect(found?.provider).toBe("gemini");
    expect(found?.commandId).toBe("X");
  });

  it("claude → gemini：repositoryId 保留", () => {
    const pod = createPodWithNoteBindings({
      name: "pod-switch-repo-claude-gemini",
      provider: "claude",
      repositoryId: "repo-abc",
    });

    podStore.update(canvasId, pod.id, {
      provider: "gemini" as never,
      providerConfig: { model: "gemini-2.5-pro" },
    });

    const found = podStore.getById(canvasId, pod.id);
    expect(found?.provider).toBe("gemini");
    expect(found?.repositoryId).toBe("repo-abc");
  });

  it("gemini → claude：commandId 保留", () => {
    const pod = createPodWithNoteBindings({
      name: "pod-switch-cmd-gemini-claude",
      provider: "gemini",
      commandId: "Y",
    });

    podStore.update(canvasId, pod.id, {
      provider: "claude" as never,
      providerConfig: { model: "opus" },
    });

    const found = podStore.getById(canvasId, pod.id);
    expect(found?.provider).toBe("claude");
    expect(found?.commandId).toBe("Y");
  });

  it("gemini → claude：repositoryId 保留", () => {
    const pod = createPodWithNoteBindings({
      name: "pod-switch-repo-gemini-claude",
      provider: "gemini",
      repositoryId: "repo-xyz",
    });

    podStore.update(canvasId, pod.id, {
      provider: "claude" as never,
      providerConfig: { model: "opus" },
    });

    const found = podStore.getById(canvasId, pod.id);
    expect(found?.provider).toBe("claude");
    expect(found?.repositoryId).toBe("repo-xyz");
  });
});

// ================================================================
// PodStore - mcpServerNames 欄位寫入與 setMcpServerNames setter
// ================================================================
describe("PodStore - mcpServerNames", () => {
  let canvasId: string;

  beforeEach(() => {
    vi.clearAllMocks();
    initTestDb();
    resetStatements();
    clearPodStoreCache();

    const stmts = getStatements(getDb());
    canvasId = "test-canvas-mcp";
    stmts.canvas.insert.run({
      $id: canvasId,
      $name: "test-canvas-mcp",
      $sortIndex: 0,
    });
  });

  afterEach(() => {
    closeDb();
  });

  function createTestPod(name: string) {
    const { pod } = podStore.create(canvasId, {
      name,
      x: 0,
      y: 0,
      rotation: 0,
    });
    return pod;
  }

  it("create 後 getById 回傳的 mcpServerNames 為空陣列", () => {
    const pod = createTestPod("pod-mcp-initial");

    const found = podStore.getById(canvasId, pod.id);

    expect(found).toBeDefined();
    expect(Array.isArray(found!.mcpServerNames)).toBe(true);
    expect(found!.mcpServerNames).toHaveLength(0);
  });

  it("setMcpServerNames 後 getById 可讀取到寫入的 names", () => {
    const pod = createTestPod("pod-mcp-set");

    podStore.setMcpServerNames(pod.id, ["server-a", "server-b"]);

    const found = podStore.getById(canvasId, pod.id);
    expect(found).toBeDefined();
    expect(found!.mcpServerNames).toEqual(
      expect.arrayContaining(["server-a", "server-b"]),
    );
    expect(found!.mcpServerNames).toHaveLength(2);
  });

  it("setMcpServerNames 全量替換：再次呼叫應覆蓋舊清單", () => {
    const pod = createTestPod("pod-mcp-replace");

    // 初次寫入
    podStore.setMcpServerNames(pod.id, ["server-a", "server-b"]);
    // 全量替換（只保留 server-c）
    podStore.setMcpServerNames(pod.id, ["server-c"]);

    const found = podStore.getById(canvasId, pod.id);
    expect(found!.mcpServerNames).toEqual(["server-c"]);
  });

  it("setMcpServerNames 傳空陣列應清空 mcpServerNames", () => {
    const pod = createTestPod("pod-mcp-clear");

    podStore.setMcpServerNames(pod.id, ["server-a"]);
    podStore.setMcpServerNames(pod.id, []);

    const found = podStore.getById(canvasId, pod.id);
    expect(found!.mcpServerNames).toHaveLength(0);
  });

  it("list 也應回傳正確的 mcpServerNames", () => {
    const pod = createTestPod("pod-mcp-list");

    podStore.setMcpServerNames(pod.id, ["list-server"]);

    const pods = podStore.list(canvasId);
    const found = pods.find((p) => p.id === pod.id);
    expect(found).toBeDefined();
    expect(found!.mcpServerNames).toContain("list-server");
  });
});
