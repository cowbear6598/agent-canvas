/**
 * chatSendSchema 單元測試
 *
 * 覆蓋以下測試案例：
 * 1 - chatSendSchema 純文字訊息基本驗證（含空字串防禦）
 * 2 - chatSendSchema uploadSessionId 存在時允許空字串 message
 */

import { describe, expect, it } from "vitest";
import { chatSendSchema } from "../../src/schemas/chatSchemas.js";

/** 合法的 UUID，用於滿足 schema UUID 格式驗證 */
const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

/** 最基本合法的 chatSendSchema payload 骨架（無 uploadSessionId） */
function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    requestId: VALID_UUID,
    canvasId: VALID_UUID,
    podId: VALID_UUID,
    message: "測試訊息",
    ...overrides,
  };
}

// ================================================================
// 測試案例 1 — chatSendSchema 基本驗證
// ================================================================
describe("chatSendSchema — 基本驗證（案例 1）", () => {
  it("合法 message 應通過驗證", () => {
    const result = chatSendSchema.safeParse(makePayload());
    expect(result.success).toBe(true);
  });

  it("message 為空字串且無 uploadSessionId 時應被拒絕", () => {
    const result = chatSendSchema.safeParse(makePayload({ message: "" }));
    expect(result.success).toBe(false);
  });

  it("message 為純空白且無 uploadSessionId 時應被拒絕", () => {
    const result = chatSendSchema.safeParse(makePayload({ message: "   " }));
    expect(result.success).toBe(false);
  });

  it("message 超過 10000 字時應被拒絕", () => {
    const result = chatSendSchema.safeParse(
      makePayload({ message: "x".repeat(10001) }),
    );
    expect(result.success).toBe(false);
  });
});

// ================================================================
// 測試案例 2 — uploadSessionId 存在時允許空字串 message
// ================================================================
describe("chatSendSchema — uploadSessionId 存在時（案例 2）", () => {
  it("uploadSessionId 為合法 UUID 且 message 為空字串時應通過", () => {
    const result = chatSendSchema.safeParse(
      makePayload({ message: "", uploadSessionId: VALID_UUID }),
    );
    expect(result.success).toBe(true);
  });

  it("uploadSessionId 格式不合法時應被拒絕", () => {
    const result = chatSendSchema.safeParse(
      makePayload({ message: "", uploadSessionId: "not-a-uuid" }),
    );
    expect(result.success).toBe(false);
  });

  it("uploadSessionId 為合法 UUID 且 message 有內容時也應通過", () => {
    const result = chatSendSchema.safeParse(
      makePayload({ message: "附帶說明", uploadSessionId: VALID_UUID }),
    );
    expect(result.success).toBe(true);
  });
});
