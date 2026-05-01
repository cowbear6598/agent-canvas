import { beforeEach, describe, expect, it } from "vitest";
import { initTestDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { messageStore } from "../../src/services/messageStore.js";

const CANVAS_ID = "canvas-1";
const POD_ID = "pod-1";

describe("MessageStore", () => {
  beforeEach(() => {
    resetStatements();
    initTestDb();
  });

  describe("addMessage", () => {
    it("成功新增訊息並回傳 ok 結果", async () => {
      const result = await messageStore.addMessage(
        CANVAS_ID,
        POD_ID,
        "user",
        "你好",
      );

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.role).toBe("user");
      expect(result.data.content).toBe("你好");
      expect(result.data.id).toBeTruthy();
      expect(result.data.timestamp).toBeTruthy();
    });

    it("新增含 subMessages 的訊息", async () => {
      const subMessages = [{ id: "sub-1", content: "工具輸出" }];
      const result = await messageStore.addMessage(
        CANVAS_ID,
        POD_ID,
        "assistant",
        "回覆",
        subMessages,
      );

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.subMessages).toEqual(subMessages);
    });

    it("新增不含 subMessages 的訊息時欄位不存在", async () => {
      const result = await messageStore.addMessage(
        CANVAS_ID,
        POD_ID,
        "user",
        "純文字",
      );

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.subMessages).toBeUndefined();
    });

    it("新增 system message 時應保留 metadata", async () => {
      const result = await messageStore.addMessage(
        CANVAS_ID,
        POD_ID,
        "system",
        "rate limit exceeded",
        undefined,
        {
          metadata: {
            provider: "claude",
            code: "RATE_LIMIT",
            severity: "error",
            rawContent: "rate limit exceeded",
          },
        },
      );

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.role).toBe("system");
      expect(result.data.metadata).toEqual({
        provider: "claude",
        code: "RATE_LIMIT",
        severity: "error",
        rawContent: "rate limit exceeded",
      });
    });
  });

  describe("getMessages", () => {
    it("無訊息時回傳空陣列", () => {
      const messages = messageStore.getMessages(POD_ID);
      expect(messages).toEqual([]);
    });

    it("依時間排序回傳該 pod 的所有訊息", async () => {
      await messageStore.addMessage(CANVAS_ID, POD_ID, "user", "第一則");
      await messageStore.addMessage(CANVAS_ID, POD_ID, "assistant", "第二則");

      const messages = messageStore.getMessages(POD_ID);

      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe("第一則");
      expect(messages[1].content).toBe("第二則");
    });

    it("只回傳指定 pod 的訊息，不混入其他 pod", async () => {
      await messageStore.addMessage(CANVAS_ID, POD_ID, "user", "屬於 pod-1");
      await messageStore.addMessage(CANVAS_ID, "pod-2", "user", "屬於 pod-2");

      const messages = messageStore.getMessages(POD_ID);

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("屬於 pod-1");
    });

    it("應能從 DB 讀回 system message metadata", async () => {
      await messageStore.addMessage(
        CANVAS_ID,
        POD_ID,
        "system",
        "auth failed",
        undefined,
        {
          metadata: {
            provider: "claude",
            code: "AUTH_ERROR",
            severity: "fatal",
            rawContent: "auth failed",
          },
        },
      );

      const messages = messageStore.getMessages(POD_ID);

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("system");
      expect(messages[0].metadata?.provider).toBe("claude");
      expect(messages[0].metadata?.code).toBe("AUTH_ERROR");
      expect(messages[0].metadata?.severity).toBe("fatal");
    });
  });

  describe("clearMessages", () => {
    it("清除指定 pod 的所有訊息", async () => {
      await messageStore.addMessage(CANVAS_ID, POD_ID, "user", "將被清除");

      messageStore.clearMessages(POD_ID);

      expect(messageStore.getMessages(POD_ID)).toHaveLength(0);
    });

    it("清除時不影響其他 pod 的訊息", async () => {
      await messageStore.addMessage(CANVAS_ID, POD_ID, "user", "將被清除");
      await messageStore.addMessage(CANVAS_ID, "pod-2", "user", "應保留");

      messageStore.clearMessages(POD_ID);

      expect(messageStore.getMessages("pod-2")).toHaveLength(1);
    });
  });

  describe("upsertMessage", () => {
    it("記憶體中無該 message 時新增", async () => {
      const addResult = await messageStore.addMessage(
        CANVAS_ID,
        POD_ID,
        "assistant",
        "原始內容",
      );
      expect(addResult.success).toBe(true);
      if (!addResult.success) return;

      const updatedMessage = { ...addResult.data, content: "更新後內容" };
      messageStore.upsertMessage(CANVAS_ID, POD_ID, updatedMessage);

      const messages = messageStore.getMessages(POD_ID);
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("更新後內容");
    });

    it("記憶體中已有該 message 時更新", () => {
      messageStore.upsertMessage(CANVAS_ID, POD_ID, {
        id: "msg-1",
        role: "assistant",
        content: "Original",
        timestamp: new Date().toISOString(),
      });

      messageStore.upsertMessage(CANVAS_ID, POD_ID, {
        id: "msg-1",
        role: "assistant",
        content: "Updated",
        timestamp: new Date().toISOString(),
      });

      const messages = messageStore.getMessages(POD_ID);
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("Updated");
    });

    it("連續呼叫最後結果正確持久化", () => {
      for (let i = 1; i <= 5; i++) {
        messageStore.upsertMessage(CANVAS_ID, POD_ID, {
          id: "msg-1",
          role: "assistant",
          content: `Content ${i}`,
          timestamp: new Date().toISOString(),
        });
      }

      const messages = messageStore.getMessages(POD_ID);
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("Content 5");
    });

    it("更新含 subMessages 的訊息", async () => {
      const addResult = await messageStore.addMessage(
        CANVAS_ID,
        POD_ID,
        "assistant",
        "原始",
      );
      expect(addResult.success).toBe(true);
      if (!addResult.success) return;

      const subMessages = [{ id: "sub-1", content: "工具結果" }];
      const updatedMessage = { ...addResult.data, subMessages };
      messageStore.upsertMessage(CANVAS_ID, POD_ID, updatedMessage);

      const messages = messageStore.getMessages(POD_ID);
      expect(messages[0].subMessages).toEqual(subMessages);
    });
  });

  // ================================================================
  // 測試案例 9 — addMessage 傳入外部 id 與不傳兩種路徑
  // ================================================================
  describe("addMessage — 外部 id 支援（案例 9）", () => {
    it("傳入外部 id 時，message 的 id 應與傳入值相同", async () => {
      const externalId = "attach-dir-uuid-123";
      const result = await messageStore.addMessage(
        CANVAS_ID,
        POD_ID,
        "user",
        "拖檔觸發訊息",
        undefined,
        { id: externalId },
      );

      expect(result.success).toBe(true);
      if (!result.success) return;
      // id 應與傳入的外部 id 一致（而非自動產生）
      expect(result.data.id).toBe(externalId);
    });

    it("未傳入外部 id 時，message 的 id 應由內部自動產生（非空字串）", async () => {
      const result = await messageStore.addMessage(
        CANVAS_ID,
        POD_ID,
        "user",
        "一般訊息",
      );

      expect(result.success).toBe(true);
      if (!result.success) return;
      // id 應為非空字串（uuid 格式）
      expect(result.data.id).toBeTruthy();
      expect(typeof result.data.id).toBe("string");
    });

    it("傳入外部 id 時，getMessages 應能以相同 id 讀回", async () => {
      const externalId = "my-custom-id-456";
      await messageStore.addMessage(
        CANVAS_ID,
        POD_ID,
        "user",
        "拖檔內容",
        undefined,
        { id: externalId },
      );

      const messages = messageStore.getMessages(POD_ID);
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe(externalId);
    });

    it("兩個訊息分別傳入不同外部 id，DB 中 id 應各自對齊", async () => {
      const id1 = "attach-1-uuid";
      const id2 = "attach-2-uuid";

      await messageStore.addMessage(
        CANVAS_ID,
        POD_ID,
        "user",
        "訊息一",
        undefined,
        { id: id1 },
      );
      await messageStore.addMessage(
        CANVAS_ID,
        POD_ID,
        "user",
        "訊息二",
        undefined,
        { id: id2 },
      );

      const messages = messageStore.getMessages(POD_ID);
      expect(messages).toHaveLength(2);
      const ids = messages.map((m) => m.id);
      expect(ids).toContain(id1);
      expect(ids).toContain(id2);
    });
  });
});
