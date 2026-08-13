import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, getDb, initTestDb } from "../../src/database/index.js";
import {
  getStatements,
  resetStatements,
} from "../../src/database/statements.js";
import { podStore } from "../../src/services/podStore.js";
import { podCommandService } from "../../src/services/commands/podCommandService.js";
import { abortRegistry } from "../../src/services/provider/abortRegistry.js";

const CANVAS_ID = "canvas-fast-mode";

vi.mock("../../src/services/canvasStore.js", () => ({
  canvasStore: {
    getCanvasDir: vi.fn(() => "/tmp/canvas-fast-mode"),
    getById: vi.fn((id: string) => ({ id, name: "Fast mode", sortIndex: 0 })),
    list: vi.fn(() => []),
  },
}));

function clearPodStoreCache(): void {
  (
    podStore as unknown as { stmtCache: Map<string, unknown> }
  ).stmtCache.clear();
}

function createOpusPod() {
  return podStore.create(CANVAS_ID, {
    name: `fast-pod-${crypto.randomUUID()}`,
    x: 0,
    y: 0,
    rotation: 0,
    provider: "claude",
    providerConfig: { model: "opus" },
  }).pod;
}

beforeEach(() => {
  abortRegistry.abortAll();
  initTestDb();
  resetStatements();
  clearPodStoreCache();
  getStatements(getDb()).canvas.insert.run({
    $id: CANVAS_ID,
    $name: "Fast mode",
    $sortIndex: 0,
  });
});

afterEach(() => {
  abortRegistry.abortAll();
  closeDb();
});

describe("Pod Fast mode", () => {
  it("新建 Pod 預設關閉，且會持久化與回傳完整狀態", () => {
    const pod = createOpusPod();

    expect(pod.fastModeEnabled).toBe(false);
    expect(podStore.getById(CANVAS_ID, pod.id)?.fastModeEnabled).toBe(false);
    const row = getDb()
      .prepare("SELECT fast_mode_enabled FROM pods WHERE id = ?")
      .get(pod.id) as { fast_mode_enabled: number };
    expect(row.fast_mode_enabled).toBe(0);

    const result = podCommandService.setFastMode({
      canvasId: CANVAS_ID,
      podId: pod.id,
      requestId: "req-fast-on",
      existingPod: pod,
      enabled: true,
    });

    expect(result.data.pod.fastModeEnabled).toBe(true);
    expect(podStore.getById(CANVAS_ID, pod.id)?.fastModeEnabled).toBe(true);
    expect(result.dispatches).toEqual([
      expect.objectContaining({
        scope: "canvas",
        canvasId: CANVAS_ID,
        event: "pod:fast-mode:set",
      }),
    ]);
  });

  it("內部複製流程可保留支援模型的 Fast 狀態，但不會讓不支援模型誤開", () => {
    const supported = podStore.create(CANVAS_ID, {
      name: "copied-fast-pod",
      x: 0,
      y: 0,
      rotation: 0,
      provider: "claude",
      providerConfig: { model: "opus" },
      fastModeEnabled: true,
    }).pod;
    const unsupported = podStore.create(CANVAS_ID, {
      name: "copied-unsupported-fast-pod",
      x: 0,
      y: 0,
      rotation: 0,
      provider: "claude",
      providerConfig: { model: "sonnet" },
      fastModeEnabled: true,
    }).pod;

    expect(supported.fastModeEnabled).toBe(true);
    expect(unsupported.fastModeEnabled).toBe(false);
  });

  it("不支援的 provider/model 不可開啟 Fast mode", () => {
    const { pod } = podStore.create(CANVAS_ID, {
      name: "unsupported-fast-pod",
      x: 0,
      y: 0,
      rotation: 0,
      provider: "claude",
      providerConfig: { model: "sonnet" },
    });

    expect(() =>
      podCommandService.setFastMode({
        canvasId: CANVAS_ID,
        podId: pod.id,
        requestId: "req-fast-unsupported",
        existingPod: pod,
        enabled: true,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "POD_FAST_MODE_UNSUPPORTED" }),
    );
    expect(podStore.getById(CANVAS_ID, pod.id)?.fastModeEnabled).toBe(false);
  });

  it("切到不支援模型會關閉並保存，切回支援模型後維持關閉", () => {
    const pod = createOpusPod();
    podCommandService.setFastMode({
      canvasId: CANVAS_ID,
      podId: pod.id,
      requestId: "req-fast-on",
      existingPod: pod,
      enabled: true,
    });

    const enabledPod = podStore.getById(CANVAS_ID, pod.id)!;
    podCommandService.setModel({
      canvasId: CANVAS_ID,
      podId: pod.id,
      requestId: "req-sonnet",
      existingPod: enabledPod,
      model: "sonnet",
    });
    expect(podStore.getById(CANVAS_ID, pod.id)?.fastModeEnabled).toBe(false);

    const disabledPod = podStore.getById(CANVAS_ID, pod.id)!;
    podCommandService.setModel({
      canvasId: CANVAS_ID,
      podId: pod.id,
      requestId: "req-opus",
      existingPod: disabledPod,
      model: "opus",
    });
    expect(podStore.getById(CANVAS_ID, pod.id)?.fastModeEnabled).toBe(false);
  });

  it("既有查詢進行中仍可切換，變更供後續 Run 使用", () => {
    const pod = createOpusPod();
    podCommandService.setFastMode({
      canvasId: CANVAS_ID,
      podId: pod.id,
      requestId: "req-fast-on",
      existingPod: pod,
      enabled: true,
    });
    const enabledPod = podStore.getById(CANVAS_ID, pod.id)!;
    abortRegistry.register("query-fast-mode", pod.id);

    expect(() =>
      podCommandService.setFastMode({
        canvasId: CANVAS_ID,
        podId: pod.id,
        requestId: "req-fast-off",
        existingPod: enabledPod,
        enabled: false,
      }),
    ).not.toThrow();
    expect(podStore.getById(CANVAS_ID, pod.id)?.fastModeEnabled).toBe(false);
  });
});
