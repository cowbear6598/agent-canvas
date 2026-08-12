import { randomUUID } from "crypto";
import { z } from "zod";
import { HTTP_STATUS } from "../constants.js";
import { getDb } from "../database/index.js";
import { WebSocketResponseEvents } from "../schemas/index.js";
import { connectionCommandService } from "../services/commands/connectionCommandService.js";
import { dispatchApplicationCommand } from "../services/commands/applicationCommand.js";
import { agentAccessTokenStore } from "../services/agentAccess/agentAccessTokenStore.js";
import { canvasStore } from "../services/canvasStore.js";
import { connectionStore } from "../services/connectionStore.js";
import { integrationAppStore } from "../services/integration/integrationAppStore.js";
import { managedMcpStore } from "../services/mcp/managedMcpStore.js";
import { managedPluginStore } from "../services/plugin/managedPluginRegistry.js";
import { podStore } from "../services/podStore.js";
import { createPodWithWorkspace } from "../services/podService.js";
import { providerRegistry } from "../services/provider/index.js";
import { repositoryService } from "../services/repositoryService.js";
import { runStore, type WorkflowRun } from "../services/runStore.js";
import { socketService } from "../services/socketService.js";
import { workspaceService } from "../services/workspace/index.js";
import { runExecutionService } from "../services/workflow/runExecutionService.js";
import {
  toConnectionPublic,
  toPodPublicView,
  type Pod,
  type ScheduleConfig,
} from "../types/index.js";
import { getResultErrorString } from "../types/result.js";
import { onRunChatComplete } from "../utils/chatCallbacks.js";
import { fireAndForget } from "../utils/operationHelpers.js";
import { launchRun } from "../utils/runChatHelpers.js";
import { jsonResponse, requireCanvas, requireJsonBody } from "./apiHelpers.js";

const podGoalSchema = z
  .object({
    todos: z
      .array(z.object({ id: z.string().min(1), text: z.string().min(1) }))
      .max(50),
  })
  .nullable();
const scheduleSchema = z.object({
  frequency: z.enum([
    "every-second",
    "every-x-minute",
    "every-x-hour",
    "every-day",
    "every-week",
  ]),
  second: z.number().int().min(0).max(59),
  intervalMinute: z.number().int().min(1).max(59),
  intervalHour: z.number().int().min(1).max(23),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7),
  enabled: z.boolean(),
});
const podCreateSchema = z.object({
  key: z.string().min(1).max(80).optional(),
  name: z.string().min(1).max(100),
  x: z.number().finite(),
  y: z.number().finite(),
  rotation: z.number().finite().default(0),
  goal: podGoalSchema.optional(),
  provider: z.enum(["claude", "codex", "opencode"]).optional(),
  providerConfig: z.record(z.string(), z.unknown()).optional(),
  fastModeEnabled: z.boolean().optional(),
  repositoryId: z.string().min(1).nullable().optional(),
  pluginIds: z.array(z.string().min(1)).max(50).optional(),
  mcpServerNames: z.array(z.string().min(1)).max(50).optional(),
  integrationBindings: z
    .array(
      z.object({
        provider: z.string().min(1),
        appId: z.string().min(1),
        resourceId: z.string().min(1),
        extra: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .max(20)
    .optional(),
  agentCanvasMcpEnabled: z.boolean().optional(),
  schedule: scheduleSchema.nullable().optional(),
});
const podPatchSchema = podCreateSchema
  .omit({ key: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "至少需要一個更新欄位");
const connectionCreateSchema = z.object({
  key: z.string().min(1).max(80).optional(),
  sourcePodId: z.string().min(1),
  targetPodId: z.string().min(1),
  sourceAnchor: z.enum(["top", "bottom", "left", "right"]).default("right"),
  targetAnchor: z.enum(["top", "bottom", "left", "right"]).default("left"),
  triggerMode: z.enum(["auto", "branch", "direct"]).optional(),
  direct: z.boolean().optional(),
  label: z.string().max(32).optional(),
  description: z.string().max(200).optional(),
  summaryModel: z.string().min(1).max(200).optional(),
  summaryProvider: z.enum(["claude", "codex", "opencode"]).optional(),
  summaryThinkingLevel: z.string().min(1).max(200).nullable().optional(),
  branchProvider: z.enum(["claude", "codex", "opencode"]).optional(),
  branchModel: z.string().min(1).max(200).optional(),
  branchThinkingLevel: z.string().min(1).max(200).nullable().optional(),
});
const connectionPatchSchema = z
  .object({
    triggerMode: z.enum(["auto", "branch", "direct"]).optional(),
    direct: z.boolean().optional(),
    label: z.string().max(32).optional(),
    description: z.string().max(200).nullable().optional(),
    summaryModel: z.string().min(1).max(200).optional(),
    summaryProvider: z.enum(["claude", "codex", "opencode"]).optional(),
    summaryThinkingLevel: z.string().min(1).max(200).nullable().optional(),
    branchProvider: z.enum(["claude", "codex", "opencode"]).nullable().optional(),
    branchModel: z.string().min(1).max(200).nullable().optional(),
    branchThinkingLevel: z.string().min(1).max(200).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "至少需要一個更新欄位");
const draftSchema = z.object({
  name: z.string().min(1).max(50),
  pods: z.array(podCreateSchema).min(1).max(50),
  connections: z.array(connectionCreateSchema).max(100).default([]),
  assumptions: z.array(z.string().max(500)).max(20).optional(),
});
type PodInput =
  | z.infer<typeof podCreateSchema>
  | z.infer<typeof podPatchSchema>;

function validationError(error: z.ZodError): Response {
  return jsonResponse(
    {
      error: "請求資料驗證失敗",
      details: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
    HTTP_STATUS.UNPROCESSABLE_ENTITY,
  );
}

async function parseBody<T>(
  req: Request,
  schema: z.ZodType<T>,
): Promise<{ data: T; error: null } | { data: null; error: Response }> {
  const formatError = requireJsonBody(req);
  if (formatError) return { data: null, error: formatError };
  const raw = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  return parsed.success
    ? { data: parsed.data, error: null }
    : { data: null, error: validationError(parsed.error) };
}

function requireAuthorizedCanvas(params: Record<string, string>):
  | { canvasId: string; error: null }
  | { canvasId: null; error: Response } {
  const found = requireCanvas(params.id ?? "");
  return found.error
    ? { canvasId: null, error: found.error }
    : { canvasId: found.canvas.id, error: null };
}

function emitPodUpdated(canvasId: string, pod: Pod): void {
  socketService.emitToCanvas(canvasId, WebSocketResponseEvents.POD_PROVIDER_SET, {
    requestId: randomUUID(),
    canvasId,
    success: true,
    pod: toPodPublicView(pod),
  });
}

function validateResourceBindings(
  input: PodInput,
): Response | null {
  if (input.pluginIds) {
    const available = new Set(managedPluginStore.list().map((item) => item.id));
    if (input.pluginIds.some((id) => !available.has(id))) {
      return jsonResponse({ error: "指定的 Skill 不存在" }, HTTP_STATUS.UNPROCESSABLE_ENTITY);
    }
  }
  if (input.mcpServerNames) {
    const available = new Set(
      managedMcpStore
        .list()
        .filter((item) => item.enabled)
        .map((item) => item.name),
    );
    if (input.mcpServerNames.some((name) => !available.has(name))) {
      return jsonResponse({ error: "指定的 MCP 不存在或未啟用" }, HTTP_STATUS.UNPROCESSABLE_ENTITY);
    }
  }
  if (input.integrationBindings) {
    const apps = new Map(integrationAppStore.list().map((app) => [app.id, app]));
    if (
      input.integrationBindings.some(
        (binding) => {
          const app = apps.get(binding.appId);
          return (
            app?.provider !== binding.provider ||
            app.connectionStatus !== "connected"
          );
        },
      )
    ) {
      return jsonResponse({ error: "指定的 Integration 不存在" }, HTTP_STATUS.UNPROCESSABLE_ENTITY);
    }
  }
  return null;
}

async function validatePodResources(input: PodInput): Promise<Response | null> {
  const bindingError = validateResourceBindings(input);
  if (bindingError) return bindingError;
  if (input.repositoryId && !(await repositoryService.exists(input.repositoryId))) {
    return jsonResponse(
      { error: "指定的 Repository 不存在" },
      HTTP_STATUS.UNPROCESSABLE_ENTITY,
    );
  }
  return null;
}

function normalizeSchedule(
  schedule: z.infer<typeof scheduleSchema> | null,
): ScheduleConfig | null {
  return schedule === null ? null : { ...schedule, lastTriggeredAt: null };
}

function applyIntegrationBindings(
  canvasId: string,
  podId: string,
  bindings: z.infer<typeof podCreateSchema>["integrationBindings"],
): void {
  if (!bindings) return;
  const existing = podStore.getById(canvasId, podId)?.integrationBindings ?? [];
  for (const binding of existing) {
    podStore.removeIntegrationBinding(canvasId, podId, binding.provider);
  }
  for (const binding of bindings) {
    podStore.addIntegrationBinding(canvasId, podId, binding);
  }
}

export async function handleAgentCanvasList(req: Request): Promise<Response> {
  const token = agentAccessTokenStore.resolveBearer(req)!;
  const allowed = new Set(token.canvasIds);
  return jsonResponse(
    { canvases: canvasStore.list().filter((canvas) => allowed.has(canvas.id)) },
    HTTP_STATUS.OK,
  );
}

export async function handleAgentCanvasGet(
  _req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const resolved = requireAuthorizedCanvas(params);
  if (resolved.error) return resolved.error;
  const canvas = canvasStore.getById(resolved.canvasId)!;
  return jsonResponse(
    {
      canvas,
      pods: podStore.list(canvas.id).map(toPodPublicView),
      connections: connectionStore.list(canvas.id).map(toConnectionPublic),
    },
    HTTP_STATUS.OK,
  );
}

export async function handleAgentCanvasCreate(req: Request): Promise<Response> {
  const parsed = await parseBody(req, z.object({ name: z.string().min(1).max(50) }));
  if (parsed.error) return parsed.error;
  const result = await canvasStore.create(parsed.data.name);
  if (!result.success) {
    return jsonResponse({ error: getResultErrorString(result.error) }, HTTP_STATUS.CONFLICT);
  }
  const token = agentAccessTokenStore.resolveBearer(req)!;
  agentAccessTokenStore.grantCanvas(token.id, result.data.id);
  socketService.emitToAll(WebSocketResponseEvents.CANVAS_CREATED, {
    requestId: randomUUID(),
    success: true,
    canvas: result.data,
  });
  return jsonResponse({ canvas: result.data }, HTTP_STATUS.CREATED);
}

export async function handleAgentPodList(
  _req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const resolved = requireAuthorizedCanvas(params);
  if (resolved.error) return resolved.error;
  return jsonResponse(
    { pods: podStore.list(resolved.canvasId).map(toPodPublicView) },
    HTTP_STATUS.OK,
  );
}

export async function handleAgentPodCreate(
  req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const resolved = requireAuthorizedCanvas(params);
  if (resolved.error) return resolved.error;
  const parsed = await parseBody(req, podCreateSchema.omit({ key: true }));
  if (parsed.error) return parsed.error;
  const resourceError = await validatePodResources(parsed.data);
  if (resourceError) return resourceError;
  const result = await createPodWithWorkspace(
    resolved.canvasId,
    parsed.data,
    randomUUID(),
  );
  if (!result.success) {
    return jsonResponse({ error: getResultErrorString(result.error) }, HTTP_STATUS.CONFLICT);
  }
  if (parsed.data.schedule !== undefined) {
    podStore.update(resolved.canvasId, result.data.pod.id, {
      schedule: normalizeSchedule(parsed.data.schedule),
    });
  }
  applyIntegrationBindings(
    resolved.canvasId,
    result.data.pod.id,
    parsed.data.integrationBindings,
  );
  const pod = podStore.getById(resolved.canvasId, result.data.pod.id)!;
  if (parsed.data.integrationBindings) emitPodUpdated(resolved.canvasId, pod);
  return jsonResponse({ pod: toPodPublicView(pod) }, HTTP_STATUS.CREATED);
}

export async function handleAgentPodUpdate(
  req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const resolved = requireAuthorizedCanvas(params);
  if (resolved.error) return resolved.error;
  const podId = params.podId ?? "";
  const existing = podStore.getById(resolved.canvasId, podId);
  if (!existing) return jsonResponse({ error: "找不到 Pod" }, HTTP_STATUS.NOT_FOUND);
  const parsed = await parseBody(req, podPatchSchema);
  if (parsed.error) return parsed.error;
  const resourceError = await validatePodResources(parsed.data);
  if (resourceError) return resourceError;
  const { integrationBindings, schedule, ...updates } = parsed.data;
  try {
    const updated = podStore.update(resolved.canvasId, podId, {
      ...updates,
      ...(schedule !== undefined && {
        schedule: normalizeSchedule(schedule),
      }),
    });
    if (!updated) return jsonResponse({ error: "找不到 Pod" }, HTTP_STATUS.NOT_FOUND);
    applyIntegrationBindings(resolved.canvasId, podId, integrationBindings);
    const pod = podStore.getById(resolved.canvasId, podId)!;
    emitPodUpdated(resolved.canvasId, pod);
    return jsonResponse({ pod: toPodPublicView(pod) }, HTTP_STATUS.OK);
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "更新 Pod 失敗" },
      HTTP_STATUS.UNPROCESSABLE_ENTITY,
    );
  }
}

export async function handleAgentConnectionList(
  _req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const resolved = requireAuthorizedCanvas(params);
  if (resolved.error) return resolved.error;
  return jsonResponse(
    { connections: connectionStore.list(resolved.canvasId).map(toConnectionPublic) },
    HTTP_STATUS.OK,
  );
}

export async function handleAgentConnectionCreate(
  req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const resolved = requireAuthorizedCanvas(params);
  if (resolved.error) return resolved.error;
  const parsed = await parseBody(req, connectionCreateSchema.omit({ key: true }));
  if (parsed.error) return parsed.error;
  const sourcePod = podStore.getById(resolved.canvasId, parsed.data.sourcePodId);
  const targetPod = podStore.getById(resolved.canvasId, parsed.data.targetPodId);
  if (!sourcePod || !targetPod) {
    return jsonResponse({ error: "來源或目標 Pod 不存在" }, HTTP_STATUS.UNPROCESSABLE_ENTITY);
  }
  try {
    const {
      triggerMode: rawTriggerMode,
      branchProvider,
      branchModel,
      branchThinkingLevel,
      ...connectionInput
    } = parsed.data;
    const triggerMode =
      rawTriggerMode === "direct" ? "auto" : rawTriggerMode;
    const result = connectionCommandService.create({
      canvasId: resolved.canvasId,
      requestId: randomUUID(),
      payload: {
        ...connectionInput,
        ...(triggerMode !== undefined && { triggerMode }),
        ...(rawTriggerMode === "direct" && { direct: true }),
        canvasId: resolved.canvasId,
        requestId: randomUUID(),
      },
      sourcePod,
      targetPod,
    });
    dispatchApplicationCommand(result);
    let connection = result.data.connection;
    if (
      connection &&
      (rawTriggerMode !== undefined ||
        branchProvider !== undefined ||
        branchModel !== undefined ||
        branchThinkingLevel !== undefined)
    ) {
      connection = connectionStore.update(resolved.canvasId, connection.id, {
        ...(triggerMode !== undefined && { triggerMode }),
        ...(rawTriggerMode === "direct" && { direct: true }),
        ...(branchProvider !== undefined && { branchProvider }),
        ...(branchModel !== undefined && { branchModel }),
        ...(branchThinkingLevel !== undefined && { branchThinkingLevel }),
      });
      if (connection) {
        socketService.emitToCanvas(
          resolved.canvasId,
          WebSocketResponseEvents.CONNECTION_UPDATED,
          {
            requestId: randomUUID(),
            canvasId: resolved.canvasId,
            success: true,
            connection: toConnectionPublic(connection),
            connections: [toConnectionPublic(connection)],
          },
        );
      }
    }
    return jsonResponse({ connection }, HTTP_STATUS.CREATED);
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "建立 Connection 失敗" },
      HTTP_STATUS.UNPROCESSABLE_ENTITY,
    );
  }
}

export async function handleAgentConnectionUpdate(
  req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const resolved = requireAuthorizedCanvas(params);
  if (resolved.error) return resolved.error;
  const connectionId = params.connectionId ?? "";
  if (!connectionStore.getById(resolved.canvasId, connectionId)) {
    return jsonResponse({ error: "找不到 Connection" }, HTTP_STATUS.NOT_FOUND);
  }
  const parsed = await parseBody(req, connectionPatchSchema);
  if (parsed.error) return parsed.error;
  try {
    const { triggerMode: rawTriggerMode, ...connectionUpdates } = parsed.data;
    const triggerMode =
      rawTriggerMode === "direct" ? "auto" : rawTriggerMode;
    const result = connectionStore.updateBranchSiblingSettings(
      resolved.canvasId,
      connectionId,
      {
        ...connectionUpdates,
        ...(triggerMode !== undefined && { triggerMode }),
        ...(rawTriggerMode === "direct" && { direct: true }),
      },
    );
    if (!result) return jsonResponse({ error: "找不到 Connection" }, HTTP_STATUS.NOT_FOUND);
    const connections = result.updatedConnections.map(toConnectionPublic);
    socketService.emitToCanvas(
      resolved.canvasId,
      WebSocketResponseEvents.CONNECTION_UPDATED,
      {
        requestId: randomUUID(),
        canvasId: resolved.canvasId,
        success: true,
        connection: toConnectionPublic(result.targetConnection),
        connections,
      },
    );
    return jsonResponse(
      { connection: toConnectionPublic(result.targetConnection), connections },
      HTTP_STATUS.OK,
    );
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "更新 Connection 失敗" },
      HTTP_STATUS.UNPROCESSABLE_ENTITY,
    );
  }
}

function buildWorkflowList(canvasId: string): Array<{
  podId: string;
  name: string;
  kind: "workflow" | "independent";
}> {
  const connections = connectionStore.list(canvasId);
  const targetIds = new Set(connections.map((connection) => connection.targetPodId));
  const sourceIds = new Set(connections.map((connection) => connection.sourcePodId));
  return podStore
    .list(canvasId)
    .filter((pod) => !targetIds.has(pod.id))
    .map((pod) => ({
      podId: pod.id,
      name: pod.name,
      kind: sourceIds.has(pod.id) ? "workflow" : "independent",
    }));
}

export async function handleAgentWorkflowList(
  _req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const resolved = requireAuthorizedCanvas(params);
  if (resolved.error) return resolved.error;
  return jsonResponse({ workflows: buildWorkflowList(resolved.canvasId) }, HTTP_STATUS.OK);
}

export function launchWorkflowAsync(
  canvasId: string,
  podId: string,
  message: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let accepted = false;
    const execution = launchRun({
      canvasId,
      podId,
      message,
      abortable: true,
      onRunContextCreated: (context) => {
        accepted = true;
        resolve(context.runId);
      },
      onComplete: (context) => onRunChatComplete(context, canvasId, podId),
    });
    execution.catch((error) => {
      if (!accepted) reject(error);
    });
    fireAndForget(execution.then(() => undefined), "Run", "AI 存取啟動 Workflow 失敗");
  });
}

export async function handleAgentWorkflowStart(
  req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const resolved = requireAuthorizedCanvas(params);
  if (resolved.error) return resolved.error;
  const podId = params.podId ?? "";
  if (!buildWorkflowList(resolved.canvasId).some((item) => item.podId === podId)) {
    return jsonResponse({ error: "只能啟動 Workflow 源頭 Pod" }, HTTP_STATUS.CONFLICT);
  }
  const parsed = await parseBody(req, z.object({ message: z.string().min(1).max(20_000) }));
  if (parsed.error) return parsed.error;
  try {
    const runId = await launchWorkflowAsync(resolved.canvasId, podId, parsed.data.message);
    return jsonResponse({ accepted: true, runId }, HTTP_STATUS.ACCEPTED);
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "啟動 Workflow 失敗" },
      HTTP_STATUS.CONFLICT,
    );
  }
}

function toRunStatus(run: WorkflowRun): Record<string, unknown> {
  return {
    id: run.id,
    canvasId: run.canvasId,
    sourcePodId: run.sourcePodId,
    status: run.status,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    podInstances: runStore.getPodInstancesByRunId(run.id).map((instance) => ({
      podId: instance.podId,
      status: instance.status,
      errorMessage: instance.errorMessage,
      triggeredAt: instance.triggeredAt,
      completedAt: instance.completedAt,
    })),
  };
}

export async function handleAgentRunGet(
  _req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const resolved = requireAuthorizedCanvas(params);
  if (resolved.error) return resolved.error;
  const run = runStore.getRun(params.runId ?? "");
  if (!run || run.canvasId !== resolved.canvasId) {
    return jsonResponse({ error: "找不到 Run" }, HTTP_STATUS.NOT_FOUND);
  }
  return jsonResponse({ run: toRunStatus(run) }, HTTP_STATUS.OK);
}

export async function handleAgentRunStop(
  _req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const resolved = requireAuthorizedCanvas(params);
  if (resolved.error) return resolved.error;
  const run = runStore.getRun(params.runId ?? "");
  if (!run || run.canvasId !== resolved.canvasId) {
    return jsonResponse({ error: "找不到 Run" }, HTTP_STATUS.NOT_FOUND);
  }
  if (run.status !== "running") {
    return jsonResponse({ error: "只能停止仍在執行的 Run" }, HTTP_STATUS.CONFLICT);
  }
  await runExecutionService.deleteRun(run.id);
  return jsonResponse({ success: true, runId: run.id }, HTTP_STATUS.OK);
}

export async function handleAgentResourceList(
  _req: Request,
  params: Record<string, string>,
): Promise<Response> {
  switch (params.kind) {
    case "providers":
      return jsonResponse(
        {
          providers: Object.entries(providerRegistry).map(([id, provider]) => ({
            id,
            name: provider.metadata.name,
            defaultOptions: provider.metadata.defaultOptions,
            availableModels: provider.metadata.availableModels,
          })),
        },
        HTTP_STATUS.OK,
      );
    case "repositories":
      return jsonResponse({ repositories: await repositoryService.list() }, HTTP_STATUS.OK);
    case "skills":
      return jsonResponse(
        {
          skills: managedPluginStore.list().map((item) => ({
            id: item.id,
            name: item.displayName ?? item.id,
            description: item.description,
          })),
        },
        HTTP_STATUS.OK,
      );
    case "mcp":
      return jsonResponse(
        {
          mcp: managedMcpStore.list().map((item) => ({
            id: item.id,
            name: item.name,
            transport: item.transport,
            enabled: item.enabled,
          })),
        },
        HTTP_STATUS.OK,
      );
    case "integrations":
      return jsonResponse(
        {
          integrations: integrationAppStore
            .list()
            .filter((item) => item.connectionStatus === "connected")
            .map((item) => ({
              id: item.id,
              provider: item.provider,
              name: item.name,
              resources: item.resources.map((resource) => ({
                id: resource.id,
                name: resource.name,
              })),
            })),
        },
        HTTP_STATUS.OK,
      );
    default:
      return jsonResponse({ error: "不支援的資源類型" }, HTTP_STATUS.NOT_FOUND);
  }
}

export async function handleAgentDraftCreate(req: Request): Promise<Response> {
  const parsed = await parseBody(req, draftSchema);
  if (parsed.error) return parsed.error;
  for (const pod of parsed.data.pods) {
    const resourceError = await validatePodResources(pod);
    if (resourceError) return resourceError;
  }
  const keys = parsed.data.pods.map((pod, index) => pod.key ?? String(index));
  if (new Set(keys).size !== keys.length) {
    return jsonResponse({ error: "Pod key 不可重複" }, HTTP_STATUS.UNPROCESSABLE_ENTITY);
  }

  const canvasResult = await canvasStore.create(parsed.data.name);
  if (!canvasResult.success) {
    return jsonResponse(
      { error: getResultErrorString(canvasResult.error) },
      HTTP_STATUS.CONFLICT,
    );
  }
  const canvas = canvasResult.data;
  const createdPods: Pod[] = [];
  try {
    getDb().transaction(() => {
      const keyMap = new Map<string, string>();
      parsed.data.pods.forEach((input, index) => {
        const {
          key: _key,
          integrationBindings: _bindings,
          schedule,
          ...createInput
        } = input;
        const created = podStore.create(canvas.id, createInput).pod;
        if (schedule !== undefined) {
          podStore.update(canvas.id, created.id, {
            schedule: normalizeSchedule(schedule),
          });
        }
        createdPods.push(created);
        keyMap.set(keys[index], created.id);
      });
      parsed.data.connections.forEach((input) => {
        const sourcePodId = keyMap.get(input.sourcePodId) ?? input.sourcePodId;
        const targetPodId = keyMap.get(input.targetPodId) ?? input.targetPodId;
        if (!podStore.getById(canvas.id, sourcePodId) || !podStore.getById(canvas.id, targetPodId)) {
          throw new Error("Connection 指向不存在的 Pod key");
        }
        connectionStore.create(canvas.id, { ...input, sourcePodId, targetPodId });
      });
      parsed.data.pods.forEach((input, index) =>
        applyIntegrationBindings(canvas.id, createdPods[index].id, input.integrationBindings),
      );
    })();

    for (const pod of createdPods) {
      const workspaceResult = await workspaceService.createWorkspace(pod.workspacePath);
      if (!workspaceResult.success) throw new Error("建立 Pod 工作區失敗");
    }
  } catch (error) {
    await canvasStore.delete(canvas.id);
    for (const pod of createdPods) await workspaceService.deleteWorkspace(pod.workspacePath);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "建立草稿失敗" },
      HTTP_STATUS.UNPROCESSABLE_ENTITY,
    );
  }

  const token = agentAccessTokenStore.resolveBearer(req)!;
  agentAccessTokenStore.grantCanvas(token.id, canvas.id);
  const pods = podStore.list(canvas.id).map(toPodPublicView);
  const connections = connectionStore.list(canvas.id).map(toConnectionPublic);
  socketService.emitToAll(WebSocketResponseEvents.CANVAS_CREATED, {
    requestId: randomUUID(),
    success: true,
    canvas,
  });
  return jsonResponse(
    { canvas, pods, connections, assumptions: parsed.data.assumptions ?? [] },
    HTTP_STATUS.CREATED,
  );
}

export { buildWorkflowList, toRunStatus };
