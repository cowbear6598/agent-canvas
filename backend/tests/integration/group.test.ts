import { v4 as uuidv4 } from "uuid";
import { emitAndWaitResponse, setupIntegrationTest } from "../setup";
import { createCommand } from "../helpers";
import {
  type CommandMoveToGroupPayload,
  type GroupCreatePayload,
  type GroupDeletePayload,
  type GroupListPayload,
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "../../src/schemas";
import {
  type Group,
  type GroupCreatedResponse,
  type GroupDeletedResponse,
  type GroupListResultResponse,
  type ItemMovedToGroupResponse,
} from "../../src/types";

describe("Group 管理", () => {
  const { getServer, getClient } = setupIntegrationTest();

  async function createGroup(type: "command", name?: string) {
    const client = getClient();
    const server = getServer();
    const groupName = name ?? `group-${uuidv4().slice(0, 8)}`;

    return await emitAndWaitResponse<GroupCreatePayload, GroupCreatedResponse>(
      client,
      WebSocketRequestEvents.GROUP_CREATE,
      WebSocketResponseEvents.GROUP_CREATED,
      { requestId: uuidv4(), canvasId: server.canvasId, name: groupName, type },
    );
  }

  describe("建立 Group", () => {
    it("成功建立 Command 群組", async () => {
      const response = await createGroup("command");

      expect(response.success).toBe(true);
      expect(response.group).toBeDefined();
      expect(response.group!.type).toBe("command");
    });

    it("重複名稱時建立群組失敗", async () => {
      const groupName = `dup-group-${uuidv4().slice(0, 8)}`;
      await createGroup("command", groupName);

      const response = await createGroup("command", groupName);

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });

    it("路徑穿越攻擊時建立群組失敗", async () => {
      const client = getClient();
      const server = getServer();
      const response = await emitAndWaitResponse<
        GroupCreatePayload,
        GroupCreatedResponse
      >(
        client,
        WebSocketRequestEvents.GROUP_CREATE,
        WebSocketResponseEvents.GROUP_CREATED,
        {
          requestId: uuidv4(),
          canvasId: server.canvasId,
          name: "../malicious",
          type: "command",
        },
      );

      expect(response.success).toBe(false);
    });

    it("包含斜線時建立群組失敗", async () => {
      const client = getClient();
      const server = getServer();
      const response = await emitAndWaitResponse<
        GroupCreatePayload,
        GroupCreatedResponse
      >(
        client,
        WebSocketRequestEvents.GROUP_CREATE,
        WebSocketResponseEvents.GROUP_CREATED,
        {
          requestId: uuidv4(),
          canvasId: server.canvasId,
          name: "test/path",
          type: "command",
        },
      );

      expect(response.success).toBe(false);
    });

    it("包含特殊字元時建立群組失敗", async () => {
      const client = getClient();
      const server = getServer();
      const response = await emitAndWaitResponse<
        GroupCreatePayload,
        GroupCreatedResponse
      >(
        client,
        WebSocketRequestEvents.GROUP_CREATE,
        WebSocketResponseEvents.GROUP_CREATED,
        {
          requestId: uuidv4(),
          canvasId: server.canvasId,
          name: "test@group",
          type: "command",
        },
      );

      expect(response.success).toBe(false);
    });

    it("成功建立包含破折號的群組", async () => {
      const client = getClient();
      const server = getServer();
      const response = await emitAndWaitResponse<
        GroupCreatePayload,
        GroupCreatedResponse
      >(
        client,
        WebSocketRequestEvents.GROUP_CREATE,
        WebSocketResponseEvents.GROUP_CREATED,
        {
          requestId: uuidv4(),
          canvasId: server.canvasId,
          name: "test-group-123",
          type: "command",
        },
      );

      expect(response.success).toBe(true);
      expect(response.group).toBeDefined();
    });
  });

  describe("列出 Groups", () => {
    it("成功列出 Command 群組", async () => {
      const client = getClient();
      const server = getServer();
      const group = await createGroup("command");

      const response = await emitAndWaitResponse<
        GroupListPayload,
        GroupListResultResponse
      >(
        client,
        WebSocketRequestEvents.GROUP_LIST,
        WebSocketResponseEvents.GROUP_LIST_RESULT,
        { requestId: uuidv4(), canvasId: server.canvasId, type: "command" },
      );

      expect(response.success).toBe(true);
      expect(response.groups).toBeDefined();
      expect(response.groups!.length).toBeGreaterThan(0);
      expect(
        response.groups!.some((g: Group) => g.id === group.group!.id),
      ).toBe(true);
    });
  });

  describe("刪除 Group", () => {
    it("成功刪除空群組", async () => {
      const client = getClient();
      const server = getServer();
      const group = await createGroup("command");

      const response = await emitAndWaitResponse<
        GroupDeletePayload,
        GroupDeletedResponse
      >(
        client,
        WebSocketRequestEvents.GROUP_DELETE,
        WebSocketResponseEvents.GROUP_DELETED,
        {
          requestId: uuidv4(),
          canvasId: server.canvasId,
          groupId: group.group!.id,
        },
      );

      expect(response.success).toBe(true);
      expect(response.groupId).toBe(group.group!.id);
    });

    it("群組內有項目時刪除失敗", async () => {
      const client = getClient();
      const server = getServer();
      const group = await createGroup("command");
      const command = await createCommand(
        client,
        `cmd-${uuidv4()}`,
        "# Content",
      );

      await emitAndWaitResponse<
        CommandMoveToGroupPayload,
        ItemMovedToGroupResponse
      >(
        client,
        WebSocketRequestEvents.COMMAND_MOVE_TO_GROUP,
        WebSocketResponseEvents.COMMAND_MOVED_TO_GROUP,
        { requestId: uuidv4(), itemId: command.id, groupId: group.group!.id },
      );

      const response = await emitAndWaitResponse<
        GroupDeletePayload,
        GroupDeletedResponse
      >(
        client,
        WebSocketRequestEvents.GROUP_DELETE,
        WebSocketResponseEvents.GROUP_DELETED,
        {
          requestId: uuidv4(),
          canvasId: server.canvasId,
          groupId: group.group!.id,
        },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });

    it("不存在的群組時刪除失敗", async () => {
      const client = getClient();
      const server = getServer();
      const response = await emitAndWaitResponse<
        GroupDeletePayload,
        GroupDeletedResponse
      >(
        client,
        WebSocketRequestEvents.GROUP_DELETE,
        WebSocketResponseEvents.GROUP_DELETED,
        {
          requestId: uuidv4(),
          canvasId: server.canvasId,
          groupId: "nonexistent-group",
        },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });
  });

  describe("Command 移動到 Group", () => {
    it("成功將 Command 移至群組", async () => {
      const client = getClient();
      const group = await createGroup("command");
      const command = await createCommand(
        client,
        `cmd-${uuidv4()}`,
        "# Content",
      );

      const response = await emitAndWaitResponse<
        CommandMoveToGroupPayload,
        ItemMovedToGroupResponse
      >(
        client,
        WebSocketRequestEvents.COMMAND_MOVE_TO_GROUP,
        WebSocketResponseEvents.COMMAND_MOVED_TO_GROUP,
        { requestId: uuidv4(), itemId: command.id, groupId: group.group!.id },
      );

      expect(response.success).toBe(true);
      expect(response.itemId).toBe(command.id);
      expect(response.groupId).toBe(group.group!.id);
    });

    it("成功將 Command 從群組移至根目錄", async () => {
      const client = getClient();
      const group = await createGroup("command");
      const command = await createCommand(
        client,
        `cmd-${uuidv4()}`,
        "# Content",
      );

      await emitAndWaitResponse<
        CommandMoveToGroupPayload,
        ItemMovedToGroupResponse
      >(
        client,
        WebSocketRequestEvents.COMMAND_MOVE_TO_GROUP,
        WebSocketResponseEvents.COMMAND_MOVED_TO_GROUP,
        { requestId: uuidv4(), itemId: command.id, groupId: group.group!.id },
      );

      const response = await emitAndWaitResponse<
        CommandMoveToGroupPayload,
        ItemMovedToGroupResponse
      >(
        client,
        WebSocketRequestEvents.COMMAND_MOVE_TO_GROUP,
        WebSocketResponseEvents.COMMAND_MOVED_TO_GROUP,
        { requestId: uuidv4(), itemId: command.id, groupId: null },
      );

      expect(response.success).toBe(true);
      expect(response.groupId).toBeNull();
    });

    it("成功在群組間移動 Command", async () => {
      const client = getClient();
      const group1 = await createGroup("command");
      const group2 = await createGroup("command");
      const command = await createCommand(
        client,
        `cmd-${uuidv4()}`,
        "# Content",
      );

      await emitAndWaitResponse<
        CommandMoveToGroupPayload,
        ItemMovedToGroupResponse
      >(
        client,
        WebSocketRequestEvents.COMMAND_MOVE_TO_GROUP,
        WebSocketResponseEvents.COMMAND_MOVED_TO_GROUP,
        { requestId: uuidv4(), itemId: command.id, groupId: group1.group!.id },
      );

      const response = await emitAndWaitResponse<
        CommandMoveToGroupPayload,
        ItemMovedToGroupResponse
      >(
        client,
        WebSocketRequestEvents.COMMAND_MOVE_TO_GROUP,
        WebSocketResponseEvents.COMMAND_MOVED_TO_GROUP,
        { requestId: uuidv4(), itemId: command.id, groupId: group2.group!.id },
      );

      expect(response.success).toBe(true);
      expect(response.groupId).toBe(group2.group!.id);
    });
  });
});
