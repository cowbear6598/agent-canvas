/**
 * pluginMcpBridge 單元測試
 *
 * 覆蓋以下測試案例：
 * - resolvePodPluginScope：mock db 介面，驗證只回傳該 Pod 勾選且存在於
 *   managed_plugins 的項目
 */

import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolvePodPluginScope,
  resolvePluginBridgeDbPath,
  type MinimalDatabase,
} from "../../src/services/plugin/pluginMcpBridge.js";
import { APP_DATA_ROOT_ENV_NAME } from "../../src/config/appDataPath.js";
import { overrideEnv } from "../helpers/tmpDirHelper.js";

// ─── fake db builder ─────────────────────────────────────────────────────────

/**
 * 建立最小 fake db，模擬以下兩張表：
 *   - pod_plugin_ids (pod_id, plugin_id)
 *   - managed_plugins (id, install_path)
 */
function buildFakeDb(
  podPluginIds: Array<{ pod_id: string; plugin_id: string }>,
  managedPlugins: Array<{ id: string; install_path: string }>,
): MinimalDatabase {
  return {
    prepare(sql: string) {
      return {
        all(...params: unknown[]) {
          if (sql.includes("pod_plugin_ids")) {
            const podId = params[0] as string;
            return podPluginIds
              .filter((r) => r.pod_id === podId)
              .map((r) => ({ plugin_id: r.plugin_id }));
          }

          if (sql.includes("managed_plugins")) {
            // IN (?, ?, ...) — params 是 plugin id 清單
            const ids = params as string[];
            return managedPlugins
              .filter((p) => ids.includes(p.id))
              .map((p) => ({ id: p.id, install_path: p.install_path }));
          }

          return [];
        },
      };
    },
  };
}

let restoreEnv: (() => void) | null = null;

afterEach(() => {
  restoreEnv?.();
  restoreEnv = null;
});

// ════════════════════════════════════════════════════════════════════════════
// resolvePodPluginScope
// ════════════════════════════════════════════════════════════════════════════

describe("resolvePodPluginScope", () => {
  it("Pod 啟用兩個 plugin 且兩者都存在於 managed_plugins，回傳兩筆 Map", () => {
    const db = buildFakeDb(
      [
        { pod_id: "pod-1", plugin_id: "plugin-a" },
        { pod_id: "pod-1", plugin_id: "plugin-b" },
      ],
      [
        { id: "plugin-a", install_path: "/plugins/a" },
        { id: "plugin-b", install_path: "/plugins/b" },
      ],
    );

    const scope = resolvePodPluginScope(db, "pod-1");

    expect(scope.size).toBe(2);
    expect(scope.get("plugin-a")).toBe("/plugins/a");
    expect(scope.get("plugin-b")).toBe("/plugins/b");
  });

  it("Pod 啟用的 plugin 只有部分存在於 managed_plugins，只回傳存在的項目", () => {
    const db = buildFakeDb(
      [
        { pod_id: "pod-1", plugin_id: "plugin-a" },
        { pod_id: "pod-1", plugin_id: "plugin-ghost" }, // 不存在於 managed_plugins
      ],
      [{ id: "plugin-a", install_path: "/plugins/a" }],
    );

    const scope = resolvePodPluginScope(db, "pod-1");

    expect(scope.size).toBe(1);
    expect(scope.get("plugin-a")).toBe("/plugins/a");
    expect(scope.has("plugin-ghost")).toBe(false);
  });

  it("Pod 沒有勾選任何 plugin，回傳空 Map", () => {
    const db = buildFakeDb(
      [],
      [{ id: "plugin-a", install_path: "/plugins/a" }],
    );

    const scope = resolvePodPluginScope(db, "pod-no-plugins");

    expect(scope.size).toBe(0);
  });

  it("不同 Pod 的 plugin 不會混入目標 Pod 的 scope", () => {
    const db = buildFakeDb(
      [
        { pod_id: "pod-1", plugin_id: "plugin-a" },
        { pod_id: "pod-2", plugin_id: "plugin-b" }, // 屬於另一個 Pod
      ],
      [
        { id: "plugin-a", install_path: "/plugins/a" },
        { id: "plugin-b", install_path: "/plugins/b" },
      ],
    );

    const scope = resolvePodPluginScope(db, "pod-1");

    expect(scope.size).toBe(1);
    expect(scope.get("plugin-a")).toBe("/plugins/a");
    expect(scope.has("plugin-b")).toBe(false);
  });

  it("managed_plugins 完全為空時，即使 Pod 有勾選也回傳空 Map", () => {
    const db = buildFakeDb(
      [{ pod_id: "pod-1", plugin_id: "plugin-a" }],
      [], // 沒有任何已安裝的 plugin
    );

    const scope = resolvePodPluginScope(db, "pod-1");

    expect(scope.size).toBe(0);
  });

  it("install_path 應原封不動地放進 Map，不經過任何路徑轉換", () => {
    const db = buildFakeDb(
      [{ pod_id: "pod-1", plugin_id: "plugin-c" }],
      [{ id: "plugin-c", install_path: "/some/custom/path/with spaces" }],
    );

    const scope = resolvePodPluginScope(db, "pod-1");

    expect(scope.get("plugin-c")).toBe("/some/custom/path/with spaces");
  });
});

describe("resolvePluginBridgeDbPath", () => {
  it("有注入 app data root 時優先使用注入路徑組出 canvas.db", () => {
    restoreEnv = overrideEnv({
      [APP_DATA_ROOT_ENV_NAME]: "/tmp/dev-agent-canvas",
    });

    const dbPath = resolvePluginBridgeDbPath({
      homeDir: "/Users/ignored",
    });

    expect(dbPath).toBe("/tmp/dev-agent-canvas/canvas.db");
  });

  it("沒有注入 app data root 時回退到正式預設目錄", () => {
    restoreEnv = overrideEnv({
      [APP_DATA_ROOT_ENV_NAME]: undefined,
    });

    const dbPath = resolvePluginBridgeDbPath({
      homeDir: "/Users/release-user",
    });

    expect(dbPath).toBe(
      path.join("/Users/release-user", "Documents", "AgentCanvas", "canvas.db"),
    );
  });
});
