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
  type RepositoryNoteCreatePayload,
} from "../../src/schemas";
import {
  type RepositoryCreatedPayload,
  type RepositoryNoteCreatedPayload,
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

export async function createRepositoryNote(
  client: TestWebSocketClient,
  repositoryId: string,
): Promise<{ id: string; repositoryId: string; x: number; y: number }> {
  if (!client.id) {
    throw new Error("Socket not connected");
  }

  const canvasModule = await import("../../src/services/canvasStore.js");
  const canvasId = canvasModule.canvasStore.getActiveCanvas(client.id);

  if (!canvasId) {
    throw new Error("No active canvas for socket");
  }

  const response = await emitAndWaitResponse<
    RepositoryNoteCreatePayload,
    RepositoryNoteCreatedPayload
  >(
    client,
    WebSocketRequestEvents.REPOSITORY_NOTE_CREATE,
    WebSocketResponseEvents.REPOSITORY_NOTE_CREATED,
    {
      requestId: uuidv4(),
      canvasId,
      repositoryId,
      name: `repo-note-${uuidv4()}`,
      x: 10,
      y: 20,
      boundToPodId: null,
      originalPosition: null,
    },
  );

  return response.note!;
}
