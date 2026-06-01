import { v4 as uuidv4 } from "uuid";
import { emitAndWaitResponse, setupIntegrationTest } from "../setup";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "../../src/schemas";
import type {
  ConfigGetPayload,
  ConfigGetResultPayload,
  ConfigUpdatePayload,
  ConfigUpdatedPayload,
} from "../../src/schemas";

describe("Config WebSocket", () => {
  const { getClient } = setupIntegrationTest();

  describe("config:get", () => {
    it("成功取得預設設定值", async () => {
      const client = getClient();
      const response = await emitAndWaitResponse<
        ConfigGetPayload,
        ConfigGetResultPayload
      >(
        client,
        WebSocketRequestEvents.CONFIG_GET,
        WebSocketResponseEvents.CONFIG_GET_RESULT,
        { requestId: uuidv4() },
      );

      expect(response.success).toBe(true);
    });

    it("回傳正確的 payload 結構", async () => {
      const client = getClient();
      const requestId = uuidv4();
      const response = await emitAndWaitResponse<
        ConfigGetPayload,
        ConfigGetResultPayload
      >(
        client,
        WebSocketRequestEvents.CONFIG_GET,
        WebSocketResponseEvents.CONFIG_GET_RESULT,
        { requestId },
      );

      expect(response.requestId).toBe(requestId);
      expect(response.success).toBe(true);
      expect(response.timezoneOffset).toBe(8);
    });
  });

  describe("config:update", () => {
    it("空 payload 回傳驗證錯誤", async () => {
      const client = getClient();
      const response = await emitAndWaitResponse<any, ConfigUpdatedPayload>(
        client,
        WebSocketRequestEvents.CONFIG_UPDATE,
        WebSocketResponseEvents.CONFIG_UPDATED,
        { requestId: uuidv4() },
      );

      expect(response.success).toBe(false);
    });

    it("memory 設定可成功更新並由 config:get 讀回", async () => {
      const client = getClient();

      const updateResponse = await emitAndWaitResponse<
        ConfigUpdatePayload,
        ConfigUpdatedPayload
      >(
        client,
        WebSocketRequestEvents.CONFIG_UPDATE,
        WebSocketResponseEvents.CONFIG_UPDATED,
        {
          requestId: uuidv4(),
          memoryProvider: "codex",
          memoryModel: "gpt-5.4",
          memoryThinkingLevel: "high",
        },
      );

      expect(updateResponse.success).toBe(true);
      expect(updateResponse.memoryProvider).toBe("codex");
      expect(updateResponse.memoryModel).toBe("gpt-5.4");
      expect(updateResponse.memoryThinkingLevel).toBeNull();

      const getResponse = await emitAndWaitResponse<
        ConfigGetPayload,
        ConfigGetResultPayload
      >(
        client,
        WebSocketRequestEvents.CONFIG_GET,
        WebSocketResponseEvents.CONFIG_GET_RESULT,
        { requestId: uuidv4() },
      );

      expect(getResponse.success).toBe(true);
      expect(getResponse.memoryProvider).toBe("codex");
      expect(getResponse.memoryModel).toBe("gpt-5.4");
      expect(getResponse.memoryThinkingLevel).toBeNull();
    });
  });

  describe("config timezoneOffset", () => {
    it("config:get 回傳 timezoneOffset 預設值 8", async () => {
      const client = getClient();
      const response = await emitAndWaitResponse<
        ConfigGetPayload,
        ConfigGetResultPayload
      >(
        client,
        WebSocketRequestEvents.CONFIG_GET,
        WebSocketResponseEvents.CONFIG_GET_RESULT,
        { requestId: uuidv4() },
      );

      expect(response.timezoneOffset).toBe(8);
    });

    it("config:update 成功更新 timezoneOffset", async () => {
      const client = getClient();
      const response = await emitAndWaitResponse<any, ConfigUpdatedPayload>(
        client,
        WebSocketRequestEvents.CONFIG_UPDATE,
        WebSocketResponseEvents.CONFIG_UPDATED,
        { requestId: uuidv4(), timezoneOffset: -5 },
      );

      expect(response.success).toBe(true);
      expect(response.timezoneOffset).toBe(-5);
    });

    it("config:update timezoneOffset 超出範圍（> 14）回傳驗證錯誤", async () => {
      const client = getClient();
      const response = await emitAndWaitResponse<any, ConfigUpdatedPayload>(
        client,
        WebSocketRequestEvents.CONFIG_UPDATE,
        WebSocketResponseEvents.CONFIG_UPDATED,
        { requestId: uuidv4(), timezoneOffset: 15 },
      );

      expect(response.success).toBe(false);
    });

    it("config:update timezoneOffset 非整數回傳驗證錯誤", async () => {
      const client = getClient();
      const response = await emitAndWaitResponse<any, ConfigUpdatedPayload>(
        client,
        WebSocketRequestEvents.CONFIG_UPDATE,
        WebSocketResponseEvents.CONFIG_UPDATED,
        { requestId: uuidv4(), timezoneOffset: 5.5 },
      );

      expect(response.success).toBe(false);
    });

    it("更新 timezoneOffset 後 config:get 能讀取到新值", async () => {
      const client = getClient();

      await emitAndWaitResponse<any, ConfigUpdatedPayload>(
        client,
        WebSocketRequestEvents.CONFIG_UPDATE,
        WebSocketResponseEvents.CONFIG_UPDATED,
        { requestId: uuidv4(), timezoneOffset: 3 },
      );

      const getResponse = await emitAndWaitResponse<
        ConfigGetPayload,
        ConfigGetResultPayload
      >(
        client,
        WebSocketRequestEvents.CONFIG_GET,
        WebSocketResponseEvents.CONFIG_GET_RESULT,
        { requestId: uuidv4() },
      );

      expect(getResponse.timezoneOffset).toBe(3);
    });
  });
});
