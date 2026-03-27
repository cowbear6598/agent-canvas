import type { ScheduleConfig } from "../../src/types";
import {
  toOffsettedParts,
  isSameDayWithOffset,
} from "../../src/utils/timezoneUtils.js";

// ---- multi-instance 整合測試用的 mock ----
const mockGetAllWithSchedule = vi.fn();
const mockSetScheduleLastTriggeredAt = vi.fn();
const mockSetStatus = vi.fn();
const mockGetById = vi.fn();
const mockAddMessage = vi.fn();
const mockEmitToCanvas = vi.fn();
const mockLaunchMultiInstanceRun = vi.fn();
const mockExecuteStreamingChat = vi.fn();
const mockCheckAndTriggerWorkflows = vi.fn();
const mockGetTimezoneOffset = vi.fn();
const mockCommandList = vi.fn();

vi.mock("../../src/services/podStore.js", () => ({
  podStore: {
    getAllWithSchedule: mockGetAllWithSchedule,
    setScheduleLastTriggeredAt: mockSetScheduleLastTriggeredAt,
    setStatus: mockSetStatus,
    getById: mockGetById,
  },
}));

vi.mock("../../src/services/messageStore.js", () => ({
  messageStore: {
    addMessage: mockAddMessage,
  },
}));

vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToCanvas: mockEmitToCanvas,
  },
}));

vi.mock("../../src/utils/runChatHelpers.js", () => ({
  launchMultiInstanceRun: mockLaunchMultiInstanceRun,
}));

vi.mock("../../src/services/claude/streamingChatExecutor.js", () => ({
  executeStreamingChat: mockExecuteStreamingChat,
}));

vi.mock("../../src/services/workflow/index.js", () => ({
  workflowExecutionService: {
    checkAndTriggerWorkflows: mockCheckAndTriggerWorkflows,
  },
}));

vi.mock("../../src/services/configStore.js", () => ({
  configStore: {
    getTimezoneOffset: mockGetTimezoneOffset,
  },
}));

vi.mock("../../src/services/commandService.js", () => ({
  commandService: {
    list: mockCommandList,
  },
}));

// 測試用的內部 shouldFire 檢查函數
type ShouldFireChecker = (
  schedule: ScheduleConfig,
  now: Date,
  offset: number,
) => boolean;

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;
const SCHEDULE_TRIGGER_SECOND = 0;

// 複製 scheduleService 中的 shouldFireCheckers 邏輯用於測試
const shouldFireCheckers: Record<
  ScheduleConfig["frequency"],
  ShouldFireChecker
> = {
  "every-second": (schedule, now, _offset) => {
    if (!schedule.lastTriggeredAt) {
      return true;
    }
    const elapsedSeconds =
      (now.getTime() - schedule.lastTriggeredAt.getTime()) / MS_PER_SECOND;
    return elapsedSeconds >= schedule.second;
  },

  "every-x-minute": (schedule, now, _offset) => {
    if (!schedule.lastTriggeredAt) {
      return true;
    }
    const elapsedMinutes =
      (now.getTime() - schedule.lastTriggeredAt.getTime()) / MS_PER_MINUTE;
    return elapsedMinutes >= schedule.intervalMinute;
  },

  "every-x-hour": (schedule, now, _offset) => {
    if (!schedule.lastTriggeredAt) {
      return true;
    }
    const elapsedHours =
      (now.getTime() - schedule.lastTriggeredAt.getTime()) / MS_PER_HOUR;
    return elapsedHours >= schedule.intervalHour;
  },

  "every-day": (schedule, now, offset) => {
    const parts = toOffsettedParts(now, offset);
    if (
      parts.hours !== schedule.hour ||
      parts.minutes !== schedule.minute ||
      parts.seconds !== SCHEDULE_TRIGGER_SECOND
    ) {
      return false;
    }

    if (!schedule.lastTriggeredAt) {
      return true;
    }

    return !isSameDayWithOffset(
      new Date(schedule.lastTriggeredAt),
      now,
      offset,
    );
  },

  "every-week": (schedule, now, offset) => {
    const parts = toOffsettedParts(now, offset);

    if (!schedule.weekdays.includes(parts.day)) {
      return false;
    }

    if (
      parts.hours !== schedule.hour ||
      parts.minutes !== schedule.minute ||
      parts.seconds !== SCHEDULE_TRIGGER_SECOND
    ) {
      return false;
    }

    if (!schedule.lastTriggeredAt) {
      return true;
    }

    return !isSameDayWithOffset(
      new Date(schedule.lastTriggeredAt),
      now,
      offset,
    );
  },
};

// 使用本機時區 offset，讓 toOffsettedParts 與本地時間建立的 Date 結果一致
const LOCAL_OFFSET = -new Date().getTimezoneOffset() / 60;

function shouldFire(schedule: ScheduleConfig, now: Date): boolean {
  const checker = shouldFireCheckers[schedule.frequency];
  return checker ? checker(schedule, now, LOCAL_OFFSET) : false;
}

describe("Schedule Service", () => {
  beforeEach(() => {
    // bun:test 不支援 fake timers，使用實際時間
  });

  afterEach(() => {
    // bun:test 會自動清理 mock
  });

  describe("shouldFire - every-second", () => {
    it("在沒有 lastTriggeredAt 時應立即觸發", () => {
      const schedule: ScheduleConfig = {
        frequency: "every-second",
        second: 5,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: null,
      };

      const now = new Date("2026-02-05T12:00:00Z");
      expect(shouldFire(schedule, now)).toBe(true);
    });

    it("在經過指定秒數後應觸發", () => {
      const lastTriggered = new Date("2026-02-05T12:00:00Z");
      const schedule: ScheduleConfig = {
        frequency: "every-second",
        second: 5,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: lastTriggered,
      };

      const now = new Date(lastTriggered.getTime() + 5 * MS_PER_SECOND);
      expect(shouldFire(schedule, now)).toBe(true);
    });

    it("在未經過指定秒數時不應觸發", () => {
      const lastTriggered = new Date("2026-02-05T12:00:00Z");
      const schedule: ScheduleConfig = {
        frequency: "every-second",
        second: 10,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: lastTriggered,
      };

      const now = new Date(lastTriggered.getTime() + 5 * MS_PER_SECOND);
      expect(shouldFire(schedule, now)).toBe(false);
    });
  });

  describe("shouldFire - every-x-minute", () => {
    it("在沒有 lastTriggeredAt 時應立即觸發", () => {
      const schedule: ScheduleConfig = {
        frequency: "every-x-minute",
        second: 0,
        intervalMinute: 5,
        intervalHour: 0,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: null,
      };

      const now = new Date("2026-02-05T12:00:00Z");
      expect(shouldFire(schedule, now)).toBe(true);
    });

    it("在經過指定分鐘後應觸發", () => {
      const lastTriggered = new Date("2026-02-05T12:00:00Z");
      const schedule: ScheduleConfig = {
        frequency: "every-x-minute",
        second: 0,
        intervalMinute: 15,
        intervalHour: 0,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: lastTriggered,
      };

      const now = new Date(lastTriggered.getTime() + 15 * MS_PER_MINUTE);
      expect(shouldFire(schedule, now)).toBe(true);
    });

    it("在未經過指定分鐘時不應觸發", () => {
      const lastTriggered = new Date("2026-02-05T12:00:00Z");
      const schedule: ScheduleConfig = {
        frequency: "every-x-minute",
        second: 0,
        intervalMinute: 30,
        intervalHour: 0,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: lastTriggered,
      };

      const now = new Date(lastTriggered.getTime() + 10 * MS_PER_MINUTE);
      expect(shouldFire(schedule, now)).toBe(false);
    });
  });

  describe("shouldFire - every-x-hour", () => {
    it("在沒有 lastTriggeredAt 時應立即觸發", () => {
      const schedule: ScheduleConfig = {
        frequency: "every-x-hour",
        second: 0,
        intervalMinute: 0,
        intervalHour: 2,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: null,
      };

      const now = new Date("2026-02-05T12:00:00Z");
      expect(shouldFire(schedule, now)).toBe(true);
    });

    it("在經過指定小時後應觸發", () => {
      const lastTriggered = new Date("2026-02-05T12:00:00Z");
      const schedule: ScheduleConfig = {
        frequency: "every-x-hour",
        second: 0,
        intervalMinute: 0,
        intervalHour: 3,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: lastTriggered,
      };

      const now = new Date(lastTriggered.getTime() + 3 * MS_PER_HOUR);
      expect(shouldFire(schedule, now)).toBe(true);
    });

    it("在未經過指定小時時不應觸發", () => {
      const lastTriggered = new Date("2026-02-05T12:00:00Z");
      const schedule: ScheduleConfig = {
        frequency: "every-x-hour",
        second: 0,
        intervalMinute: 0,
        intervalHour: 6,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: lastTriggered,
      };

      const now = new Date(lastTriggered.getTime() + 3 * MS_PER_HOUR);
      expect(shouldFire(schedule, now)).toBe(false);
    });
  });

  describe("shouldFire - every-day", () => {
    it("在沒有 lastTriggeredAt 且時間匹配時應觸發", () => {
      const schedule: ScheduleConfig = {
        frequency: "every-day",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 9,
        minute: 30,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: null,
      };

      // 使用本地時間建立日期
      const now = new Date(2026, 1, 5, 9, 30, 0);
      expect(shouldFire(schedule, now)).toBe(true);
    });

    it("在每日指定時間應觸發", () => {
      // 使用本地時間建立日期
      const lastTriggered = new Date(2026, 1, 4, 9, 30, 0);
      const schedule: ScheduleConfig = {
        frequency: "every-day",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 9,
        minute: 30,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: lastTriggered,
      };

      const now = new Date(2026, 1, 5, 9, 30, 0);
      expect(shouldFire(schedule, now)).toBe(true);
    });

    it("在同一天不應重複觸發", () => {
      const lastTriggered = new Date(2026, 1, 5, 9, 30, 0);
      const schedule: ScheduleConfig = {
        frequency: "every-day",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 9,
        minute: 30,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: lastTriggered,
      };

      const now = new Date(2026, 1, 5, 9, 30, 0);
      expect(shouldFire(schedule, now)).toBe(false);
    });

    it("在時間不匹配時不應觸發", () => {
      const lastTriggered = new Date(2026, 1, 4, 9, 30, 0);
      const schedule: ScheduleConfig = {
        frequency: "every-day",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 9,
        minute: 30,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: lastTriggered,
      };

      const now = new Date(2026, 1, 5, 10, 0, 0);
      expect(shouldFire(schedule, now)).toBe(false);
    });

    it("秒數必須為 0 才會觸發", () => {
      const lastTriggered = new Date(2026, 1, 4, 9, 30, 0);
      const schedule: ScheduleConfig = {
        frequency: "every-day",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 9,
        minute: 30,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: lastTriggered,
      };

      const now = new Date(2026, 1, 5, 9, 30, 15);
      expect(shouldFire(schedule, now)).toBe(false);
    });
  });

  describe("shouldFire - every-week", () => {
    it("在沒有 lastTriggeredAt 且時間和日期匹配時應觸發", () => {
      const schedule: ScheduleConfig = {
        frequency: "every-week",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 10,
        minute: 0,
        weekdays: [0, 2, 4], // 週一、週三、週五（ISO 慣例：0=週一, 6=週日）
        enabled: true,
        lastTriggeredAt: null,
      };

      // 2026-02-09 是週一 (本地時間)
      const now = new Date(2026, 1, 9, 10, 0, 0);
      expect(shouldFire(schedule, now)).toBe(true);
    });

    it("在每週指定日期和時間應觸發", () => {
      // 上週一 (本地時間)
      const lastTriggered = new Date(2026, 1, 2, 10, 0, 0);
      const schedule: ScheduleConfig = {
        frequency: "every-week",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 10,
        minute: 0,
        weekdays: [0], // 週一（ISO 慣例）
        enabled: true,
        lastTriggeredAt: lastTriggered,
      };

      // 本週一 (本地時間)
      const now = new Date(2026, 1, 9, 10, 0, 0);
      expect(shouldFire(schedule, now)).toBe(true);
    });

    it("在不是指定的週幾時不應觸發", () => {
      const lastTriggered = new Date(2026, 1, 2, 10, 0, 0);
      const schedule: ScheduleConfig = {
        frequency: "every-week",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 10,
        minute: 0,
        weekdays: [0], // 週一（ISO 慣例）
        enabled: true,
        lastTriggeredAt: lastTriggered,
      };

      // 2026-02-10 是週二 (本地時間)
      const now = new Date(2026, 1, 10, 10, 0, 0);
      expect(shouldFire(schedule, now)).toBe(false);
    });

    it("在同一天不應重複觸發", () => {
      const lastTriggered = new Date(2026, 1, 9, 10, 0, 0);
      const schedule: ScheduleConfig = {
        frequency: "every-week",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 10,
        minute: 0,
        weekdays: [0], // 週一（ISO 慣例）
        enabled: true,
        lastTriggeredAt: lastTriggered,
      };

      const now = new Date(2026, 1, 9, 10, 0, 0);
      expect(shouldFire(schedule, now)).toBe(false);
    });

    it("在時間不匹配時不應觸發", () => {
      const lastTriggered = new Date(2026, 1, 2, 10, 0, 0);
      const schedule: ScheduleConfig = {
        frequency: "every-week",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 10,
        minute: 0,
        weekdays: [0], // 週一（ISO 慣例）
        enabled: true,
        lastTriggeredAt: lastTriggered,
      };

      // 週一但時間不對 (本地時間)
      const now = new Date(2026, 1, 9, 11, 0, 0);
      expect(shouldFire(schedule, now)).toBe(false);
    });

    it("支援多個週幾", () => {
      const lastTriggered = new Date(2026, 1, 2, 10, 0, 0);
      const schedule: ScheduleConfig = {
        frequency: "every-week",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 10,
        minute: 0,
        weekdays: [0, 2, 4], // 週一、週三、週五（ISO 慣例：0=週一, 6=週日）
        enabled: true,
        lastTriggeredAt: lastTriggered,
      };

      const monday = new Date(2026, 1, 9, 10, 0, 0);
      const wednesday = new Date(2026, 1, 11, 10, 0, 0);
      const friday = new Date(2026, 1, 13, 10, 0, 0);

      expect(shouldFire(schedule, monday)).toBe(true);
      expect(
        shouldFire({ ...schedule, lastTriggeredAt: monday }, wednesday),
      ).toBe(true);
      expect(
        shouldFire({ ...schedule, lastTriggeredAt: wednesday }, friday),
      ).toBe(true);
    });
  });

  describe("lastTriggeredAt 更新邏輯", () => {
    it("觸發後應設定 lastTriggeredAt", () => {
      // 這個測試驗證 schedule 配置中 lastTriggeredAt 會影響觸發邏輯
      const lastTriggered = new Date("2026-02-05T12:00:00Z");
      const schedule: ScheduleConfig = {
        frequency: "every-second",
        second: 5,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: lastTriggered,
      };

      // 未達到間隔時間，不應觸發
      const now = new Date(lastTriggered.getTime() + 3 * MS_PER_SECOND);
      expect(shouldFire(schedule, now)).toBe(false);

      // 達到間隔時間，應該觸發
      const later = new Date(lastTriggered.getTime() + 5 * MS_PER_SECOND);
      expect(shouldFire(schedule, later)).toBe(true);
    });
  });

  describe("isSameDayWithOffset 輔助函數", () => {
    it("相同日期（UTC offset=0）應回傳 true", () => {
      const date1 = new Date("2026-02-05T10:00:00Z");
      const date2 = new Date("2026-02-05T15:30:00Z");

      expect(isSameDayWithOffset(date1, date2, 0)).toBe(true);
    });

    it("不同日期（UTC offset=0）應回傳 false", () => {
      const date1 = new Date("2026-02-05T10:00:00Z");
      const date2 = new Date("2026-02-06T10:00:00Z");

      expect(isSameDayWithOffset(date1, date2, 0)).toBe(false);
    });

    it("不同月份應回傳 false", () => {
      const date1 = new Date("2026-02-05T10:00:00Z");
      const date2 = new Date("2026-03-05T10:00:00Z");

      expect(isSameDayWithOffset(date1, date2, 0)).toBe(false);
    });

    it("不同年份應回傳 false", () => {
      const date1 = new Date("2025-02-05T10:00:00Z");
      const date2 = new Date("2026-02-05T10:00:00Z");

      expect(isSameDayWithOffset(date1, date2, 0)).toBe(false);
    });
  });
});

// 時區修正版的 checker 函數（用於驗證時區邏輯）
function isScheduledTimeWithOffset(
  schedule: ScheduleConfig,
  now: Date,
  offset: number,
): boolean {
  const parts = toOffsettedParts(now, offset);
  return (
    parts.hours === schedule.hour &&
    parts.minutes === schedule.minute &&
    parts.seconds === SCHEDULE_TRIGGER_SECOND
  );
}

function isFirstTriggerOrNewDayWithOffset(
  schedule: ScheduleConfig,
  now: Date,
  offset: number,
): boolean {
  if (!schedule.lastTriggeredAt) return true;
  return !isSameDayWithOffset(new Date(schedule.lastTriggeredAt), now, offset);
}

function shouldFireWithOffset(
  schedule: ScheduleConfig,
  now: Date,
  offset: number,
): boolean {
  if (schedule.frequency === "every-day") {
    if (!isScheduledTimeWithOffset(schedule, now, offset)) return false;
    return isFirstTriggerOrNewDayWithOffset(schedule, now, offset);
  }
  if (schedule.frequency === "every-week") {
    const parts = toOffsettedParts(now, offset);
    if (!schedule.weekdays.includes(parts.day)) return false;
    if (!isScheduledTimeWithOffset(schedule, now, offset)) return false;
    return isFirstTriggerOrNewDayWithOffset(schedule, now, offset);
  }
  return false;
}

describe("Schedule Service 時區修正", () => {
  describe("shouldFire - every-day 時區修正", () => {
    it("UTC 04:00 在 offset=8 時應於排程 hour=12 minute=0 觸發", () => {
      const now = new Date("2026-03-20T04:00:00Z");
      const schedule: ScheduleConfig = {
        frequency: "every-day",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 12,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: null,
      };

      expect(shouldFireWithOffset(schedule, now, 8)).toBe(true);
    });

    it("UTC 04:00 在 offset=0 時不應於排程 hour=12 minute=0 觸發", () => {
      const now = new Date("2026-03-20T04:00:00Z");
      const schedule: ScheduleConfig = {
        frequency: "every-day",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 12,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: null,
      };

      expect(shouldFireWithOffset(schedule, now, 0)).toBe(false);
    });

    it("UTC 16:00 在 offset=-8 時應於排程 hour=8 minute=0 觸發", () => {
      const now = new Date("2026-03-20T16:00:00Z");
      const schedule: ScheduleConfig = {
        frequency: "every-day",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 8,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: null,
      };

      expect(shouldFireWithOffset(schedule, now, -8)).toBe(true);
    });

    it("offset=8 時 isSameDay 以使用者時區判斷（UTC 跨日但使用者時區同一天不重複觸發）", () => {
      // lastTriggered: 台北 3/20 22:00，now: 台北 3/21 00:00（UTC 16:00）
      const lastTriggeredAt = new Date("2026-03-20T14:00:00Z"); // 台北 3/20 22:00
      const now = new Date("2026-03-20T16:00:00Z"); // 台北 3/21 00:00
      const schedule: ScheduleConfig = {
        frequency: "every-day",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 12,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt,
      };

      // 台北已是 3/21，但時間不符 (00:00 != 12:00) → false
      expect(shouldFireWithOffset(schedule, now, 8)).toBe(false);
    });

    it("offset=8 時 isSameDay 以使用者時區判斷（UTC 同一天但使用者時區同一天應不重複觸發）", () => {
      // lastTriggered: 台北 3/20 04:00，now: 台北 3/20 12:00（UTC 04:00）
      const lastTriggeredAt = new Date("2026-03-19T20:00:00Z"); // 台北 3/20 04:00
      const now = new Date("2026-03-20T04:00:00Z"); // 台北 3/20 12:00
      const schedule: ScheduleConfig = {
        frequency: "every-day",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 12,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt,
      };

      // 台北同一天（3/20），isSameDayWithOffset 回傳 true → 不重複觸發
      expect(shouldFireWithOffset(schedule, now, 8)).toBe(false);
    });
  });

  describe("shouldFire - every-week 時區修正", () => {
    it("UTC 週日 16:00 在 offset=8 時 weekday 應為 0（週一，ISO 慣例）", () => {
      // 2026-03-22T16:00:00Z 是 UTC 週日，台北時間 2026-03-23T00:00 週一
      const now = new Date("2026-03-22T16:00:00Z");
      const schedule: ScheduleConfig = {
        frequency: "every-week",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 0,
        minute: 0,
        weekdays: [0], // 週一（ISO 慣例）
        enabled: true,
        lastTriggeredAt: null,
      };

      expect(shouldFireWithOffset(schedule, now, 8)).toBe(true);
    });

    it("UTC 04:00 週一在 offset=8 時正確觸發", () => {
      // 2026-03-23T04:00:00Z 是 UTC 週一，台北 3/23 12:00
      const now = new Date("2026-03-23T04:00:00Z");
      const schedule: ScheduleConfig = {
        frequency: "every-week",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 12,
        minute: 0,
        weekdays: [0], // 週一（ISO 慣例）
        enabled: true,
        lastTriggeredAt: null,
      };

      expect(shouldFireWithOffset(schedule, now, 8)).toBe(true);
    });

    it("offset 為負值時 weekday 正確回推", () => {
      // 2026-03-23T02:00:00Z 是 UTC 週一，offset=-5 後為 3/22 週日 21:00
      const now = new Date("2026-03-23T02:00:00Z");
      const schedule: ScheduleConfig = {
        frequency: "every-week",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 21,
        minute: 0,
        weekdays: [6], // 週日（ISO 慣例）
        enabled: true,
        lastTriggeredAt: null,
      };

      expect(shouldFireWithOffset(schedule, now, -5)).toBe(true);
    });
  });
});

// ---- 排程觸發 multi-instance 分支整合測試 ----
describe("排程觸發 multi-instance 分支", () => {
  const CANVAS_ID = "canvas-1";
  const POD_ID = "pod-1";

  const baseSchedule: ScheduleConfig = {
    frequency: "every-second",
    second: 1,
    intervalMinute: 0,
    intervalHour: 0,
    hour: 0,
    minute: 0,
    weekdays: [],
    enabled: true,
    lastTriggeredAt: null,
  };

  const basePod = {
    id: POD_ID,
    name: "Test Pod",
    status: "idle" as const,
    x: 0,
    y: 0,
    rotation: 0,
    model: "opus" as const,
    workspacePath: "/tmp",
    claudeSessionId: null,
    outputStyleId: null,
    repositoryId: null,
    commandId: null,
    multiInstance: false,
    skillIds: [],
    subAgentIds: [],
    mcpServerIds: [],
    schedule: baseSchedule,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetTimezoneOffset.mockReturnValue(0);
    mockLaunchMultiInstanceRun.mockResolvedValue({
      runId: "run-1",
      canvasId: CANVAS_ID,
      sourcePodId: POD_ID,
    });
    mockExecuteStreamingChat.mockResolvedValue(undefined);
    mockAddMessage.mockResolvedValue(undefined);
    mockCheckAndTriggerWorkflows.mockResolvedValue(undefined);
    mockCommandList.mockResolvedValue([]);

    // 重新 import scheduleService 以套用 mock
    vi.resetModules();
  });

  it("multiInstance Pod 排程觸發時應呼叫 launchMultiInstanceRun（無 command 時 displayMessage 為空字串）", async () => {
    const multiInstancePod = { ...basePod, multiInstance: true };
    mockGetAllWithSchedule.mockReturnValue([
      { canvasId: CANVAS_ID, pod: multiInstancePod },
    ]);
    mockCommandList.mockResolvedValue([]);

    const { scheduleService } =
      await import("../../src/services/scheduleService.js");
    await (scheduleService as any).fireSchedule(
      CANVAS_ID,
      multiInstancePod,
      new Date(),
    );

    expect(mockLaunchMultiInstanceRun).toHaveBeenCalledWith(
      expect.objectContaining({
        canvasId: CANVAS_ID,
        podId: POD_ID,
        message: "",
        displayMessage: "",
        abortable: false,
      }),
    );
    expect(mockExecuteStreamingChat).not.toHaveBeenCalled();
    expect(mockSetStatus).not.toHaveBeenCalled();
    expect(mockSetScheduleLastTriggeredAt).toHaveBeenCalledWith(
      CANVAS_ID,
      POD_ID,
      expect.any(Date),
    );
    expect(mockEmitToCanvas).toHaveBeenCalled();
  });

  it("multiInstance Pod 有 commandId 時 displayMessage 應帶 /commandName", async () => {
    const COMMAND_ID = "cmd-1";
    const multiInstancePod = {
      ...basePod,
      multiInstance: true,
      commandId: COMMAND_ID,
    };
    mockGetAllWithSchedule.mockReturnValue([
      { canvasId: CANVAS_ID, pod: multiInstancePod },
    ]);
    mockCommandList.mockResolvedValue([
      { id: COMMAND_ID, name: "my-command", groupId: null },
    ]);

    const { scheduleService } =
      await import("../../src/services/scheduleService.js");
    await (scheduleService as any).fireSchedule(
      CANVAS_ID,
      multiInstancePod,
      new Date(),
    );

    expect(mockLaunchMultiInstanceRun).toHaveBeenCalledWith(
      expect.objectContaining({
        canvasId: CANVAS_ID,
        podId: POD_ID,
        message: "",
        displayMessage: "/my-command ",
        abortable: false,
      }),
    );
  });

  it("有 commandId 但 command 已被刪除時 displayMessage 應為空字串", async () => {
    const multiInstancePod = {
      ...basePod,
      multiInstance: true,
      commandId: "deleted-cmd",
    };
    mockGetAllWithSchedule.mockReturnValue([
      { canvasId: CANVAS_ID, pod: multiInstancePod },
    ]);
    mockCommandList.mockResolvedValue([]);

    const { scheduleService } =
      await import("../../src/services/scheduleService.js");
    await (scheduleService as any).fireSchedule(
      CANVAS_ID,
      multiInstancePod,
      new Date(),
    );

    expect(mockLaunchMultiInstanceRun).toHaveBeenCalledWith(
      expect.objectContaining({
        canvasId: CANVAS_ID,
        podId: POD_ID,
        displayMessage: "",
      }),
    );
  });

  it("非 multiInstance Pod 排程觸發時應走一般模式", async () => {
    const normalPod = { ...basePod, multiInstance: false };
    mockGetAllWithSchedule.mockReturnValue([
      { canvasId: CANVAS_ID, pod: normalPod },
    ]);

    const { scheduleService } =
      await import("../../src/services/scheduleService.js");
    await (scheduleService as any).fireSchedule(
      CANVAS_ID,
      normalPod,
      new Date(),
    );

    expect(mockExecuteStreamingChat).toHaveBeenCalled();
    expect(mockLaunchMultiInstanceRun).not.toHaveBeenCalled();
    expect(mockSetStatus).toHaveBeenCalledWith(CANVAS_ID, POD_ID, "chatting");
    expect(mockSetScheduleLastTriggeredAt).toHaveBeenCalledWith(
      CANVAS_ID,
      POD_ID,
      expect.any(Date),
    );
    expect(mockEmitToCanvas).toHaveBeenCalled();
  });
});
