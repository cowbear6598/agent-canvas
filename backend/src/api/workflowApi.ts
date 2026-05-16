import {
  jsonResponse,
  requireCanvas,
  resolvePod,
  requireJsonBody,
  UUID_REGEX,
} from "./apiHelpers.js";
import { podStore } from "../services/podStore.js";
import { connectionStore } from "../services/connectionStore.js";
import { abortRegistry } from "../services/provider/abortRegistry.js";
import { onRunChatComplete } from "../utils/chatCallbacks.js";
import { logger } from "../utils/logger.js";
import { HTTP_STATUS } from "../constants.js";
import type { Pod, ContentBlock } from "../types/index.js";
import type { Connection } from "../types/connection.js";
import {
  contentBlockSchema,
  MAX_MESSAGE_LENGTH,
} from "../schemas/chatSchemas.js";
import { z } from "zod";
import { launchRun } from "../utils/runChatHelpers.js";

/**
 * 安全解碼 URL 中的 podId 參數，並驗證格式是否合法（UUID 或 pod 名稱）。
 * 若解碼失敗或格式不合法，回傳 null。
 */
function decodePodId(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // 非法的 % 序列（如 %2G、雙重編碼殘留等）
    return null;
  }
  if (UUID_REGEX.test(decoded)) return decoded;
  // pod 名稱長度上限與 resolvePod 一致
  if (decoded.length > 0 && decoded.length <= 100) return decoded;
  return null;
}

interface WorkflowNode {
  pod: Pod;
  connections: Connection[];
  children: WorkflowNode[];
}

interface WorkflowInfo {
  workflowId: string;
  entryPod: Pod;
  nodes: WorkflowNode;
}

function buildWorkflowNode(
  pod: Pod,
  adjacencyMap: Map<string, Connection[]>,
  podMap: Map<string, Pod>,
  visited: Set<string>,
): WorkflowNode {
  visited.add(pod.id);

  const outboundConnections = adjacencyMap.get(pod.id) ?? [];
  const children: WorkflowNode[] = [];

  for (const connection of outboundConnections) {
    const targetPod = podMap.get(connection.targetPodId);
    if (!targetPod || visited.has(targetPod.id)) continue;

    children.push(buildWorkflowNode(targetPod, adjacencyMap, podMap, visited));
  }

  return { pod, connections: outboundConnections, children };
}

export function buildWorkflows(canvasId: string): WorkflowInfo[] {
  const pods = podStore.list(canvasId);
  const connections = connectionStore.list(canvasId);

  const podMap = new Map<string, Pod>(pods.map((pod) => [pod.id, pod]));

  const adjacencyMap = new Map<string, Connection[]>();
  const inboundSet = new Set<string>();

  for (const connection of connections) {
    const existing = adjacencyMap.get(connection.sourcePodId) ?? [];
    existing.push(connection);
    adjacencyMap.set(connection.sourcePodId, existing);
    inboundSet.add(connection.targetPodId);
  }

  const entryPods = pods.filter(
    (pod) => !inboundSet.has(pod.id) && !pod.integrationBindings?.length,
  );

  return entryPods.map((entryPod) => {
    const visited = new Set<string>();
    const nodes = buildWorkflowNode(entryPod, adjacencyMap, podMap, visited);
    return {
      workflowId: entryPod.id,
      entryPod,
      nodes,
    };
  });
}

const messageSchema = z.union([
  z.string().min(1).max(MAX_MESSAGE_LENGTH),
  z.array(contentBlockSchema).min(1),
]);

function validateMessage(message: unknown): string | null {
  const result = messageSchema.safeParse(message);
  if (!result.success) return "訊息格式錯誤";
  return null;
}

export function handleListWorkflows(
  _req: Request,
  params: Record<string, string>,
): Response {
  const { canvas, error } = requireCanvas(params.id);
  if (error) return error;

  const workflows = buildWorkflows(canvas.id);
  return jsonResponse({ workflows }, HTTP_STATUS.OK);
}

export async function handleWorkflowChat(
  req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const { canvas, error } = requireCanvas(params.id);
  if (error) return error;

  const jsonError = requireJsonBody(req);
  if (jsonError) return jsonError;

  const podIdDecoded = decodePodId(params.podId);
  if (!podIdDecoded) {
    return jsonResponse(
      { error: "無效的 Pod ID 格式" },
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const pod = resolvePod(canvas.id, podIdDecoded);
  if (!pod) {
    return jsonResponse({ error: "找不到 Pod" }, HTTP_STATUS.NOT_FOUND);
  }

  const inboundConnections = connectionStore.findByTargetPodId(
    canvas.id,
    pod.id,
  );
  if (inboundConnections.length > 0) {
    return jsonResponse(
      { error: "此 Pod 不是 Workflow 入口，無法直接發送訊息" },
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  if (pod.integrationBindings?.length) {
    return jsonResponse(
      { error: "Pod 已連接外部服務，無法手動發送訊息" },
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const body = (await req.json()) as Record<string, unknown>;
  const { message } = body;

  const messageError = validateMessage(message);
  if (messageError) {
    return jsonResponse({ error: messageError }, HTTP_STATUS.BAD_REQUEST);
  }

  const typedMessage = message as string | ContentBlock[];
  const podName = pod.name;
  const canvasId = canvas.id;
  const podId = pod.id;

  void (async (): Promise<void> => {
    try {
      await launchRun({
        canvasId,
        podId,
        message: typedMessage,
        abortable: true,
        commandNotFoundBehavior: "skip",
        onComplete: (runContext) =>
          onRunChatComplete(runContext, canvasId, podId),
      });
    } catch (err) {
      logger.error(
        "Chat",
        "Error",
        `Pod「${podName}」REST API 發送訊息失敗`,
        err,
      );
    }
  })();

  return jsonResponse({ success: true, podId: pod.id }, HTTP_STATUS.ACCEPTED);
}

export function handleWorkflowStop(
  _req: Request,
  params: Record<string, string>,
): Response {
  const { canvas, error } = requireCanvas(params.id);
  if (error) return error;

  const podIdDecoded = decodePodId(params.podId);
  if (!podIdDecoded) {
    return jsonResponse(
      { error: "無效的 Pod ID 格式" },
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const pod = resolvePod(canvas.id, podIdDecoded);
  if (!pod) {
    return jsonResponse({ error: "找不到 Pod" }, HTTP_STATUS.NOT_FOUND);
  }

  const aborted = abortRegistry.abortByPodId(pod.id);

  if (!aborted) {
    return jsonResponse({ error: "找不到活躍的查詢" }, HTTP_STATUS.CONFLICT);
  }

  return jsonResponse({ success: true }, HTTP_STATUS.OK);
}
