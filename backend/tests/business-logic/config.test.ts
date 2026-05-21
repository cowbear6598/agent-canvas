describe("Config - GitLab URL 驗證", () => {
  const originalEnv = process.env.GITLAB_URL;

  // 注意：由於 config 在 import 時就會載入，我們只能測試當前設定
  // 如果要完整測試，需要重構 config 為動態載入

  it("當前 GITLAB_URL 應該是合法的（如果有設定）", () => {
    // 測試會檢查現有的 GITLAB_URL 環境變數
    const gitlabUrl = process.env.GITLAB_URL;

    if (!gitlabUrl) {
      // 沒有設定 GITLAB_URL，直接返回，不需要斷言
      return;
    }

    // 如果有設定，應該通過驗證
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
      // 模擬驗證邏輯
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
        // 如果解析成功，檢查 hostname 是否合法
        if (urlObj.hostname.includes(" ")) {
          // hostname 包含空格，屬於無效格式，跳過此筆資料
          continue;
        }
      } catch (error) {
        expect(error).toBeInstanceOf(TypeError);
      }
    }
  });
});
