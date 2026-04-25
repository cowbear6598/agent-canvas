import { describe, it, expect } from "vitest";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "../../src/schemas/events.js";

describe("WebSocket events schema-level 配對驗證", () => {
  it("PROVIDER_LIST request 與 PROVIDER_LIST_RESULT response 成對存在", () => {
    expect(WebSocketRequestEvents.PROVIDER_LIST).toBeDefined();
    expect(WebSocketResponseEvents.PROVIDER_LIST_RESULT).toBeDefined();
    // value 符合命名慣例
    expect(WebSocketRequestEvents.PROVIDER_LIST).toBe("provider:list");
    expect(WebSocketResponseEvents.PROVIDER_LIST_RESULT).toBe(
      "provider:list:result",
    );
  });

  it("所有以 :list:result 結尾的 response 對應 :list request 存在", () => {
    const requestValues = new Set(Object.values(WebSocketRequestEvents));
    const responseEntries = Object.entries(WebSocketResponseEvents);

    // 只檢查 value 以 :list:result 結尾的 response（慣例最一致的 pattern）
    const listResultResponses = responseEntries.filter(([, value]) =>
      value.endsWith(":list:result"),
    );

    const unmatched: string[] = [];
    for (const [key, value] of listResultResponses) {
      // 去除 ":result" 後綴得到對應的 request value
      const expectedRequestValue = value.replace(/:result$/, "");
      if (!requestValues.has(expectedRequestValue as WebSocketRequestEvents)) {
        unmatched.push(
          `response ${key}=${value} 找不到對應 request ${expectedRequestValue}`,
        );
      }
    }

    expect(unmatched).toEqual([]);
  });

  it("REQUEST 與 RESPONSE enum 的值不應互相重疊", () => {
    const requestValues = new Set(Object.values(WebSocketRequestEvents));
    const responseValues = Object.values(WebSocketResponseEvents);
    const overlapping = responseValues.filter((v) =>
      requestValues.has(v as WebSocketRequestEvents),
    );
    expect(overlapping).toEqual([]);
  });

  it("REQUEST enum 中所有 value 應為字串且不為空", () => {
    for (const [key, value] of Object.entries(WebSocketRequestEvents)) {
      expect(typeof value, `${key} 應為字串`).toBe("string");
      expect(value.length, `${key} 不應為空`).toBeGreaterThan(0);
    }
  });

  it("RESPONSE enum 中所有 value 應為字串且不為空", () => {
    for (const [key, value] of Object.entries(WebSocketResponseEvents)) {
      expect(typeof value, `${key} 應為字串`).toBe("string");
      expect(value.length, `${key} 不應為空`).toBeGreaterThan(0);
    }
  });
});
