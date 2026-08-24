import { createWebSocketRequest } from "@/services/websocket/createWebSocketRequest";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/types/websocket/events";
import type {
  PodCodexSkillsListPayload,
  PodSetCodexSkillsPayload,
} from "@/types/websocket/requests";
import type {
  PodCodexSkillsListResultPayload,
  PodCodexSkillsSetPayload,
} from "@/types/websocket/responses";

export function listPodCodexSkills(
  canvasId: string,
  podId: string,
  forceReload = false,
): Promise<PodCodexSkillsListResultPayload> {
  return createWebSocketRequest<
    PodCodexSkillsListPayload,
    PodCodexSkillsListResultPayload
  >({
    requestEvent: WebSocketRequestEvents.POD_CODEX_SKILLS_LIST,
    responseEvent: WebSocketResponseEvents.POD_CODEX_SKILLS_LIST_RESULT,
    payload: { canvasId, podId, forceReload },
  });
}

export function updatePodCodexSkills(
  canvasId: string,
  podId: string,
  skillKeys: string[],
): Promise<PodCodexSkillsSetPayload> {
  return createWebSocketRequest<
    PodSetCodexSkillsPayload,
    PodCodexSkillsSetPayload
  >({
    requestEvent: WebSocketRequestEvents.POD_SET_CODEX_SKILLS,
    responseEvent: WebSocketResponseEvents.POD_CODEX_SKILLS_SET,
    payload: { canvasId, podId, skillKeys },
  });
}
