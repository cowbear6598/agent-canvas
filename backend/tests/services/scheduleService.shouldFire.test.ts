import { vi, describe, it, expect } from "vitest";
import type { ScheduleConfig } from "../../src/types/index.js";

// mock 所有 scheduleService 的相依模組，避免測試觸碰真實服務
vi.mock("../../src/services/podStore.js", () => ({
  podStore: {
    getAllWithSchedule: vi.fn(),
    setScheduleLastTriggeredAt: vi.fn(),
    setStatus: vi.fn(),
    getById: vi.fn(),
  },
}));

vi.mock("../../src/services/messageStore.js", () => ({
  messageStore: { addMessage: vi.fn() },
}));

vi.mock("../../src/services/socketService.js", () => ({
  socketService: { emitToCanvas: vi.fn() },
}));

vi.mock("../../src/services/workflow/index.js", () => ({
  workflowExecutionService: { checkAndTriggerWorkflows: vi.fn() },
}));

vi.mock("../../src/services/configStore.js", () => ({
  configStore: { getTimezoneOffset: vi.fn().mockReturnValue(0) },
}));

vi.mock("../../src/services/commandService.js", () => ({
  commandService: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../../src/utils/runChatHelpers.js", () => ({
  launchMultiInstanceRun: vi.fn(),
}));

vi.mock("../../src/services/claude/streamingChatExecutor.js", () => ({
  executeStreamingChat: vi.fn(),
}));

vi.mock("../../src/utils/chatCallbacks.js", () => ({
  onRunChatComplete: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { log: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/utils/operationHelpers.js", () => ({
  fireAndForget: vi.fn(),
}));

vi.mock("../../src/services/normalExecutionStrategy.js", () => ({
  NormalModeExecutionStrategy: vi.fn().mockImplementation(() => ({})),
}));

const { shouldFireCheckers } =
  await import("../../src/services/scheduleService.js");

// UTC offset=0 用於所有測試，確保測試結果與時區無關
const OFFSET = 0;

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * 1000;

// 基礎排程設定工廠
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

describe("shouldFireCheckers - every-second", () => {
  it("首次觸發：lastTriggeredAt 為 null 時回傳 true", () => {
    const schedule = makeSchedule({
      frequency: "every-second",
      second: 1,
      lastTriggeredAt: null,
    });
    const now = new Date("2026-04-02T00:00:00Z");
    expect(shouldFireCheckers["every-second"](schedule, now, OFFSET)).toBe(
      true,
    );
  });

  it("間隔未到不觸發：lastTriggeredAt 距現在 0.5 秒，interval 為 1 秒", () => {
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

  it("間隔剛好到達時觸發：lastTriggeredAt 距現在 1 秒，interval 為 1 秒", () => {
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
});

describe("shouldFireCheckers - every-x-minute", () => {
  it("首次觸發：lastTriggeredAt 為 null 時回傳 true", () => {
    const schedule = makeSchedule({
      frequency: "every-x-minute",
      intervalMinute: 5,
      lastTriggeredAt: null,
    });
    const now = new Date("2026-04-02T00:00:00Z");
    expect(shouldFireCheckers["every-x-minute"](schedule, now, OFFSET)).toBe(
      true,
    );
  });

  it("間隔未到不觸發：lastTriggeredAt 距現在 4 分鐘，interval 為 5 分鐘", () => {
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

  it("間隔到達時觸發：lastTriggeredAt 距現在 5 分鐘，interval 為 5 分鐘", () => {
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
});

describe("shouldFireCheckers - every-x-hour", () => {
  it("首次觸發：lastTriggeredAt 為 null 時回傳 true", () => {
    const schedule = makeSchedule({
      frequency: "every-x-hour",
      intervalHour: 2,
      lastTriggeredAt: null,
    });
    const now = new Date("2026-04-02T00:00:00Z");
    expect(shouldFireCheckers["every-x-hour"](schedule, now, OFFSET)).toBe(
      true,
    );
  });

  it("間隔未到不觸發：lastTriggeredAt 距現在 1 小時，interval 為 2 小時", () => {
    const MS_PER_HOUR = 60 * 60 * 1000;
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

  it("間隔到達時觸發：lastTriggeredAt 距現在 2 小時，interval 為 2 小時", () => {
    const MS_PER_HOUR = 60 * 60 * 1000;
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
});

describe("shouldFireCheckers - every-day", () => {
  it("時間符合且首次觸發：lastTriggeredAt 為 null 時回傳 true", () => {
    // UTC offset=0，now 為 09:30:00 → 符合 hour=9 minute=30
    const now = new Date("2026-04-02T09:30:00Z");
    const schedule = makeSchedule({
      frequency: "every-day",
      hour: 9,
      minute: 30,
      lastTriggeredAt: null,
    });
    expect(shouldFireCheckers["every-day"](schedule, now, OFFSET)).toBe(true);
  });

  it("時間符合但當天已觸發則跳過：lastTriggeredAt 為同一天稍早", () => {
    // 同一天（2026-04-02）稍早已觸發
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

  it("時間不符合不觸發：排程時間與 now 不符", () => {
    // now 為 10:00:00，排程為 09:30 → 不應觸發
    const now = new Date("2026-04-02T10:00:00Z");
    const schedule = makeSchedule({
      frequency: "every-day",
      hour: 9,
      minute: 30,
      lastTriggeredAt: null,
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

  it("秒數不為 0 時不觸發：now 的秒數為 15", () => {
    const now = new Date("2026-04-02T09:30:15Z");
    const schedule = makeSchedule({
      frequency: "every-day",
      hour: 9,
      minute: 30,
      lastTriggeredAt: null,
    });
    expect(shouldFireCheckers["every-day"](schedule, now, OFFSET)).toBe(false);
  });

  it("跨日邊界：lastTriggeredAt 為昨日 23:59，now 為今日 00:00，時間符合時回傳 true", () => {
    // offset=0，排程設定 hour=0 minute=0，now 為今日 00:00:00
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
  // 2026-04-06 是 UTC 週一，offset=0 下 day = (1 + 6) % 7 = 0（ISO 慣例 0=週一）
  const MONDAY_UTC = "2026-04-06T09:30:00Z";
  // 2026-04-07 是 UTC 週二
  const TUESDAY_UTC = "2026-04-07T09:30:00Z";

  it("星期符合且時間符合且首次觸發：lastTriggeredAt 為 null 時回傳 true", () => {
    const now = new Date(MONDAY_UTC);
    const schedule = makeSchedule({
      frequency: "every-week",
      hour: 9,
      minute: 30,
      weekdays: [0], // 週一（ISO 慣例）
      lastTriggeredAt: null,
    });
    expect(shouldFireCheckers["every-week"](schedule, now, OFFSET)).toBe(true);
  });

  it("星期不符合不觸發：排程為週一，now 為週二", () => {
    const now = new Date(TUESDAY_UTC);
    const schedule = makeSchedule({
      frequency: "every-week",
      hour: 9,
      minute: 30,
      weekdays: [0], // 只允許週一
      lastTriggeredAt: null,
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
      lastTriggeredAt: null,
    });
    expect(shouldFireCheckers["every-week"](schedule, now, OFFSET)).toBe(false);
  });

  it("星期符合且時間符合但當天已觸發則跳過", () => {
    const lastTriggeredAt = new Date("2026-04-06T05:00:00Z"); // 同一天稍早
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
