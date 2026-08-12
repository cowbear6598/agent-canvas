import { HTTP_STATUS } from "../constants.js";
import {
  buildWorkflowList,
  launchWorkflowAsync,
  toRunStatus,
} from "./agentCanvasApi.js";
import { verifyAgentCanvasCapability } from "../services/agentAccess/agentCanvasCapability.js";
import { podStore } from "../services/podStore.js";
import { runStore } from "../services/runStore.js";
import { runExecutionService } from "../services/workflow/runExecutionService.js";
import { jsonResponse, requireJsonBody } from "./apiHelpers.js";

interface CapabilityRequest {
  capabilityToken?: unknown;
  operation?: unknown;
  input?: unknown;
}

export async function handleInternalAgentCanvas(req: Request): Promise<Response> {
  const formatError = requireJsonBody(req);
  if (formatError) return formatError;
  const body = (await req.json().catch(() => null)) as CapabilityRequest | null;
  if (
    !body ||
    typeof body.capabilityToken !== "string" ||
    typeof body.operation !== "string"
  ) {
    return jsonResponse({ error: "capabilityToken 與 operation 為必填" }, HTTP_STATUS.BAD_REQUEST);
  }

  let scope;
  try {
    scope = verifyAgentCanvasCapability(body.capabilityToken);
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Capability 驗證失敗" },
      HTTP_STATUS.FORBIDDEN,
    );
  }
  const ownerRun = runStore.getRun(scope.runId);
  const ownerPod = podStore.getById(scope.canvasId, scope.podId);
  if (
    !ownerRun ||
    ownerRun.canvasId !== scope.canvasId ||
    ownerRun.status !== "running" ||
    !ownerPod?.agentCanvasMcpEnabled
  ) {
    return jsonResponse({ error: "Capability 所屬 Run 已結束或不再有效" }, HTTP_STATUS.FORBIDDEN);
  }

  const input =
    body.input && typeof body.input === "object"
      ? (body.input as Record<string, unknown>)
      : {};
  switch (body.operation) {
    case "search_workflows": {
      const query = typeof input.query === "string" ? input.query.trim().toLowerCase() : "";
      const workflows = buildWorkflowList(scope.canvasId).filter(
        (item) => !query || item.name.toLowerCase().includes(query),
      );
      return jsonResponse({ success: true, workflows }, HTTP_STATUS.OK);
    }
    case "start_workflow": {
      const podId = typeof input.podId === "string" ? input.podId : "";
      const message = typeof input.message === "string" ? input.message.trim() : "";
      if (!message || !buildWorkflowList(scope.canvasId).some((item) => item.podId === podId)) {
        return jsonResponse(
          { error: "只能以明確訊息啟動目前 Canvas 的 Workflow 源頭 Pod" },
          HTTP_STATUS.CONFLICT,
        );
      }
      const runId = await launchWorkflowAsync(scope.canvasId, podId, message);
      return jsonResponse({ success: true, accepted: true, runId }, HTTP_STATUS.ACCEPTED);
    }
    case "get_run": {
      const runId = typeof input.runId === "string" ? input.runId : "";
      const run = runStore.getRun(runId);
      if (!run || run.canvasId !== scope.canvasId) {
        return jsonResponse({ error: "找不到 Run" }, HTTP_STATUS.NOT_FOUND);
      }
      return jsonResponse({ success: true, run: toRunStatus(run) }, HTTP_STATUS.OK);
    }
    case "stop_run": {
      const runId = typeof input.runId === "string" ? input.runId : "";
      const run = runStore.getRun(runId);
      if (!run || run.canvasId !== scope.canvasId) {
        return jsonResponse({ error: "找不到 Run" }, HTTP_STATUS.NOT_FOUND);
      }
      if (run.status !== "running") {
        return jsonResponse({ error: "只能停止仍在執行的 Run" }, HTTP_STATUS.CONFLICT);
      }
      await runExecutionService.deleteRun(runId);
      return jsonResponse({ success: true, runId }, HTTP_STATUS.OK);
    }
    default:
      return jsonResponse({ error: "不支援的 operation" }, HTTP_STATUS.NOT_FOUND);
  }
}
