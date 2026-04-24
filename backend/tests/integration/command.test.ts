import { v4 as uuidv4 } from "uuid";
import {
  emitAndWaitResponse,
  setupIntegrationTest,
  waitForEvent,
  createTestServer,
  closeTestServer,
  createSocketClient,
  disconnectSocket,
  type TestServerInstance,
  type TestWebSocketClient,
} from "../setup";
import {
  createPod,
  createCommand,
  getCanvasId,
  FAKE_UUID,
  FAKE_COMMAND_ID,
  describeCRUDTests,
  describeNoteCRUDTests,
  describePodBindingTests,
  createCommandNote,
} from "../helpers";
import { podStore } from "../../src/services/podStore.js";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
  type PodBindCommandPayload,
  type PodUnbindCommandPayload,
  type ChatSendPayload,
  type PodSetMultiInstancePayload,
} from "../../src/schemas";
import {
  type PodCommandBoundPayload,
  type PodCommandUnboundPayload,
  type PodErrorPayload,
  type PodChatCompletePayload,
  type PodMultiInstanceSetPayload,
} from "../../src/types";
import { messageStore } from "../../src/services/messageStore.js";

describe("Command 管理", () => {
  const { getClient, getServer } = setupIntegrationTest();

  const getContext = () => ({ client: getClient(), server: getServer() });

  async function makeCommand(client: any, name?: string) {
    return createCommand(
      client,
      name ?? `cmd-${uuidv4()}`,
      "# Command Content",
    );
  }

  describeCRUDTests(
    {
      resourceName: "Command",
      createResource: (client, name) => makeCommand(client, name),
      fakeResourceId: FAKE_COMMAND_ID,
      events: {
        create: {
          request: WebSocketRequestEvents.COMMAND_CREATE,
          response: WebSocketResponseEvents.COMMAND_CREATED,
        },
        list: {
          request: WebSocketRequestEvents.COMMAND_LIST,
          response: WebSocketResponseEvents.COMMAND_LIST_RESULT,
        },
        read: {
          request: WebSocketRequestEvents.COMMAND_READ,
          response: WebSocketResponseEvents.COMMAND_READ_RESULT,
        },
        update: {
          request: WebSocketRequestEvents.COMMAND_UPDATE,
          response: WebSocketResponseEvents.COMMAND_UPDATED,
        },
        delete: {
          request: WebSocketRequestEvents.COMMAND_DELETE,
          response: WebSocketResponseEvents.COMMAND_DELETED,
        },
      },
      payloadBuilders: {
        create: (canvasId, name) => ({
          canvasId,
          name,
          content: "# Command Content",
        }),
        list: (canvasId) => ({ canvasId }),
        read: (canvasId, commandId) => ({ canvasId, commandId }),
        update: (canvasId, commandId) => ({
          canvasId,
          commandId,
          content: "# Updated",
        }),
        delete: (canvasId, commandId) => ({ canvasId, commandId }),
      },
      responseFieldName: {
        list: "commands",
        read: "command",
      },
      bindForDeleteTest: {
        bindEvent: {
          request: WebSocketRequestEvents.POD_BIND_COMMAND,
          response: WebSocketResponseEvents.POD_COMMAND_BOUND,
        },
        buildPayload: (canvasId, podId, commandId) => ({
          canvasId,
          podId,
          commandId,
        }),
      },
      invalidNames: [
        { name: "測試指令", desc: "中文名稱" },
        { name: "my command!", desc: "特殊字元" },
      ],
      hasContentValidation: true,
    },
    getContext,
  );

  describeNoteCRUDTests(
    {
      resourceName: "Command",
      createParentResource: (client) => makeCommand(client),
      createNote: createCommandNote,
      events: {
        list: {
          request: WebSocketRequestEvents.COMMAND_NOTE_LIST,
          response: WebSocketResponseEvents.COMMAND_NOTE_LIST_RESULT,
        },
        update: {
          request: WebSocketRequestEvents.COMMAND_NOTE_UPDATE,
          response: WebSocketResponseEvents.COMMAND_NOTE_UPDATED,
        },
        delete: {
          request: WebSocketRequestEvents.COMMAND_NOTE_DELETE,
          response: WebSocketResponseEvents.COMMAND_NOTE_DELETED,
        },
      },
      parentIdFieldName: "commandId",
    },
    getContext,
  );

  describePodBindingTests(
    {
      resourceName: "Command",
      createResource: (client) => makeCommand(client),
      fakeResourceId: FAKE_COMMAND_ID,
      bindEvent: {
        request: WebSocketRequestEvents.POD_BIND_COMMAND,
        response: WebSocketResponseEvents.POD_COMMAND_BOUND,
      },
      buildBindPayload: (canvasId, podId, commandId) => ({
        canvasId,
        podId,
        commandId,
      }),
      verifyBoundResponse: (response, commandId) =>
        expect(response.pod.commandId).toBe(commandId),
    },
    getContext,
  );

  describe("Pod 綁定 Command - Command 特有測試", () => {
    it("Pod 已有 Command 時綁定失敗", async () => {
      const client = getClient();
      const pod = await createPod(client);
      const cmd1 = await makeCommand(client);
      const cmd2 = await makeCommand(client);

      const canvasId = await getCanvasId(client);
      await emitAndWaitResponse<PodBindCommandPayload, PodCommandBoundPayload>(
        client,
        WebSocketRequestEvents.POD_BIND_COMMAND,
        WebSocketResponseEvents.POD_COMMAND_BOUND,
        { requestId: uuidv4(), canvasId, podId: pod.id, commandId: cmd1.id },
      );

      const response = await emitAndWaitResponse<
        PodBindCommandPayload,
        PodCommandBoundPayload
      >(
        client,
        WebSocketRequestEvents.POD_BIND_COMMAND,
        WebSocketResponseEvents.POD_COMMAND_BOUND,
        { requestId: uuidv4(), canvasId, podId: pod.id, commandId: cmd2.id },
      );

      expect(response.success).toBe(false);
    });

    it("綁定 Command 後 SQLite 立即持久化", async () => {
      const client = getClient();
      const pod = await createPod(client);
      const cmd = await makeCommand(client);

      const canvasId = await getCanvasId(client);
      await emitAndWaitResponse<PodBindCommandPayload, PodCommandBoundPayload>(
        client,
        WebSocketRequestEvents.POD_BIND_COMMAND,
        WebSocketResponseEvents.POD_COMMAND_BOUND,
        { requestId: uuidv4(), canvasId, podId: pod.id, commandId: cmd.id },
      );

      const reloadedPod = podStore.getById(canvasId, pod.id);
      expect(reloadedPod).toBeDefined();
      expect(reloadedPod!.commandId).toBe(cmd.id);
    });
  });

  describe("Pod 解除綁定 Command - Command 特有測試", () => {
    it("成功解除綁定 Command", async () => {
      const client = getClient();
      const pod = await createPod(client);
      const cmd = await makeCommand(client);

      const canvasId = await getCanvasId(client);
      await emitAndWaitResponse<PodBindCommandPayload, PodCommandBoundPayload>(
        client,
        WebSocketRequestEvents.POD_BIND_COMMAND,
        WebSocketResponseEvents.POD_COMMAND_BOUND,
        { requestId: uuidv4(), canvasId, podId: pod.id, commandId: cmd.id },
      );

      const response = await emitAndWaitResponse<
        PodUnbindCommandPayload,
        PodCommandUnboundPayload
      >(
        client,
        WebSocketRequestEvents.POD_UNBIND_COMMAND,
        WebSocketResponseEvents.POD_COMMAND_UNBOUND,
        { requestId: uuidv4(), canvasId, podId: pod.id },
      );

      expect(response.success).toBe(true);
      expect(response.pod!.commandId).toBeNull();
    });

    it("Pod 無 Command 時解除綁定成功", async () => {
      const client = getClient();
      const pod = await createPod(client);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        PodUnbindCommandPayload,
        PodCommandUnboundPayload
      >(
        client,
        WebSocketRequestEvents.POD_UNBIND_COMMAND,
        WebSocketResponseEvents.POD_COMMAND_UNBOUND,
        { requestId: uuidv4(), canvasId, podId: pod.id },
      );

      expect(response.success).toBe(true);
    });

    it("Pod 不存在時解除綁定失敗", async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        PodUnbindCommandPayload,
        PodCommandUnboundPayload
      >(
        client,
        WebSocketRequestEvents.POD_UNBIND_COMMAND,
        WebSocketResponseEvents.POD_COMMAND_UNBOUND,
        { requestId: uuidv4(), canvasId, podId: FAKE_UUID },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });
  });
});

// ─── Command 跨 Provider 展開測試 ─────────────────────────────────────────────
// 以下測試採用獨立 server / client（與上方 Command 管理共用 server 會造成 mock 污染）
// vi.mock 必須在頂層宣告，provider spy 改用 vi.spyOn + mockImplementation 動態替換。

describe("Command 跨 Provider 展開行為", () => {
  let server: TestServerInstance;
  let client: TestWebSocketClient;

  beforeAll(async () => {
    server = await createTestServer();
  });

  afterAll(async () => {
    if (server) await closeTestServer(server);
  });

  beforeEach(async () => {
    client = await createSocketClient(server.baseUrl, server.canvasId);
  });

  afterEach(async () => {
    if (client?.connected) await disconnectSocket(client);
    vi.restoreAllMocks();
  });

  /**
   * 建立模擬 provider.chat async generator，
   * 回傳一個 text + turn_complete 事件序列。
   */
  async function* makeFakeChatEvents(text = "fake-response") {
    yield { type: "session_started" as const, sessionId: `sess-${Date.now()}` };
    yield { type: "text" as const, content: text };
    yield { type: "turn_complete" as const };
  }

  // ── 11. Claude Pod + commandId ────────────────────────────────────────────────

  it("11. Claude Pod 送訊息時，Provider 收到的 ctx.message 含 <command> 標籤", async () => {
    const { claudeProvider } =
      await import("../../src/services/provider/claudeProvider.js");

    let capturedMessage: string | unknown = null;

    const spy = vi
      .spyOn(claudeProvider, "chat")
      .mockImplementation(async function* (ctx) {
        capturedMessage = ctx.message;
        yield* makeFakeChatEvents();
      });

    const canvasId = server.canvasId;

    const pod = await createPod(client, { name: `claude-cmd-${uuidv4()}` });

    const cmd = await createCommand(
      client,
      `cmd-${uuidv4().slice(0, 8)}`,
      "# My Instruction",
    );
    await emitAndWaitResponse<PodBindCommandPayload, PodCommandBoundPayload>(
      client,
      WebSocketRequestEvents.POD_BIND_COMMAND,
      WebSocketResponseEvents.POD_COMMAND_BOUND,
      { requestId: uuidv4(), canvasId, podId: pod.id, commandId: cmd.id },
    );

    const completePromise = waitForEvent<PodChatCompletePayload>(
      client,
      WebSocketResponseEvents.POD_CHAT_COMPLETE,
      10000,
    );

    client.emit(WebSocketRequestEvents.POD_CHAT_SEND, {
      requestId: uuidv4(),
      canvasId,
      podId: pod.id,
      message: "Hello",
    } satisfies ChatSendPayload);

    await completePromise;

    expect(spy).toHaveBeenCalledTimes(1);

    expect(typeof capturedMessage).toBe("string");
    const msg = capturedMessage as string;
    expect(msg).toContain("<command>");
    expect(msg).toContain("# My Instruction");
    expect(msg).toContain("</command>");
    // 無 /name 前綴
    expect(msg).not.toMatch(/^\/[a-zA-Z]/);
    expect(msg).toContain("Hello");
  });

  // ── 12. Codex Pod + commandId ─────────────────────────────────────────────────

  it("12. Codex Pod 送訊息時，Provider 收到的 ctx.message 含 <command> 標籤（純文字展開）", async () => {
    const { codexProvider } =
      await import("../../src/services/provider/codexProvider.js");

    let capturedMessage: string | unknown = null;

    const spy = vi
      .spyOn(codexProvider, "chat")
      .mockImplementation(async function* (ctx) {
        capturedMessage = ctx.message;
        yield* makeFakeChatEvents();
      });

    const canvasId = server.canvasId;

    const pod = await createPod(client, {
      name: `codex-cmd-${uuidv4()}`,
      provider: "codex",
    });

    const cmd = await createCommand(
      client,
      `cmd-${uuidv4().slice(0, 8)}`,
      "# Codex Instruction",
    );
    await emitAndWaitResponse<PodBindCommandPayload, PodCommandBoundPayload>(
      client,
      WebSocketRequestEvents.POD_BIND_COMMAND,
      WebSocketResponseEvents.POD_COMMAND_BOUND,
      { requestId: uuidv4(), canvasId, podId: pod.id, commandId: cmd.id },
    );

    const completePromise = waitForEvent<PodChatCompletePayload>(
      client,
      WebSocketResponseEvents.POD_CHAT_COMPLETE,
      10000,
    );

    client.emit(WebSocketRequestEvents.POD_CHAT_SEND, {
      requestId: uuidv4(),
      canvasId,
      podId: pod.id,
      message: "Run task",
    } satisfies ChatSendPayload);

    await completePromise;

    expect(spy).toHaveBeenCalledTimes(1);

    expect(typeof capturedMessage).toBe("string");
    const msg = capturedMessage as string;
    expect(msg).toContain("<command>");
    expect(msg).toContain("# Codex Instruction");
    expect(msg).toContain("</command>");
    expect(msg).toContain("Run task");
  });

  // ── 13. Command 檔案不存在 ─────────────────────────────────────────────────────

  it("13-a. Command 不存在時，error 訊息被推送給前端（含 commandId 與「已不存在」）", async () => {
    const commandServiceModule =
      await import("../../src/services/commandService.js");
    const readSpy = vi
      .spyOn(commandServiceModule.commandService, "read")
      .mockResolvedValue(null);

    const canvasId = server.canvasId;
    const pod = await createPod(client, { name: `no-cmd-pod-a-${uuidv4()}` });

    const cmd = await createCommand(
      client,
      `cmd-${uuidv4().slice(0, 8)}`,
      "# Will Be Gone",
    );
    await emitAndWaitResponse<PodBindCommandPayload, PodCommandBoundPayload>(
      client,
      WebSocketRequestEvents.POD_BIND_COMMAND,
      WebSocketResponseEvents.POD_COMMAND_BOUND,
      { requestId: uuidv4(), canvasId, podId: pod.id, commandId: cmd.id },
    );

    // error 以 text 方式推送（via POD_CLAUDE_CHAT_MESSAGE）
    const messagePromise = waitForEvent<{ content: string }>(
      client,
      WebSocketResponseEvents.POD_CLAUDE_CHAT_MESSAGE,
      10000,
    );

    client.emit(WebSocketRequestEvents.POD_CHAT_SEND, {
      requestId: uuidv4(),
      canvasId,
      podId: pod.id,
      message: "test",
    } satisfies ChatSendPayload);

    const messageEvent = await messagePromise;

    expect(messageEvent.content).toContain(cmd.id);
    expect(messageEvent.content).toContain("已不存在");

    readSpy.mockRestore();
  });

  it("13-b. Command 不存在時，Pod 狀態回到 idle（onStreamComplete 被呼叫）", async () => {
    const commandServiceModule =
      await import("../../src/services/commandService.js");
    const readSpy = vi
      .spyOn(commandServiceModule.commandService, "read")
      .mockResolvedValue(null);

    const canvasId = server.canvasId;
    const pod = await createPod(client, { name: `no-cmd-pod-b-${uuidv4()}` });

    const cmd = await createCommand(
      client,
      `cmd-${uuidv4().slice(0, 8)}`,
      "# Will Be Gone",
    );
    await emitAndWaitResponse<PodBindCommandPayload, PodCommandBoundPayload>(
      client,
      WebSocketRequestEvents.POD_BIND_COMMAND,
      WebSocketResponseEvents.POD_COMMAND_BOUND,
      { requestId: uuidv4(), canvasId, podId: pod.id, commandId: cmd.id },
    );

    const messagePromise = waitForEvent<{ content: string }>(
      client,
      WebSocketResponseEvents.POD_CLAUDE_CHAT_MESSAGE,
      10000,
    );

    client.emit(WebSocketRequestEvents.POD_CHAT_SEND, {
      requestId: uuidv4(),
      canvasId,
      podId: pod.id,
      message: "test",
    } satisfies ChatSendPayload);

    await messagePromise;

    // 等待 Pod 狀態回到 idle（輪詢斷言，避免固定 sleep 造成不穩定）
    const { podStore: ps } = await import("../../src/services/podStore.js");
    await vi.waitFor(
      () => {
        const reloaded = ps.getById(canvasId, pod.id);
        expect(reloaded?.status).toBe("idle");
      },
      { timeout: 3000 },
    );

    readSpy.mockRestore();
  });

  it("13-c. Command 不存在後解除綁定，再次送訊息可正常執行（無狀態殘留）", async () => {
    const commandServiceModule =
      await import("../../src/services/commandService.js");
    // mockResolvedValueOnce：只有第一次呼叫回 null，後續不影響
    const readSpy = vi
      .spyOn(commandServiceModule.commandService, "read")
      .mockResolvedValueOnce(null);

    const canvasId = server.canvasId;
    const pod = await createPod(client, { name: `no-cmd-pod-c-${uuidv4()}` });

    const cmd = await createCommand(
      client,
      `cmd-${uuidv4().slice(0, 8)}`,
      "# Will Be Gone",
    );
    await emitAndWaitResponse<PodBindCommandPayload, PodCommandBoundPayload>(
      client,
      WebSocketRequestEvents.POD_BIND_COMMAND,
      WebSocketResponseEvents.POD_COMMAND_BOUND,
      { requestId: uuidv4(), canvasId, podId: pod.id, commandId: cmd.id },
    );

    // 第一次送訊息：read 回 null → error path
    const firstMsgPromise = waitForEvent<{ content: string }>(
      client,
      WebSocketResponseEvents.POD_CLAUDE_CHAT_MESSAGE,
      10000,
    );
    client.emit(WebSocketRequestEvents.POD_CHAT_SEND, {
      requestId: uuidv4(),
      canvasId,
      podId: pod.id,
      message: "first",
    } satisfies ChatSendPayload);
    await firstMsgPromise;
    readSpy.mockRestore();

    // 等待 Pod 狀態回到 idle（輪詢斷言，避免固定 sleep 造成不穩定）
    const { podStore: ps13c } = await import("../../src/services/podStore.js");
    await vi.waitFor(
      () => {
        const reloaded = ps13c.getById(canvasId, pod.id);
        expect(reloaded?.status).toBe("idle");
      },
      { timeout: 3000 },
    );

    // 解除 command 綁定
    await emitAndWaitResponse<
      PodUnbindCommandPayload,
      PodCommandUnboundPayload
    >(
      client,
      WebSocketRequestEvents.POD_UNBIND_COMMAND,
      WebSocketResponseEvents.POD_COMMAND_UNBOUND,
      { requestId: uuidv4(), canvasId, podId: pod.id },
    );

    // spy provider 讓第二次可正常完成
    const { claudeProvider } =
      await import("../../src/services/provider/claudeProvider.js");
    const providerSpy = vi
      .spyOn(claudeProvider, "chat")
      .mockImplementation(async function* () {
        yield* makeFakeChatEvents("second-response");
      });

    // 第二次送訊息：無 command，直接送
    const secondComplete = waitForEvent<PodChatCompletePayload>(
      client,
      WebSocketResponseEvents.POD_CHAT_COMPLETE,
      10000,
    );
    client.emit(WebSocketRequestEvents.POD_CHAT_SEND, {
      requestId: uuidv4(),
      canvasId,
      podId: pod.id,
      message: "second",
    } satisfies ChatSendPayload);

    const result = await secondComplete;
    expect(result).toBeDefined();
    expect(providerSpy).toHaveBeenCalledTimes(1);
  });

  // ── 14. Pod 無 commandId ────────────────────────────────────────────────────────

  it("14. Pod 無 commandId 時，Provider 收到的訊息與原始輸入相同（不做展開）", async () => {
    const { claudeProvider } =
      await import("../../src/services/provider/claudeProvider.js");

    let capturedMessage: unknown = null;

    vi.spyOn(claudeProvider, "chat").mockImplementation(async function* (ctx) {
      capturedMessage = ctx.message;
      yield* makeFakeChatEvents();
    });

    const canvasId = server.canvasId;
    const pod = await createPod(client, { name: `no-cmd-${uuidv4()}` });

    // 確認無 commandId
    const { podStore: ps } = await import("../../src/services/podStore.js");
    const reloaded = ps.getById(canvasId, pod.id);
    expect(reloaded?.commandId).toBeFalsy();

    const completePromise = waitForEvent<PodChatCompletePayload>(
      client,
      WebSocketResponseEvents.POD_CHAT_COMPLETE,
      10000,
    );

    client.emit(WebSocketRequestEvents.POD_CHAT_SEND, {
      requestId: uuidv4(),
      canvasId,
      podId: pod.id,
      message: "plain message",
    } satisfies ChatSendPayload);

    await completePromise;

    expect(capturedMessage).toBe("plain message");
  });

  // ── 15. 看似 /xxx 的純文字（無綁定 Command）─────────────────────────────────────

  it("15. 輸入看似斜線指令的純文字（無 Command 綁定），Provider 收到原始字串", async () => {
    const { claudeProvider } =
      await import("../../src/services/provider/claudeProvider.js");

    let capturedMessage: unknown = null;

    vi.spyOn(claudeProvider, "chat").mockImplementation(async function* (ctx) {
      capturedMessage = ctx.message;
      yield* makeFakeChatEvents();
    });

    const canvasId = server.canvasId;
    const pod = await createPod(client, { name: `slash-text-${uuidv4()}` });

    const completePromise = waitForEvent<PodChatCompletePayload>(
      client,
      WebSocketResponseEvents.POD_CHAT_COMPLETE,
      10000,
    );

    client.emit(WebSocketRequestEvents.POD_CHAT_SEND, {
      requestId: uuidv4(),
      canvasId,
      podId: pod.id,
      message: "/help please",
    } satisfies ChatSendPayload);

    await completePromise;

    expect(capturedMessage).toBe("/help please");
  });

  // ── 16. 同一 Command 在 Claude Pod 與 Codex Pod 分別展開 ───────────────────────

  it("16. 同一 Command 在 Claude Pod 與 Codex Pod 收到的展開訊息一致", async () => {
    const { claudeProvider } =
      await import("../../src/services/provider/claudeProvider.js");
    const { codexProvider } =
      await import("../../src/services/provider/codexProvider.js");

    let claudeMessage: unknown = null;
    let codexMessage: unknown = null;

    vi.spyOn(claudeProvider, "chat").mockImplementation(async function* (ctx) {
      claudeMessage = ctx.message;
      yield* makeFakeChatEvents();
    });

    vi.spyOn(codexProvider, "chat").mockImplementation(async function* (ctx) {
      codexMessage = ctx.message;
      yield* makeFakeChatEvents();
    });

    const canvasId = server.canvasId;
    const cmdContent = "# Shared Instruction\nDo something important.";
    const cmd = await createCommand(
      client,
      `cmd-${uuidv4().slice(0, 8)}`,
      cmdContent,
    );

    // Claude Pod
    const claudePod = await createPod(client, {
      name: `claude-shared-${uuidv4()}`,
    });
    await emitAndWaitResponse<PodBindCommandPayload, PodCommandBoundPayload>(
      client,
      WebSocketRequestEvents.POD_BIND_COMMAND,
      WebSocketResponseEvents.POD_COMMAND_BOUND,
      { requestId: uuidv4(), canvasId, podId: claudePod.id, commandId: cmd.id },
    );

    const claudeComplete = waitForEvent<PodChatCompletePayload>(
      client,
      WebSocketResponseEvents.POD_CHAT_COMPLETE,
      10000,
    );
    client.emit(WebSocketRequestEvents.POD_CHAT_SEND, {
      requestId: uuidv4(),
      canvasId,
      podId: claudePod.id,
      message: "execute",
    } satisfies ChatSendPayload);
    await claudeComplete;

    // Codex Pod
    const codexPod = await createPod(client, {
      name: `codex-shared-${uuidv4()}`,
      provider: "codex",
    });
    await emitAndWaitResponse<PodBindCommandPayload, PodCommandBoundPayload>(
      client,
      WebSocketRequestEvents.POD_BIND_COMMAND,
      WebSocketResponseEvents.POD_COMMAND_BOUND,
      { requestId: uuidv4(), canvasId, podId: codexPod.id, commandId: cmd.id },
    );

    const codexComplete = waitForEvent<PodChatCompletePayload>(
      client,
      WebSocketResponseEvents.POD_CHAT_COMPLETE,
      10000,
    );
    client.emit(WebSocketRequestEvents.POD_CHAT_SEND, {
      requestId: uuidv4(),
      canvasId,
      podId: codexPod.id,
      message: "execute",
    } satisfies ChatSendPayload);
    await codexComplete;

    // 兩邊收到的展開訊息應相同
    expect(typeof claudeMessage).toBe("string");
    expect(typeof codexMessage).toBe("string");
    expect(claudeMessage).toBe(codexMessage);

    const msg = claudeMessage as string;
    expect(msg).toContain("<command>");
    expect(msg).toContain("# Shared Instruction");
    expect(msg).toContain("execute");
  });

  // ── 17. Capability guard：Codex + multiInstance=true 被擋下 ───────────────────
  // 設計說明：Codex 不支援 runMode，因此在 handlePodSetMultiInstance 階段
  // assertCapability("runMode") 會直接以 CAPABILITY_NOT_SUPPORTED 擋下，
  // 且 podStore.setMultiInstance 不被呼叫，pod.multiInstance 維持 false。
  // chatHandlers.ts 的 RUN_NOT_SUPPORTED 路徑因此永遠不會被觸及。

  it("17. Codex Pod 設定 multiInstance=true（Run mode）時，被 CAPABILITY_NOT_SUPPORTED 擋下（command=true 不影響）", async () => {
    const canvasId = server.canvasId;

    const pod = await createPod(client, {
      name: `codex-run-${uuidv4()}`,
      provider: "codex",
    });

    // 嘗試啟用 multiInstance；Codex 不支援 runMode，應回傳 success=false
    const setResponse = await emitAndWaitResponse<
      PodSetMultiInstancePayload,
      PodMultiInstanceSetPayload
    >(
      client,
      WebSocketRequestEvents.POD_SET_MULTI_INSTANCE,
      WebSocketResponseEvents.POD_MULTI_INSTANCE_SET,
      { requestId: uuidv4(), canvasId, podId: pod.id, multiInstance: true },
    );

    // 設定被擋下，success=false，code 為 CAPABILITY_NOT_SUPPORTED
    expect(setResponse.success).toBe(false);

    // pod.multiInstance 維持 false（沒有被寫入）
    const { podStore: ps } = await import("../../src/services/podStore.js");
    const reloaded = ps.getById(canvasId, pod.id);
    expect(reloaded?.multiInstance).toBe(false);
  });

  // ── 18. Pod 已綁 Command，使用者輸入 /help（純文字斜線）─────────────────────────

  it("18. Pod 已綁 Command 時，使用者輸入 /help，Provider 收到 <command>...\n/help（不特殊處理）", async () => {
    const { claudeProvider } =
      await import("../../src/services/provider/claudeProvider.js");

    let capturedMessage: unknown = null;

    vi.spyOn(claudeProvider, "chat").mockImplementation(async function* (ctx) {
      capturedMessage = ctx.message;
      yield* makeFakeChatEvents();
    });

    const canvasId = server.canvasId;

    const cmd = await createCommand(
      client,
      `cmd-${uuidv4().slice(0, 8)}`,
      "# Bound Instruction",
    );
    const pod = await createPod(client, { name: `bound-slash-${uuidv4()}` });

    await emitAndWaitResponse<PodBindCommandPayload, PodCommandBoundPayload>(
      client,
      WebSocketRequestEvents.POD_BIND_COMMAND,
      WebSocketResponseEvents.POD_COMMAND_BOUND,
      { requestId: uuidv4(), canvasId, podId: pod.id, commandId: cmd.id },
    );

    const completePromise = waitForEvent<PodChatCompletePayload>(
      client,
      WebSocketResponseEvents.POD_CHAT_COMPLETE,
      10000,
    );

    client.emit(WebSocketRequestEvents.POD_CHAT_SEND, {
      requestId: uuidv4(),
      canvasId,
      podId: pod.id,
      message: "/help",
    } satisfies ChatSendPayload);

    await completePromise;

    expect(typeof capturedMessage).toBe("string");
    const msg = capturedMessage as string;
    expect(msg).toContain("<command>");
    expect(msg).toContain("# Bound Instruction");
    expect(msg).toContain("</command>");
    expect(msg).toContain("/help");
    // /help 不被二次展開（只有一個 <command> 標籤）
    const commandTagCount = (msg.match(/<command>/g) ?? []).length;
    expect(commandTagCount).toBe(1);
  });

  // ── 26. commandId 指向不存在檔案：前端收到精確錯誤訊息 ────────────────────────

  it("26. commandId 指向不存在檔案，前端收到「Command 「xxx」已不存在...」精確錯誤訊息", async () => {
    const commandServiceModule =
      await import("../../src/services/commandService.js");
    const fakeCommandId = `fake-cmd-${uuidv4().slice(0, 8)}`;
    const readSpy = vi
      .spyOn(commandServiceModule.commandService, "read")
      .mockResolvedValue(null);

    const canvasId = server.canvasId;
    const pod = await createPod(client, { name: `missing-cmd-${uuidv4()}` });

    // 強制設定 commandId，模擬 command 已被刪除但 pod 仍綁著的情境
    const { podStore: ps } = await import("../../src/services/podStore.js");
    ps.setCommandId(canvasId, pod.id, fakeCommandId);

    const messagePromise = waitForEvent<{ content: string }>(
      client,
      WebSocketResponseEvents.POD_CLAUDE_CHAT_MESSAGE,
      10000,
    );

    client.emit(WebSocketRequestEvents.POD_CHAT_SEND, {
      requestId: uuidv4(),
      canvasId,
      podId: pod.id,
      message: "test 26",
    } satisfies ChatSendPayload);

    const msgEvent = await messagePromise;

    // 前端收到的文字應含精確錯誤訊息
    expect(msgEvent.content).toContain(`Command 「${fakeCommandId}」已不存在`);
    expect(msgEvent.content).toContain("請至 Pod 設定重新選擇或解除綁定");

    // 等待 Pod 狀態回到 idle（輪詢斷言，避免固定 sleep 造成不穩定）
    await vi.waitFor(
      () => {
        const reloaded = ps.getById(canvasId, pod.id);
        expect(reloaded?.status).toBe("idle");
      },
      { timeout: 3000 },
    );

    readSpy.mockRestore();
  });

  // ── 27. command 展開後的訊息進 DB（三方一致）────────────────────────────────────

  it("27. command 展開後的訊息進 DB（POD_CHAT_USER_MESSAGE 廣播也含展開內容）", async () => {
    const { claudeProvider } =
      await import("../../src/services/provider/claudeProvider.js");

    vi.spyOn(claudeProvider, "chat").mockImplementation(async function* () {
      yield* makeFakeChatEvents();
    });

    const canvasId = server.canvasId;
    const cmdContent = "# Injected Instruction\nFollow these rules.";
    const cmd = await createCommand(
      client,
      `cmd-${uuidv4().slice(0, 8)}`,
      cmdContent,
    );
    const pod = await createPod(client, { name: `inject-${uuidv4()}` });

    await emitAndWaitResponse<PodBindCommandPayload, PodCommandBoundPayload>(
      client,
      WebSocketRequestEvents.POD_BIND_COMMAND,
      WebSocketResponseEvents.POD_COMMAND_BOUND,
      { requestId: uuidv4(), canvasId, podId: pod.id, commandId: cmd.id },
    );

    // 監聽 user message 廣播
    const userMsgPromise = waitForEvent<{ content: string }>(
      client,
      WebSocketResponseEvents.POD_CHAT_USER_MESSAGE,
      10000,
    );

    const completePromise = waitForEvent<PodChatCompletePayload>(
      client,
      WebSocketResponseEvents.POD_CHAT_COMPLETE,
      10000,
    );

    client.emit(WebSocketRequestEvents.POD_CHAT_SEND, {
      requestId: uuidv4(),
      canvasId,
      podId: pod.id,
      message: "user input",
    } satisfies ChatSendPayload);

    const [userMsgEvent] = await Promise.all([userMsgPromise, completePromise]);

    // POD_CHAT_USER_MESSAGE 廣播的 content 應含展開後的 <command> 標籤
    expect(userMsgEvent.content).toContain("<command>");
    expect(userMsgEvent.content).toContain("# Injected Instruction");
    expect(userMsgEvent.content).toContain("user input");

    // messageStore 的使用者訊息也應含展開內容
    const messages = messageStore.getMessages(pod.id);
    const userMessages = messages.filter((m) => m.role === "user");
    expect(userMessages.length).toBeGreaterThan(0);
    const lastUserMsg = userMessages[userMessages.length - 1];
    expect(lastUserMsg.content).toContain("<command>");
    expect(lastUserMsg.content).toContain("# Injected Instruction");
    expect(lastUserMsg.content).toContain("user input");
  });

  // ── 28. command 不存在時：原文進 DB、錯誤文字推前端 ─────────────────────────────

  it("28. command 不存在時：使用者原文注入 DB，錯誤文字推給前端", async () => {
    const commandServiceModule =
      await import("../../src/services/commandService.js");
    const fakeCommandId = `missing-${uuidv4().slice(0, 8)}`;
    const readSpy = vi
      .spyOn(commandServiceModule.commandService, "read")
      .mockResolvedValue(null);

    const canvasId = server.canvasId;
    const pod = await createPod(client, { name: `cmd-missing-${uuidv4()}` });

    const { podStore: ps } = await import("../../src/services/podStore.js");
    ps.setCommandId(canvasId, pod.id, fakeCommandId);

    // 監聽 user message 廣播（原文應被注入）
    const userMsgPromise = waitForEvent<{ content: string }>(
      client,
      WebSocketResponseEvents.POD_CHAT_USER_MESSAGE,
      10000,
    );
    // 監聽 error text 廣播
    const errorMsgPromise = waitForEvent<{ content: string }>(
      client,
      WebSocketResponseEvents.POD_CLAUDE_CHAT_MESSAGE,
      10000,
    );

    client.emit(WebSocketRequestEvents.POD_CHAT_SEND, {
      requestId: uuidv4(),
      canvasId,
      podId: pod.id,
      message: "original user text",
    } satisfies ChatSendPayload);

    const [userMsgEvent, errorMsgEvent] = await Promise.all([
      userMsgPromise,
      errorMsgPromise,
    ]);

    // POD_CHAT_USER_MESSAGE 應含原始訊息（command 讀取失敗，存入原文）
    expect(userMsgEvent.content).toContain("original user text");
    // 不應含 <command> 標籤（command 不存在，無法展開）
    expect(userMsgEvent.content).not.toContain("<command");

    // POD_CLAUDE_CHAT_MESSAGE 應含錯誤提示
    expect(errorMsgEvent.content).toContain("⚠️");
    expect(errorMsgEvent.content).toContain(fakeCommandId);
    expect(errorMsgEvent.content).toContain("已不存在");

    // messageStore 的使用者訊息應為原始訊息
    const messages = messageStore.getMessages(pod.id);
    const userMessages = messages.filter((m) => m.role === "user");
    expect(userMessages.length).toBeGreaterThan(0);
    const lastUserMsg = userMessages[userMessages.length - 1];
    expect(lastUserMsg.content).toContain("original user text");
    expect(lastUserMsg.content).not.toContain("<command");

    // 等待 Pod 狀態回到 idle（輪詢斷言，避免固定 sleep 造成不穩定）
    await vi.waitFor(
      () => {
        const reloaded = ps.getById(canvasId, pod.id);
        expect(reloaded?.status).toBe("idle");
      },
      { timeout: 3000 },
    );

    readSpy.mockRestore();
  });
});
