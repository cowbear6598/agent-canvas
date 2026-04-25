import { WebSocketResponseEvents } from "../schemas";
import type {
  CanvasPasteResultPayload,
  PasteError,
  SkillNote,
  RepositoryNote,
  SubAgentNote,
  CommandNote,
  McpServerNote,
  Pod,
} from "../types";
import type { CanvasPastePayload } from "../schemas";
import { socketService } from "../services/socketService.js";
import { logger } from "../utils/logger.js";
import { withCanvasId } from "../utils/handlerHelpers.js";
import {
  createPastedPods,
  createPastedNotesByType,
  createPastedConnections,
} from "./paste/pasteHelpers.js";
import { podStore } from "../services/podStore.js";

function syncBoundNotesToPod<TNote extends { boundToPodId: string | null }>(
  canvasId: string,
  notes: TNote[],
  getResourceId: (note: TNote) => string,
  shouldUpdate: (pod: Pod, resourceId: string) => boolean,
  updatePod: (canvasId: string, podId: string, resourceId: string) => void,
): void {
  for (const note of notes) {
    if (!note.boundToPodId) continue;
    const pod = podStore.getById(canvasId, note.boundToPodId);
    if (pod && shouldUpdate(pod, getResourceId(note))) {
      updatePod(canvasId, note.boundToPodId, getResourceId(note));
    }
  }
}

export const handleCanvasPaste = withCanvasId<CanvasPastePayload>(
  WebSocketResponseEvents.CANVAS_PASTE_RESULT,
  async (
    _connectionId: string,
    canvasId: string,
    payload: CanvasPastePayload,
    requestId: string,
  ): Promise<void> => {
    const {
      pods,
      skillNotes,
      repositoryNotes,
      subAgentNotes,
      commandNotes,
      mcpServerNotes,
      connections,
    } = payload;

    const podIdMapping: Record<string, string> = {};
    const errors: PasteError[] = [];

    const createdPods = await createPastedPods(
      canvasId,
      pods,
      podIdMapping,
      errors,
    );

    const noteResultMap = {
      skill: createPastedNotesByType(
        "skill",
        canvasId,
        skillNotes,
        podIdMapping,
      ),
      repository: createPastedNotesByType(
        "repository",
        canvasId,
        repositoryNotes,
        podIdMapping,
      ),
      subAgent: createPastedNotesByType(
        "subAgent",
        canvasId,
        subAgentNotes,
        podIdMapping,
      ),
      command: createPastedNotesByType(
        "command",
        canvasId,
        commandNotes ?? [],
        podIdMapping,
      ),
      mcpServer: createPastedNotesByType(
        "mcpServer",
        canvasId,
        mcpServerNotes ?? [],
        podIdMapping,
      ),
    };

    errors.push(...Object.values(noteResultMap).flatMap((r) => r.errors));

    const createdConnections = createPastedConnections(
      canvasId,
      connections,
      podIdMapping,
    );

    syncBoundNotesToPod(
      canvasId,
      noteResultMap.command.notes as CommandNote[],
      (note) => note.commandId,
      (pod) => !pod.commandId,
      (cId, pId, cmdId) => podStore.setCommandId(cId, pId, cmdId),
    );

    syncBoundNotesToPod(
      canvasId,
      noteResultMap.mcpServer.notes as McpServerNote[],
      (note) => note.mcpServerId,
      (pod, mcpId) => !pod.mcpServerIds.includes(mcpId),
      (cId, pId, mcpId) => podStore.addMcpServerId(cId, pId, mcpId),
    );

    const response: CanvasPasteResultPayload = {
      requestId,
      success: errors.length === 0,
      createdPods,
      createdSkillNotes: noteResultMap.skill.notes as SkillNote[],
      createdRepositoryNotes: noteResultMap.repository
        .notes as RepositoryNote[],
      createdSubAgentNotes: noteResultMap.subAgent.notes as SubAgentNote[],
      createdCommandNotes: noteResultMap.command.notes as CommandNote[],
      createdMcpServerNotes: noteResultMap.mcpServer.notes as McpServerNote[],
      createdConnections,
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
    if (response.createdSkillNotes.length > 0)
      pasteItems.push(`${response.createdSkillNotes.length} skill`);
    if (response.createdRepositoryNotes.length > 0)
      pasteItems.push(`${response.createdRepositoryNotes.length} repository`);
    if (response.createdSubAgentNotes.length > 0)
      pasteItems.push(`${response.createdSubAgentNotes.length} subagent`);
    if (response.createdCommandNotes.length > 0)
      pasteItems.push(`${response.createdCommandNotes.length} command`);
    if (response.createdMcpServerNotes.length > 0)
      pasteItems.push(`${response.createdMcpServerNotes.length} mcp server`);
    if (createdConnections.length > 0)
      pasteItems.push(`${createdConnections.length} connection`);
    if (errors.length > 0) pasteItems.push(`${errors.length} 個錯誤`);

    logger.log("Paste", "Complete", `貼上成功：${pasteItems.join("、")}`);
  },
);
