/**
 * scheduleService 單元測試（Phase 3 重寫）
 *
 * 保留合理 boundary mock：
 *   - getProvider（SDK boundary：buildPodFromRow → resolveProviderConfig 需要 metadata）
 *   - executeStreamingChat（Claude/Codex SDK 入口）
 *   - launchRun（multi-run SDK 入口）
 *   - workflowExecutionService.checkAndTriggerWorkflows（非同步 side-effect，非本測試範疇）
 *   - commandService.read（filesystem 邊界）
 *   - fireAndForget（讓 workflow callback 同步執行，避免非同步洩漏）
 *   - onRunChatComplete（run 完成回呼，非本測試範疇）
 *   - logger（side-effect only）
 *
 * 移除自家 store mock：podStore / messageStore 改用 initTestDb + 真 store。
 * socketService.emit* 改用 vi.spyOn 觀察，不整體 mock。
 * configStore.getTimezoneOffset 改用 vi.spyOn 返回固定 offset=0。
 */

// ---- SDK boundary mock（必須在 import 之前宣告） ----

// getProvider：buildPodFromRow → resolveProviderConfig → getProvider(provider).metadata
vi.mock("../../src/services/provider/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/services/provider/index.js")
    >();
  return {
    ...actual,
    getProvider: vi.fn(() => ({
      chat: vi.fn(async function* () {}),
      cancel: vi.fn(() => false),
      buildOptions: vi.fn().mockResolvedValue({}),
      metadata: {
        availableModelValues: new Set(["opus", "sonnet", "haiku"]),
        defaultOptions: { model: "opus" },
        availableModels: [
          { label: "Opus", value: "opus" },
          { label: "Sonnet", value: "sonnet" },
          { label: "Haiku", value: "haiku" },
        ],
      },
    })),
  };
});

// executeStreamingChat：Claude SDK 入口
vi.mock("../../src/services/claude/streamingChatExecutor.js", () => ({
  executeStreamingChat: vi.fn().mockResolvedValue(undefined),
}));

// launchRun：multi-run SDK 入口
vi.mock("../../src/utils/runChatHelpers.js", () => ({
  launchRun: vi.fn().mockResolvedValue({
    runId: "run-1",
    canvasId: "canvas-1",
    sourcePodId: "pod-1",
  }),
}));

// workflowExecutionService：非同步 side-effect，非本測試範疇
vi.mock("../../src/services/workflow/index.js", () => ({
  workflowExecutionService: {
    checkAndTriggerWorkflows: vi.fn().mockResolvedValue(undefined),
  },
}));

// commandService.read：filesystem 邊界（預設回傳 null，各 test 依需求覆寫）
vi.mock("../../src/services/commandService.js", () => ({
  commandService: {
    read: vi.fn().mockResolvedValue(null),
  },
}));

// fireAndForget：讓 workflow callback 在同一 tick 執行，避免非同步洩漏
vi.mock("../../src/utils/operationHelpers.js", () => ({
  fireAndForget: vi.fn((promise: Promise<unknown>) => promise),
}));

// onRunChatComplete：run 完成回呼，非本測試範疇
vi.mock("../../src/utils/chatCallbacks.js", () => ({
  onRunChatComplete: vi.fn().mockResolvedValue(undefined),
}));

// logger：side-effect only
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ---- imports ----

import path from "path";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

import { initTestDb, closeDb, getDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { podStore } from "../../src/services/podStore.js";
import { messageStore } from "../../src/services/messageStore.js";
import { socketService } from "../../src/services/socketService.js";
import { configStore } from "../../src/services/configStore.js";
import {
  scheduleService,
  shouldFireCheckers,
} from "../../src/services/scheduleService.js";
import * as executeStreamingChatModule from "../../src/services/claude/streamingChatExecutor.js";
import * as launchRunModule from "../../src/utils/runChatHelpers.js";
import * as commandServiceModule from "../../src/services/commandService.js";
import { WebSocketResponseEvents } from "../../src/schemas/index.js";
import {
  toOffsettedParts,
  isSameDayWithOffset,
} from "../../src/utils/timezoneUtils.js";
import type { ScheduleConfig } from "../../src/types/index.js";
import { config } from "../../src/config/index.js";

function asMock(fn: unknown): Mock<any> {
  return fn as Mock<any>;
}

// ---- shouldFireCheckers 純函數測試用常數 ----

const OFFSET = 0; // UTC offset=0，確保測試結果與時區無關

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

/** 基礎排程設定工廠 */
function makeSchedule(overrides: Partial<ScheduleConfig> = {}): ScheduleConfig {
  return {
    frequency: "every-second",
    second: 1,
    intervalMinute: 5,
    intervalHour: 1,
    hour: 9,
    minute: 30,
    weekdays: [],
    enabled: true,
    lastTriggeredAt: null,
    ...overrides,
  };
}

// ---- DB helpers（整合測試用） ----

const CANVAS_ID = "canvas-sched";
const POD_ID = "pod-sched";

/** 清除 podStore 內部 LRU 快取，防止跨測試 DB 污染 */
function clearPodStoreCache(): void {
  type PodStoreTestHooks = { stmtCache: Map<string, unknown> };
  (podStore as unknown as PodStoreTestHooks).stmtCache.clear();
}

function insertCanvas(): void {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO canvases (id, name, sort_index) VALUES (?, ?, ?)",
    )
    .run(CANVAS_ID, `canvas-${CANVAS_ID}`, 0);
}

/**
 * 直接用 SQL 插入 pod，繞過 sanitizeProviderConfigStrict 對 getProvider.metadata 的依賴。
 * schedule_json 設為 null 時表示未設排程；非 null 時表示已設排程。
 */
function insertPodViaSQL(opts: {
  podId?: string;
  canvasId?: string;
  commandId?: string | null;
  scheduleJson?: string | null;
  workspacePath?: string;
}): string {
  const podId = opts.podId ?? POD_ID;
  const canvasId = opts.canvasId ?? CANVAS_ID;
  const workspacePath =
    opts.workspacePath ??
    path.join(config.canvasRoot, canvasId, `pod-${podId}`);

  getDb()
    .prepare(
      `INSERT INTO pods
       (id, canvas_id, name, x, y, rotation, workspace_path,
        session_id, repository_id, command_id,
        schedule_json, provider, provider_config_json)
       VALUES (?, ?, ?, 0, 0, 0, ?, NULL, NULL, ?, ?, 'claude',
       '{"model":"opus"}')`,
    )
    .run(
      podId,
      canvasId,
      `pod-name-${podId}`,
      workspacePath,
      opts.commandId ?? null,
      opts.scheduleJson ?? null,
    );
  return podId;
}

/** 基礎排程 JSON（每秒觸發，lastTriggeredAt=null） */
const BASE_SCHEDULE_JSON = JSON.stringify({
  frequency: "every-second",
  second: 1,
  intervalMinute: 0,
  intervalHour: 0,
  hour: 0,
  minute: 0,
  weekdays: [],
  enabled: true,
  lastTriggeredAt: null,
});

// ============================================================
// Section 1：shouldFireCheckers 純函數測試（直接用真實匯出值）
// ============================================================

describe("shouldFireCheckers - every-second", () => {
  it("首次觸發：lastTriggeredAt 為 null 時回傳 true", () => {
    const schedule = makeSchedule({ frequency: "every-second", second: 1 });
    const now = new Date("2026-04-02T00:00:00Z");
    expect(shouldFireCheckers["every-second"](schedule, now, OFFSET)).toBe(
      true,
    );
  });

  it("間隔未到不觸發：距上次 0.5 秒，interval 為 1 秒", () => {
    const lastTriggeredAt = new Date("2026-04-02T00:00:00Z");
    const now = new Date(lastTriggeredAt.getTime() + 0.5 * MS_PER_SECOND);
    const schedule = makeSchedule({
      frequency: "every-second",
      second: 1,
      lastTriggeredAt,
    });
    expect(shouldFireCheckers["every-second"](schedule, now, OFFSET)).toBe(
      false,
    );
  });

  it("間隔剛好到達時觸發：距上次 1 秒，interval 為 1 秒", () => {
    const lastTriggeredAt = new Date("2026-04-02T00:00:00Z");
    const now = new Date(lastTriggeredAt.getTime() + 1 * MS_PER_SECOND);
    const schedule = makeSchedule({
      frequency: "every-second",
      second: 1,
      lastTriggeredAt,
    });
    expect(shouldFireCheckers["every-second"](schedule, now, OFFSET)).toBe(
      true,
    );
  });

  it("超過間隔時也應觸發：距上次 10 秒，interval 為 5 秒", () => {
    const lastTriggeredAt = new Date("2026-04-02T00:00:00Z");
    const now = new Date(lastTriggeredAt.getTime() + 10 * MS_PER_SECOND);
    const schedule = makeSchedule({
      frequency: "every-second",
      second: 5,
      lastTriggeredAt,
    });
    expect(shouldFireCheckers["every-second"](schedule, now, OFFSET)).toBe(
      true,
    );
  });
});

describe("shouldFireCheckers - every-x-minute", () => {
  it("首次觸發：lastTriggeredAt 為 null 時回傳 true", () => {
    const schedule = makeSchedule({
      frequency: "every-x-minute",
      intervalMinute: 5,
    });
    const now = new Date("2026-04-02T00:00:00Z");
    expect(shouldFireCheckers["every-x-minute"](schedule, now, OFFSET)).toBe(
      true,
    );
  });

  it("間隔未到不觸發：距上次 4 分鐘，interval 為 5 分鐘", () => {
    const lastTriggeredAt = new Date("2026-04-02T00:00:00Z");
    const now = new Date(lastTriggeredAt.getTime() + 4 * MS_PER_MINUTE);
    const schedule = makeSchedule({
      frequency: "every-x-minute",
      intervalMinute: 5,
      lastTriggeredAt,
    });
    expect(shouldFireCheckers["every-x-minute"](schedule, now, OFFSET)).toBe(
      false,
    );
  });

  it("間隔到達時觸發：距上次 5 分鐘，interval 為 5 分鐘", () => {
    const lastTriggeredAt = new Date("2026-04-02T00:00:00Z");
    const now = new Date(lastTriggeredAt.getTime() + 5 * MS_PER_MINUTE);
    const schedule = makeSchedule({
      frequency: "every-x-minute",
      intervalMinute: 5,
      lastTriggeredAt,
    });
    expect(shouldFireCheckers["every-x-minute"](schedule, now, OFFSET)).toBe(
      true,
    );
  });

  it("超過間隔時也應觸發：距上次 30 分鐘，interval 為 15 分鐘", () => {
    const lastTriggeredAt = new Date("2026-04-02T00:00:00Z");
    const now = new Date(lastTriggeredAt.getTime() + 30 * MS_PER_MINUTE);
    const schedule = makeSchedule({
      frequency: "every-x-minute",
      intervalMinute: 15,
      lastTriggeredAt,
    });
    expect(shouldFireCheckers["every-x-minute"](schedule, now, OFFSET)).toBe(
      true,
    );
  });
});

describe("shouldFireCheckers - every-x-hour", () => {
  it("首次觸發：lastTriggeredAt 為 null 時回傳 true", () => {
    const schedule = makeSchedule({
      frequency: "every-x-hour",
      intervalHour: 2,
    });
    const now = new Date("2026-04-02T00:00:00Z");
    expect(shouldFireCheckers["every-x-hour"](schedule, now, OFFSET)).toBe(
      true,
    );
  });

  it("間隔未到不觸發：距上次 1 小時，interval 為 2 小時", () => {
    const lastTriggeredAt = new Date("2026-04-02T00:00:00Z");
    const now = new Date(lastTriggeredAt.getTime() + 1 * MS_PER_HOUR);
    const schedule = makeSchedule({
      frequency: "every-x-hour",
      intervalHour: 2,
      lastTriggeredAt,
    });
    expect(shouldFireCheckers["every-x-hour"](schedule, now, OFFSET)).toBe(
      false,
    );
  });

  it("間隔到達時觸發：距上次 2 小時，interval 為 2 小時", () => {
    const lastTriggeredAt = new Date("2026-04-02T00:00:00Z");
    const now = new Date(lastTriggeredAt.getTime() + 2 * MS_PER_HOUR);
    const schedule = makeSchedule({
      frequency: "every-x-hour",
      intervalHour: 2,
      lastTriggeredAt,
    });
    expect(shouldFireCheckers["every-x-hour"](schedule, now, OFFSET)).toBe(
      true,
    );
  });

  it("超過間隔時也應觸發：距上次 6 小時，interval 為 3 小時", () => {
    const lastTriggeredAt = new Date("2026-04-02T00:00:00Z");
    const now = new Date(lastTriggeredAt.getTime() + 6 * MS_PER_HOUR);
    const schedule = makeSchedule({
      frequency: "every-x-hour",
      intervalHour: 3,
      lastTriggeredAt,
    });
    expect(shouldFireCheckers["every-x-hour"](schedule, now, OFFSET)).toBe(
      true,
    );
  });
});

describe("shouldFireCheckers - every-day", () => {
  it("時間符合且首次觸發：lastTriggeredAt 為 null 時回傳 true", () => {
    // offset=0，now 09:30:00Z → 符合 hour=9 minute=30
    const now = new Date("2026-04-02T09:30:00Z");
    const schedule = makeSchedule({
      frequency: "every-day",
      hour: 9,
      minute: 30,
    });
    expect(shouldFireCheckers["every-day"](schedule, now, OFFSET)).toBe(true);
  });

  it("時間符合但當天已觸發則跳過：lastTriggeredAt 為同一天稍早", () => {
    const lastTriggeredAt = new Date("2026-04-02T05:00:00Z");
    const now = new Date("2026-04-02T09:30:00Z");
    const schedule = makeSchedule({
      frequency: "every-day",
      hour: 9,
      minute: 30,
      lastTriggeredAt,
    });
    expect(shouldFireCheckers["every-day"](schedule, now, OFFSET)).toBe(false);
  });

  it("時間不符合不觸發：排程 09:30，now 為 10:00", () => {
    const now = new Date("2026-04-02T10:00:00Z");
    const schedule = makeSchedule({
      frequency: "every-day",
      hour: 9,
      minute: 30,
    });
    expect(shouldFireCheckers["every-day"](schedule, now, OFFSET)).toBe(false);
  });

  it("前一天已觸發，今天時間符合時應觸發", () => {
    const lastTriggeredAt = new Date("2026-04-01T09:30:00Z");
    const now = new Date("2026-04-02T09:30:00Z");
    const schedule = makeSchedule({
      frequency: "every-day",
      hour: 9,
      minute: 30,
      lastTriggeredAt,
    });
    expect(shouldFireCheckers["every-day"](schedule, now, OFFSET)).toBe(true);
  });

  it("秒數不為 0 時不觸發：now 秒數為 15", () => {
    const now = new Date("2026-04-02T09:30:15Z");
    const schedule = makeSchedule({
      frequency: "every-day",
      hour: 9,
      minute: 30,
    });
    expect(shouldFireCheckers["every-day"](schedule, now, OFFSET)).toBe(false);
  });

  it("跨日邊界：lastTriggeredAt 昨日 23:59，now 今日 00:00 時間符合時回傳 true", () => {
    // offset=0，排程 hour=0 minute=0，now 為今日 00:00:00
    const lastTriggeredAt = new Date("2026-04-01T23:59:00Z");
    const now = new Date("2026-04-02T00:00:00Z");
    const schedule = makeSchedule({
      frequency: "every-day",
      hour: 0,
      minute: 0,
      lastTriggeredAt,
    });
    expect(shouldFireCheckers["every-day"](schedule, now, OFFSET)).toBe(true);
  });
});

describe("shouldFireCheckers - every-week", () => {
  // 2026-04-06T09:30:00Z 是 UTC 週一，toOffsettedParts offset=0 下 day=0（ISO 慣例 0=週一）
  const MONDAY_UTC = "2026-04-06T09:30:00Z";
  const TUESDAY_UTC = "2026-04-07T09:30:00Z";

  it("星期符合、時間符合且首次觸發：lastTriggeredAt 為 null 時回傳 true", () => {
    const now = new Date(MONDAY_UTC);
    const schedule = makeSchedule({
      frequency: "every-week",
      hour: 9,
      minute: 30,
      weekdays: [0],
    });
    expect(shouldFireCheckers["every-week"](schedule, now, OFFSET)).toBe(true);
  });

  it("星期不符合不觸發：排程為週一，now 為週二", () => {
    const now = new Date(TUESDAY_UTC);
    const schedule = makeSchedule({
      frequency: "every-week",
      hour: 9,
      minute: 30,
      weekdays: [0],
    });
    expect(shouldFireCheckers["every-week"](schedule, now, OFFSET)).toBe(false);
  });

  it("星期符合但時間不符合不觸發：排程週一 09:30，now 為週一 10:00", () => {
    const now = new Date("2026-04-06T10:00:00Z");
    const schedule = makeSchedule({
      frequency: "every-week",
      hour: 9,
      minute: 30,
      weekdays: [0],
    });
    expect(shouldFireCheckers["every-week"](schedule, now, OFFSET)).toBe(false);
  });

  it("星期符合且時間符合但當天已觸發則跳過", () => {
    const lastTriggeredAt = new Date("2026-04-06T05:00:00Z");
    const now = new Date(MONDAY_UTC);
    const schedule = makeSchedule({
      frequency: "every-week",
      hour: 9,
      minute: 30,
      weekdays: [0],
      lastTriggeredAt,
    });
    expect(shouldFireCheckers["every-week"](schedule, now, OFFSET)).toBe(false);
  });

  it("上週已觸發，本週同一天時間符合應觸發", () => {
    const lastTriggeredAt = new Date("2026-03-30T09:30:00Z"); // 上週一
    const now = new Date(MONDAY_UTC); // 本週一
    const schedule = makeSchedule({
      frequency: "every-week",
      hour: 9,
      minute: 30,
      weekdays: [0],
      lastTriggeredAt,
    });
    expect(shouldFireCheckers["every-week"](schedule, now, OFFSET)).toBe(true);
  });
});

// ============================================================
// Section 2：isSameDayWithOffset 輔助函數測試
// ============================================================

describe("isSameDayWithOffset 輔助函數", () => {
  it("相同日期（UTC offset=0）應回傳 true", () => {
    const d1 = new Date("2026-02-05T10:00:00Z");
    const d2 = new Date("2026-02-05T15:30:00Z");
    expect(isSameDayWithOffset(d1, d2, 0)).toBe(true);
  });

  it("不同日期（UTC offset=0）應回傳 false", () => {
    const d1 = new Date("2026-02-05T10:00:00Z");
    const d2 = new Date("2026-02-06T10:00:00Z");
    expect(isSameDayWithOffset(d1, d2, 0)).toBe(false);
  });

  it("不同月份應回傳 false", () => {
    const d1 = new Date("2026-02-05T10:00:00Z");
    const d2 = new Date("2026-03-05T10:00:00Z");
    expect(isSameDayWithOffset(d1, d2, 0)).toBe(false);
  });

  it("不同年份應回傳 false", () => {
    const d1 = new Date("2025-02-05T10:00:00Z");
    const d2 = new Date("2026-02-05T10:00:00Z");
    expect(isSameDayWithOffset(d1, d2, 0)).toBe(false);
  });
});

// ============================================================
// Section 3：時區 offset 修正測試（shouldFireCheckers 搭配固定 offset）
// ============================================================

describe("shouldFireCheckers 時區修正 - every-day", () => {
  it("UTC 04:00 在 offset=8 時應於排程 hour=12 minute=0 觸發", () => {
    const now = new Date("2026-03-20T04:00:00Z");
    const schedule = makeSchedule({
      frequency: "every-day",
      hour: 12,
      minute: 0,
    });
    expect(shouldFireCheckers["every-day"](schedule, now, 8)).toBe(true);
  });

  it("UTC 04:00 在 offset=0 時不應於排程 hour=12 minute=0 觸發", () => {
    const now = new Date("2026-03-20T04:00:00Z");
    const schedule = makeSchedule({
      frequency: "every-day",
      hour: 12,
      minute: 0,
    });
    expect(shouldFireCheckers["every-day"](schedule, now, 0)).toBe(false);
  });

  it("UTC 16:00 在 offset=-8 時應於排程 hour=8 minute=0 觸發", () => {
    const now = new Date("2026-03-20T16:00:00Z");
    const schedule = makeSchedule({
      frequency: "every-day",
      hour: 8,
      minute: 0,
    });
    expect(shouldFireCheckers["every-day"](schedule, now, -8)).toBe(true);
  });

  it("offset=8 時 isSameDay 以使用者時區判斷（UTC 跨日但使用者時區同一天不重複觸發）", () => {
    // lastTriggered: 台北 3/20 22:00（UTC 14:00）；now: 台北 3/21 00:00（UTC 16:00）
    // 台北已是 3/21，但時間不符 (00:00 != 12:00) → false
    const lastTriggeredAt = new Date("2026-03-20T14:00:00Z");
    const now = new Date("2026-03-20T16:00:00Z");
    const schedule = makeSchedule({
      frequency: "every-day",
      hour: 12,
      minute: 0,
      lastTriggeredAt,
    });
    expect(shouldFireCheckers["every-day"](schedule, now, 8)).toBe(false);
  });

  it("offset=8 時 isSameDay：UTC 同一天但台北同一天應不重複觸發", () => {
    // lastTriggered: 台北 3/20 04:00（UTC 19:00）；now: 台北 3/20 12:00（UTC 04:00 隔日）
    const lastTriggeredAt = new Date("2026-03-19T20:00:00Z");
    const now = new Date("2026-03-20T04:00:00Z");
    const schedule = makeSchedule({
      frequency: "every-day",
      hour: 12,
      minute: 0,
      lastTriggeredAt,
    });
    expect(shouldFireCheckers["every-day"](schedule, now, 8)).toBe(false);
  });
});

describe("shouldFireCheckers 時區修正 - every-week", () => {
  it("UTC 週日 16:00 在 offset=8 時 weekday 應為 0（週一，ISO 慣例）", () => {
    // 2026-03-22T16:00:00Z 是 UTC 週日，台北時間 3/23 00:00 週一
    const now = new Date("2026-03-22T16:00:00Z");
    const schedule = makeSchedule({
      frequency: "every-week",
      hour: 0,
      minute: 0,
      weekdays: [0],
    });
    expect(shouldFireCheckers["every-week"](schedule, now, 8)).toBe(true);
  });

  it("UTC 週一 04:00 在 offset=8 時正確觸發（台北週一 12:00）", () => {
    // 2026-03-23T04:00:00Z 是 UTC 週一，台北 3/23 12:00
    const now = new Date("2026-03-23T04:00:00Z");
    const schedule = makeSchedule({
      frequency: "every-week",
      hour: 12,
      minute: 0,
      weekdays: [0],
    });
    expect(shouldFireCheckers["every-week"](schedule, now, 8)).toBe(true);
  });

  it("offset 為負值時 weekday 正確回推：UTC 週一 02:00 在 offset=-5 為週日 21:00", () => {
    // 2026-03-23T02:00:00Z UTC 週一，offset=-5 後為 3/22 週日 21:00
    const now = new Date("2026-03-23T02:00:00Z");
    const schedule = makeSchedule({
      frequency: "every-week",
      hour: 21,
      minute: 0,
      weekdays: [6],
    });
    expect(shouldFireCheckers["every-week"](schedule, now, -5)).toBe(true);
  });
});

