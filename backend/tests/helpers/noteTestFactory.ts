import { v4 as uuidv4 } from "uuid";
import { emitAndWaitResponse } from "../setup";
import { getCanvasId } from "./canvasHelper.js";
import { FAKE_UUID } from "./testConstants.js";

export interface NoteCRUDTestConfig {
  resourceName: string;
  createParentResource: (client: any) => Promise<{ id: string }>;
  createNote: (client: any, parentResourceId: string) => Promise<any>;
  events: {
    list: { request: string; response: string };
    update: { request: string; response: string };
    delete: { request: string; response: string };
  };
  parentIdFieldName: string;
}

export function describeNoteCRUDTests(
  config: NoteCRUDTestConfig,
  getContext: () => { client: any; server: any },
): void {
  describe(`${config.resourceName} Note CRUD`, () => {
    it("success_when_note_created", async () => {
      const { client } = getContext();
      const parent = await config.createParentResource(client);
      const note = await config.createNote(client, parent.id);

      expect(note.id).toBeDefined();
      expect(note[config.parentIdFieldName]).toBe(parent.id);
    });

    it("success_when_note_list_returns_all", async () => {
      const { client } = getContext();
      const parent = await config.createParentResource(client);
      await config.createNote(client, parent.id);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<any, Record<string, any>>(
        client,
        config.events.list.request,
        config.events.list.response,
        { requestId: uuidv4(), canvasId },
      );

      expect(response.success).toBe(true);
      expect(response.notes!.length).toBeGreaterThanOrEqual(1);
    });

    it("success_when_note_updated", async () => {
      const { client } = getContext();
      const parent = await config.createParentResource(client);
      const note = await config.createNote(client, parent.id);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<any, Record<string, any>>(
        client,
        config.events.update.request,
        config.events.update.response,
        { requestId: uuidv4(), canvasId, noteId: note.id, x: 555 },
      );

      expect(response.success).toBe(true);
      expect(response.note!.x).toBe(555);
    });

    it("failed_when_note_update_with_nonexistent_id", async () => {
      const { client } = getContext();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<any, Record<string, any>>(
        client,
        config.events.update.request,
        config.events.update.response,
        { requestId: uuidv4(), canvasId, noteId: FAKE_UUID, x: 0 },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });

    it("success_when_note_deleted", async () => {
      const { client } = getContext();
      const parent = await config.createParentResource(client);
      const note = await config.createNote(client, parent.id);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<any, Record<string, any>>(
        client,
        config.events.delete.request,
        config.events.delete.response,
        { requestId: uuidv4(), canvasId, noteId: note.id },
      );

      expect(response.success).toBe(true);
      expect(response.noteId).toBe(note.id);
    });

    it("failed_when_note_delete_with_nonexistent_id", async () => {
      const { client } = getContext();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<any, Record<string, any>>(
        client,
        config.events.delete.request,
        config.events.delete.response,
        { requestId: uuidv4(), canvasId, noteId: FAKE_UUID },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });
  });
}
