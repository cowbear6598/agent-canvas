import type { TestWebSocketClient } from "../setup";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs/promises";
import * as path from "path";
import { emitAndWaitResponse } from "../setup";
import { testConfig } from "../setup";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
  type RepositoryCreatePayload,
  type SubAgentCreatePayload,
  type CommandCreatePayload,
  type McpServerCreatePayload,
  type McpServerNoteCreatePayload,
} from "../../src/schemas";
import {
  type RepositoryCreatedPayload,
  type SubAgentCreatedPayload,
  type CommandCreatedPayload,
  type McpServerCreatedPayload,
  type McpServerNoteCreatedPayload,
} from "../../src/types";

export async function createSkillFile(
  name: string,
  content: string,
): Promise<string> {
  const skillDir = path.join(testConfig.skillsPath, name);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, "SKILL.md"), content);
  return name;
}

export async function createRepository(
  client: TestWebSocketClient,
  name: string,
  overrides?: Partial<RepositoryCreatePayload>,
): Promise<{ id: string; name: string }> {
  if (!client.id) {
    throw new Error("Socket not connected");
  }

  const canvasModule = await import("../../src/services/canvasStore.js");
  const canvasId = canvasModule.canvasStore.getActiveCanvas(client.id);

  if (!canvasId) {
    throw new Error("No active canvas for socket");
  }

  const response = await emitAndWaitResponse<
    RepositoryCreatePayload,
    RepositoryCreatedPayload
  >(
    client,
    WebSocketRequestEvents.REPOSITORY_CREATE,
    WebSocketResponseEvents.REPOSITORY_CREATED,
    { requestId: uuidv4(), canvasId, name, ...overrides },
  );

  return response.repository!;
}

export async function createSubAgent(
  client: TestWebSocketClient,
  name: string,
  content: string,
  overrides?: Partial<SubAgentCreatePayload>,
): Promise<{ id: string; name: string }> {
  if (!client.id) {
    throw new Error("Socket not connected");
  }

  const canvasModule = await import("../../src/services/canvasStore.js");
  const canvasId = canvasModule.canvasStore.getActiveCanvas(client.id);

  if (!canvasId) {
    throw new Error("No active canvas for socket");
  }

  const response = await emitAndWaitResponse<
    SubAgentCreatePayload,
    SubAgentCreatedPayload
  >(
    client,
    WebSocketRequestEvents.SUBAGENT_CREATE,
    WebSocketResponseEvents.SUBAGENT_CREATED,
    { requestId: uuidv4(), canvasId, name, content, ...overrides },
  );

  return response.subAgent!;
}

export async function createCommand(
  client: TestWebSocketClient,
  name: string,
  content: string,
  overrides?: Partial<CommandCreatePayload>,
): Promise<{ id: string; name: string }> {
  if (!client.id) {
    throw new Error("Socket not connected");
  }

  const canvasModule = await import("../../src/services/canvasStore.js");
  const canvasId = canvasModule.canvasStore.getActiveCanvas(client.id);

  if (!canvasId) {
    throw new Error("No active canvas for socket");
  }

  const response = await emitAndWaitResponse<
    CommandCreatePayload,
    CommandCreatedPayload
  >(
    client,
    WebSocketRequestEvents.COMMAND_CREATE,
    WebSocketResponseEvents.COMMAND_CREATED,
    { requestId: uuidv4(), canvasId, name, content, ...overrides },
  );

  return response.command!;
}

export async function createMcpServer(
  client: TestWebSocketClient,
  name: string,
  overrides?: Partial<McpServerCreatePayload>,
): Promise<{ id: string; name: string }> {
  if (!client.id) {
    throw new Error("Socket not connected");
  }

  const canvasModule = await import("../../src/services/canvasStore.js");
  const canvasId = canvasModule.canvasStore.getActiveCanvas(client.id);

  if (!canvasId) {
    throw new Error("No active canvas for socket");
  }

  const response = await emitAndWaitResponse<
    McpServerCreatePayload,
    McpServerCreatedPayload
  >(
    client,
    WebSocketRequestEvents.MCP_SERVER_CREATE,
    WebSocketResponseEvents.MCP_SERVER_CREATED,
    {
      requestId: uuidv4(),
      canvasId,
      name,
      config: { command: "echo", args: ["test"] },
      ...overrides,
    },
  );

  return response.mcpServer!;
}

export async function createMcpServerNote(
  client: TestWebSocketClient,
  mcpServerId: string,
  overrides?: Partial<McpServerNoteCreatePayload>,
): Promise<{ id: string }> {
  if (!client.id) {
    throw new Error("Socket not connected");
  }

  const canvasModule = await import("../../src/services/canvasStore.js");
  const canvasId = canvasModule.canvasStore.getActiveCanvas(client.id);

  if (!canvasId) {
    throw new Error("No active canvas for socket");
  }

  const response = await emitAndWaitResponse<
    McpServerNoteCreatePayload,
    McpServerNoteCreatedPayload
  >(
    client,
    WebSocketRequestEvents.MCP_SERVER_NOTE_CREATE,
    WebSocketResponseEvents.MCP_SERVER_NOTE_CREATED,
    {
      requestId: uuidv4(),
      canvasId,
      mcpServerId,
      name: "MCP Note",
      x: 100,
      y: 100,
      boundToPodId: null,
      originalPosition: null,
      ...overrides,
    },
  );

  return response.note!;
}
