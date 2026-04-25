// 取消 testConfig.ts 中的全域 logger mock，讓此測試使用真實 logger
vi.unmock("../../src/utils/logger.js");

// ANSI 顏色碼常數
const ANSI_COLORS = {
  RESET: "\x1b[0m",
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  BLUE: "\x1b[34m",
  MAGENTA: "\x1b[35m",
  GRAY: "\x1b[90m",
};

describe("Logger 顏色輸出", () => {
  let consoleLogCalls: string[] = [];
  let consoleErrorCalls: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  beforeEach(() => {
    consoleLogCalls = [];
    consoleErrorCalls = [];
    console.log = (...args: any[]) => {
      consoleLogCalls.push(args[0]);
    };
    console.error = (...args: any[]) => {
      consoleErrorCalls.push(args[0]);
    };
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  async function getLogger() {
    // 使用 vi.resetModules() 清除模組快取，取代原本的動態 import 時間戳繞過方式
    // （vitest 不支援帶 query string 的動態 import）
    vi.resetModules();
    const module = await import("../../src/utils/logger.js");
    return module.logger;
  }

  describe("系統類 Category 使用灰色", () => {
    it("Startup Category 輸出包含灰色 ANSI 碼", async () => {
      const logger = await getLogger();
      logger.log("Startup", "Load", "伺服器啟動中...");
      expect(consoleLogCalls[0]).toContain(ANSI_COLORS.GRAY);
      expect(consoleLogCalls[0]).toContain("[Startup]");
    });

    it("Connection Category 輸出包含灰色 ANSI 碼", async () => {
      const logger = await getLogger();
      logger.log("Connection", "Create", "建立連線");
      expect(consoleLogCalls[0]).toContain(ANSI_COLORS.GRAY);
      expect(consoleLogCalls[0]).toContain("[Connection]");
    });

    it("WebSocket Category 輸出包含灰色 ANSI 碼", async () => {
      const logger = await getLogger();
      logger.log("WebSocket", "Update", "WebSocket 已連線");
      expect(consoleLogCalls[0]).toContain(ANSI_COLORS.GRAY);
      expect(consoleLogCalls[0]).toContain("[WebSocket]");
    });
  });

  describe("Pod 類 Category 使用藍色", () => {
    it("Pod Category 輸出包含藍色 ANSI 碼", async () => {
      const logger = await getLogger();
      logger.log("Pod", "Create", "正在建立 Pod: my-pod");
      expect(consoleLogCalls[0]).toContain(ANSI_COLORS.BLUE);
      expect(consoleLogCalls[0]).toContain("[Pod]");
    });

    it("Workflow Category 輸出包含藍色 ANSI 碼", async () => {
      const logger = await getLogger();
      logger.log("Workflow", "Create", "建立工作流程");
      expect(consoleLogCalls[0]).toContain(ANSI_COLORS.BLUE);
      expect(consoleLogCalls[0]).toContain("[Workflow]");
    });

    it("SubAgent Category 輸出包含藍色 ANSI 碼", async () => {
      const logger = await getLogger();
      logger.log("SubAgent", "Create", "建立子代理");
      expect(consoleLogCalls[0]).toContain(ANSI_COLORS.BLUE);
      expect(consoleLogCalls[0]).toContain("[SubAgent]");
    });
  });

  describe("資料類 Category 使用紫色", () => {
    it("Repository Category 輸出包含紫色 ANSI 碼", async () => {
      const logger = await getLogger();
      logger.log("Repository", "Create", "正在 Clone Repository: my-repo");
      expect(consoleLogCalls[0]).toContain(ANSI_COLORS.MAGENTA);
      expect(consoleLogCalls[0]).toContain("[Repository]");
    });

    it("Workspace Category 輸出包含紫色 ANSI 碼", async () => {
      const logger = await getLogger();
      logger.log("Workspace", "Create", "建立工作區");
      expect(consoleLogCalls[0]).toContain(ANSI_COLORS.MAGENTA);
      expect(consoleLogCalls[0]).toContain("[Workspace]");
    });

    it("Canvas Category 輸出包含紫色 ANSI 碼", async () => {
      const logger = await getLogger();
      logger.log("Canvas", "Update", "更新畫布");
      expect(consoleLogCalls[0]).toContain(ANSI_COLORS.MAGENTA);
      expect(consoleLogCalls[0]).toContain("[Canvas]");
    });
  });

  describe("功能類 Category 使用綠色", () => {
    it("Skill Category 輸出包含綠色 ANSI 碼", async () => {
      const logger = await getLogger();
      logger.log("Skill", "Create", "Skill 建立成功: my-skill");
      expect(consoleLogCalls[0]).toContain(ANSI_COLORS.GREEN);
      expect(consoleLogCalls[0]).toContain("[Skill]");
    });

    it("Command Category 輸出包含綠色 ANSI 碼", async () => {
      const logger = await getLogger();
      logger.log("Command", "Create", "執行命令");
      expect(consoleLogCalls[0]).toContain(ANSI_COLORS.GREEN);
      expect(consoleLogCalls[0]).toContain("[Command]");
    });

    it("Chat Category 輸出包含綠色 ANSI 碼", async () => {
      const logger = await getLogger();
      logger.log("Chat", "Create", "建立聊天");
      expect(consoleLogCalls[0]).toContain(ANSI_COLORS.GREEN);
      expect(consoleLogCalls[0]).toContain("[Chat]");
    });
  });

  describe("其他類 Category 使用黃色", () => {
    it("Git Category 輸出包含黃色 ANSI 碼", async () => {
      const logger = await getLogger();
      logger.log("Git", "Update", "Git Push 完成");
      expect(consoleLogCalls[0]).toContain(ANSI_COLORS.YELLOW);
      expect(consoleLogCalls[0]).toContain("[Git]");
    });

    it("Note Category 輸出包含黃色 ANSI 碼", async () => {
      const logger = await getLogger();
      logger.log("Note", "Create", "建立筆記");
      expect(consoleLogCalls[0]).toContain(ANSI_COLORS.YELLOW);
      expect(consoleLogCalls[0]).toContain("[Note]");
    });

    it("Paste Category 輸出包含黃色 ANSI 碼", async () => {
      const logger = await getLogger();
      logger.log("Paste", "Create", "建立貼上");
      expect(consoleLogCalls[0]).toContain(ANSI_COLORS.YELLOW);
      expect(consoleLogCalls[0]).toContain("[Paste]");
    });

    it("Schedule Category 輸出包含黃色 ANSI 碼", async () => {
      const logger = await getLogger();
      logger.log("Schedule", "Create", "建立排程");
      expect(consoleLogCalls[0]).toContain(ANSI_COLORS.YELLOW);
      expect(consoleLogCalls[0]).toContain("[Schedule]");
    });
  });

  describe("錯誤訊息強制紅色", () => {
    it("logger.error 輸出整段訊息為紅色", async () => {
      const logger = await getLogger();
      logger.error("Pod", "Error", "Pod 建立失敗: 名稱重複");
      expect(consoleErrorCalls[0]).toContain(ANSI_COLORS.RED);
      expect(consoleErrorCalls[0]).toContain("[Pod]");
      expect(consoleErrorCalls[0]).toContain("[Error]");
      expect(consoleErrorCalls[0]).toContain("Pod 建立失敗: 名稱重複");
    });

    it("錯誤訊息覆蓋原本的 Category 顏色", async () => {
      const logger = await getLogger();
      logger.error("Skill", "Error", "Skill 建立失敗");
      expect(consoleErrorCalls[0]).toContain(ANSI_COLORS.RED);
      // 確保不包含綠色（Skill 原本的顏色）
      expect(consoleErrorCalls[0]).not.toContain(ANSI_COLORS.GREEN);
    });

    it("錯誤物件的堆疊追蹤也是紅色", async () => {
      const logger = await getLogger();
      const error = new Error("測試錯誤");
      logger.error("Repository", "Error", "Repository Clone 失敗", error);

      // 第一次呼叫是錯誤訊息
      expect(consoleErrorCalls[0]).toContain(ANSI_COLORS.RED);
      // 第二次呼叫是堆疊追蹤
      expect(consoleErrorCalls[1]).toContain(ANSI_COLORS.RED);
    });
  });

  describe("日誌格式正確性", () => {
    it("輸出格式維持 [Category] [Action] Message", async () => {
      const logger = await getLogger();
      logger.log("Pod", "Create", "正在建立 Pod");
      const output = consoleLogCalls[0];

      // 移除 ANSI 顏色碼後檢查格式
      const cleanOutput = output.replace(/\x1b\[\d+m/g, "");
      expect(cleanOutput).toBe("[Pod] [Create] 正在建立 Pod");
    });

    it("只有 [Category] 部分有顏色（一般 log）", async () => {
      const logger = await getLogger();
      logger.log("Skill", "Create", "Skill 建立成功");
      const output = consoleLogCalls[0];

      expect(output).toContain(ANSI_COLORS.GREEN);
      expect(output).toContain(ANSI_COLORS.RESET);
      expect(output).toMatch(
        /\x1b\[32m\[Skill\]\x1b\[0m \[Create\] Skill 建立成功/,
      );
    });

    it("[Action] 和 Message 部分無顏色（一般 log）", async () => {
      const logger = await getLogger();
      logger.log("Pod", "Create", "正在建立 Pod");
      const output = consoleLogCalls[0];

      const afterCategory = output.split(ANSI_COLORS.RESET)[1];

      expect(afterCategory).not.toContain(ANSI_COLORS.BLUE);
      expect(afterCategory).not.toContain(ANSI_COLORS.RED);
      expect(afterCategory).not.toContain(ANSI_COLORS.GREEN);
      expect(afterCategory).not.toContain(ANSI_COLORS.YELLOW);
      expect(afterCategory).not.toContain(ANSI_COLORS.MAGENTA);
      expect(afterCategory).not.toContain(ANSI_COLORS.GRAY);
    });
  });

  describe("敏感資訊遮罩功能", () => {
    it("GitHub Token 遮罩正常運作", async () => {
      const logger = await getLogger();
      const error = new Error(
        "https://ghp_1234567890123456789012345678901234@github.com",
      );
      logger.error("Repository", "Error", "Clone 失敗", error);

      const stackTrace = consoleErrorCalls[1];
      // URL 中的 token 被通用規則遮罩成 https://***@github.com
      expect(stackTrace).toContain("https://***@github.com");
      expect(stackTrace).not.toContain(
        "ghp_1234567890123456789012345678901234",
      );
    });

    it("GitLab Token 遮罩正常運作", async () => {
      const logger = await getLogger();
      const error = new Error(
        "https://oauth2:glpat-12345678901234567890@gitlab.com",
      );
      logger.error("Repository", "Error", "Clone 失敗", error);

      const stackTrace = consoleErrorCalls[1];
      // GitLab URL 中的整個 oauth2:token 部分被遮罩
      expect(stackTrace).toContain("https://***@[REDACTED]");
      expect(stackTrace).not.toContain("glpat-12345678901234567890");
    });

    it("URL 中的 Token 遮罩正常運作", async () => {
      const logger = await getLogger();
      const error = new Error("https://mytoken123@github.com/repo");
      logger.error("Repository", "Error", "Clone 失敗", error);

      const stackTrace = consoleErrorCalls[1];
      expect(stackTrace).toContain("https://***@github.com");
      expect(stackTrace).not.toContain("mytoken123");
    });

    it("Slack Bot Token（xoxb-）遮罩正常運作", async () => {
      const logger = await getLogger();
      const fakeToken = `xoxb-${"0".repeat(13)}-${"0".repeat(13)}-${"a".repeat(16)}`;
      const error = new Error(`token=${fakeToken}`);
      logger.error("Slack", "Error", "Slack 連線失敗", error);

      const stackTrace = consoleErrorCalls[1];
      expect(stackTrace).toContain("xox***");
      expect(stackTrace).not.toContain(fakeToken);
    });

    it("Slack App Token（xapp-）遮罩正常運作", async () => {
      const logger = await getLogger();
      const fakeAppToken = `xapp-1-${"A".repeat(7)}-${"0".repeat(12)}-${"b".repeat(6)}`;
      const error = new Error(`appToken=${fakeAppToken}`);
      logger.error("Slack", "Error", "Slack 連線失敗", error);

      const stackTrace = consoleErrorCalls[1];
      expect(stackTrace).toContain("xapp***");
      expect(stackTrace).not.toContain(fakeAppToken);
    });
  });
});
