import type { TestWebSocketClient } from "../setup";
import { v4 as uuidv4 } from "uuid";
import { emitAndWaitResponse } from "../setup";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "../../src/schemas";
import type {
  CommandNoteCreatedPayload,
  SkillNoteCreatedPayload,
  RepositoryNoteCreatedPayload,
  NoteCreatedPayload,
} from "../../src/types";

/**
 * 取得 client 的 canvasId
 */
async function getCanvasId(client: TestWebSocketClient): Promise<string> {
  if (!client.id) {
    throw new Error("Socket not connected");
  }

  const canvasModule = await import("../../src/services/canvasStore.js");
  const canvasId = canvasModule.canvasStore.getActiveCanvas(client.id);

  if (!canvasId) {
    throw new Error("No active canvas for socket");
  }

  return canvasId;
}

/**
 * 建立 Command Note
 */
export async function createCommandNote(
  client: TestWebSocketClient,
  commandId: string,
) {
  const canvasId = await getCanvasId(client);
  const response = await emitAndWaitResponse<any, CommandNoteCreatedPayload>(
    client,
    WebSocketRequestEvents.COMMAND_NOTE_CREATE,
    WebSocketResponseEvents.COMMAND_NOTE_CREATED,
    {
      requestId: uuidv4(),
      canvasId,
      commandId,
      name: "Cmd Note",
      x: 100,
      y: 100,
      boundToPodId: null,
      originalPosition: null,
    },
  );
  return response.note!;
}

/**
 * 建立 Skill Note
 */
export async function createSkillNote(
  client: TestWebSocketClient,
  skillId: string,
) {
  const canvasId = await getCanvasId(client);
  const response = await emitAndWaitResponse<any, SkillNoteCreatedPayload>(
    client,
    WebSocketRequestEvents.SKILL_NOTE_CREATE,
    WebSocketResponseEvents.SKILL_NOTE_CREATED,
    {
      requestId: uuidv4(),
      canvasId,
      skillId,
      name: "Skill Note",
      x: 100,
      y: 100,
      boundToPodId: null,
      originalPosition: null,
    },
  );
  return response.note!;
}

/**
 * 建立 Repository Note
 */
export async function createRepositoryNote(
  client: TestWebSocketClient,
  repositoryId: string,
) {
  const canvasId = await getCanvasId(client);
  const response = await emitAndWaitResponse<any, RepositoryNoteCreatedPayload>(
    client,
    WebSocketRequestEvents.REPOSITORY_NOTE_CREATE,
    WebSocketResponseEvents.REPOSITORY_NOTE_CREATED,
    {
      requestId: uuidv4(),
      canvasId,
      repositoryId,
      name: "Repo Note",
      x: 100,
      y: 100,
      boundToPodId: null,
      originalPosition: null,
    },
  );
  return response.note!;
}
