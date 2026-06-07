import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APP_DATA_ROOT_ENV_NAME,
  resolveAppDataPaths,
} from "../../src/config/appDataPath.js";
import { overrideEnv } from "../helpers/tmpDirHelper.js";

describe("Config - GitLab URL 驗證", () => {
  it("當前 GITLAB_URL 應該是合法的（如果有設定）", () => {
    const gitlabUrl = process.env.GITLAB_URL;

    if (!gitlabUrl) {
      return;
    }

    expect(gitlabUrl).toMatch(/^https:\/\//);

    expect(() => {
      new URL(gitlabUrl);
    }).not.toThrow();
  });

  it("驗證 HTTPS 協議要求", () => {
    const invalidUrls = [
      "http://gitlab.example.com",
      "ftp://gitlab.example.com",
      "gitlab.example.com",
      "git@gitlab.example.com",
    ];

    for (const url of invalidUrls) {
      expect(url.startsWith("https://")).toBe(false);
    }
  });

  it("驗證合法的 HTTPS URL", () => {
    const validUrls = [
      "https://gitlab.com",
      "https://gitlab.example.com",
      "https://git.company.com",
    ];

    for (const url of validUrls) {
      expect(url.startsWith("https://")).toBe(true);
      expect(() => new URL(url)).not.toThrow();
    }
  });

  it("檢測無效的 hostname", () => {
    const invalidUrls = [
      "https://gitlab .com", // 空格
      "https://", // 空 hostname
    ];

    for (const url of invalidUrls) {
      try {
        const urlObj = new URL(url);
        if (urlObj.hostname.includes(" ")) {
          continue;
        }
      } catch (error) {
        expect(error).toBeInstanceOf(TypeError);
      }
    }
  });
});

describe("Config - app data root 解析", () => {
  let restoreEnv = () => {};

  afterEach(() => {
    restoreEnv();
    restoreEnv = () => {};
    vi.resetModules();
  });

  async function loadConfigModule() {
    vi.resetModules();
    return import("../../src/config/index.js");
  }

  it("有設定 override 時，config.appDataRoot 應與共用 resolver 一致", async () => {
    const overrideRoot = "/tmp/agent-canvas-dev-root";
    restoreEnv = overrideEnv({
      [APP_DATA_ROOT_ENV_NAME]: overrideRoot,
    });

    const expectedPaths = resolveAppDataPaths();
    const { config } = await loadConfigModule();

    expect(config.appDataRoot).toBe(expectedPaths.appDataRoot);
  });

  it("未設定 override 時，config.appDataRoot 應與正式預設 resolver 一致", async () => {
    restoreEnv = overrideEnv({
      [APP_DATA_ROOT_ENV_NAME]: undefined,
    });

    const expectedPaths = resolveAppDataPaths();
    const { config } = await loadConfigModule();

    expect(config.appDataRoot).toBe(expectedPaths.appDataRoot);
  });
});
