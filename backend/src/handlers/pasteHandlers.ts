import { WebSocketResponseEvents } from "../schemas";
import type {
  CanvasPasteResultPayload,
  PasteError,
  RepositoryNote,
} from "../types";
import { toConnectionPublic, toPodPublicView } from "../types/index.js";
import type { CanvasPastePayload } from "../schemas";
import { socketService } from "../services/socketService.js";
import { logger } from "../utils/logger.js";
import { withCanvasId } from "../utils/handlerHelpers.js";
import {
  createPastedPods,
  createPastedNotesByType,
  createPastedConnections,
} from "./paste/pasteHelpers.js";

export const handleCanvasPaste = withCanvasId<CanvasPastePayload>(
  WebSocketResponseEvents.CANVAS_PASTE_RESULT,
  async (
    _connectionId: string,
    canvasId: string,
    payload: CanvasPastePayload,
    requestId: string,
  ): Promise<void> => {
    const { pods, repositoryNotes, connections } = payload;

    const podIdMapping: Record<string, string> = {};
    const errors: PasteError[] = [];

    const createdPods = await createPastedPods(
      canvasId,
      pods,
      podIdMapping,
      errors,
    );

    const noteResultMap = {
      repository: createPastedNotesByType(
        "repository",
        canvasId,
        repositoryNotes,
        podIdMapping,
      ),
    };

    errors.push(...Object.values(noteResultMap).flatMap((r) => r.errors));

    const connectionResult = createPastedConnections(
      canvasId,
      connections,
      podIdMapping,
    );
    const createdConnections = connectionResult.createdConnections;
    errors.push(...connectionResult.errors);

    const response: CanvasPasteResultPayload = {
      canvasId,
      requestId,
      success: errors.length === 0,
      createdPods: createdPods.map(toPodPublicView),
      createdRepositoryNotes: noteResultMap.repository
        .notes as RepositoryNote[],
      createdConnections: createdConnections.map(toConnectionPublic),
      podIdMapping,
      errors,
    };

    if (errors.length > 0) {
      response.error = `貼上完成，但有 ${errors.length} 個錯誤`;
    }

    socketService.emitToCanvas(
      canvasId,
      WebSocketResponseEvents.CANVAS_PASTE_RESULT,
      response,
    );

    const pasteItems: string[] = [];
    if (createdPods.length > 0) pasteItems.push(`${createdPods.length} pod`);
    if (response.createdRepositoryNotes.length > 0)
      pasteItems.push(`${response.createdRepositoryNotes.length} repository`);
    if (createdConnections.length > 0)
      pasteItems.push(`${createdConnections.length} connection`);
    if (errors.length > 0) pasteItems.push(`${errors.length} 個錯誤`);

    logger.log("Paste", "Complete", `貼上成功：${pasteItems.join("、")}`);
  },
);
