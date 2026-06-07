import { afterEach, describe, expect, it } from "vitest";
import { APP_DATA_ROOT_ENV_NAME } from "../../src/config/appDataPath.js";
import { buildPluginMcpEntry } from "../../src/services/plugin/pluginMcpEntryBuilder.js";
import { overrideEnv } from "../helpers/tmpDirHelper.js";

let restoreEnv: (() => void) | null = null;

afterEach(() => {
  restoreEnv?.();
  restoreEnv = null;
});

describe("buildPluginMcpEntry", () => {
  it("有 override 時會把 AGENT_CANVAS_APP_DATA_DIR 傳給 bridge child process", () => {
    restoreEnv = overrideEnv({
      [APP_DATA_ROOT_ENV_NAME]: "/tmp/dev-agent-canvas",
    });

    const entry = buildPluginMcpEntry("pod-123");

    expect(entry.env).toEqual({
      AGENT_CANVAS_PLUGIN_MCP_POD_ID: "pod-123",
      [APP_DATA_ROOT_ENV_NAME]: "/tmp/dev-agent-canvas",
    });
  });

  it("沒有 override 時只保留 pod id，不注入多餘 app data env", () => {
    restoreEnv = overrideEnv({
      [APP_DATA_ROOT_ENV_NAME]: undefined,
    });

    const entry = buildPluginMcpEntry("pod-456");

    expect(entry.env).toEqual({
      AGENT_CANVAS_PLUGIN_MCP_POD_ID: "pod-456",
    });
    expect(entry.env).not.toHaveProperty(APP_DATA_ROOT_ENV_NAME);
  });
});
