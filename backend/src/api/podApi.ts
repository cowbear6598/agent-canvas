import { podStore } from "../services/podStore.js";
import {
  jsonResponse,
  requireCanvas,
  resolvePod,
  requireJsonBody,
} from "./apiHelpers.js";
import {
  createPodWithWorkspace,
  deletePodWithCleanup,
} from "../services/podService.js";
import { logger } from "../utils/logger.js";
import type { ProviderName } from "../services/provider/types.js";
import { HTTP_STATUS } from "../constants.js";
import { socketService } from "../services/socketService.js";
import { WebSocketResponseEvents } from "../schemas/index.js";
import { getResultErrorString } from "../types/result.js";
import { toPodPublicView } from "../types/pod.js";

/** REST API 的 model 便捷欄位：Claude provider 僅允許短名，方便向後相容 */
const VALID_CLAUDE_MODELS = ["opus", "sonnet", "haiku"] as const;
const VALID_PROVIDERS: ProviderName[] = ["claude", "codex", "gemini"];
/** providerConfig 允許的 key 白名單 */
const PROVIDER_CONFIG_ALLOWED_KEYS = ["model"] as const;

interface ValidatedCreatePodBody {
  name: string;
  x: number;
  y: number;
  provider?: ProviderName;
  providerConfig?: Record<string, unknown>;
}

function validatePodName(data: Record<string, unknown>): string | null {
  if (!data.name || typeof data.name !== "string" || data.name.trim() === "") {
    return "Pod 名稱不能為空";
  }
  if (data.name.trim().length > 100) {
    return "Pod 名稱不能超過 100 個字元";
  }
  return null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const COORDINATE_RANGE = { min: -100000, max: 100000 };

function isInCoordinateRange(value: number): boolean {
  return value >= COORDINATE_RANGE.min && value <= COORDINATE_RANGE.max;
}

function validatePodCoordinates(data: Record<string, unknown>): string | null {
  if (
    !isFiniteNumber(data.x) ||
    !isFiniteNumber(data.y) ||
    !isInCoordinateRange(data.x) ||
    !isInCoordinateRange(data.y)
  ) {
    return "必須提供有效的 x 和 y 座標";
  }
  return null;
}

/**
 * 驗證 REST API 傳入的 model 便捷欄位（僅支援 Claude 短名）。
 * 若同時傳了 providerConfig.model，以 providerConfig.model 為主，model 欄位忽略。
 */
function validatePodModel(data: Record<string, unknown>): string | null {
  if (
    data.model !== undefined &&
    !VALID_CLAUDE_MODELS.includes(
      data.model as (typeof VALID_CLAUDE_MODELS)[number],
    )
  ) {
    return "無效的模型類型";
  }
  return null;
}

function validatePodProvider(data: Record<string, unknown>): string | null {
  if (
    data.provider !== undefined &&
    !VALID_PROVIDERS.includes(data.provider as ProviderName)
  ) {
    return `無效的 provider，只允許：${VALID_PROVIDERS.join(", ")}`;
  }
  return null;
}

function validatePodProviderConfig(
  data: Record<string, unknown>,
): string | null {
  if (data.providerConfig === undefined) return null;
  if (
    typeof data.providerConfig !== "object" ||
    data.providerConfig === null ||
    Array.isArray(data.providerConfig)
  ) {
    return "providerConfig 必須是物件";
  }
  const config = data.providerConfig as Record<string, unknown>;
  const invalidKeys = Object.keys(config).filter(
    (k) =>
      !PROVIDER_CONFIG_ALLOWED_KEYS.includes(
        k as (typeof PROVIDER_CONFIG_ALLOWED_KEYS)[number],
      ),
  );
  if (invalidKeys.length > 0) {
    return `providerConfig 含有不允許的欄位：${invalidKeys.join(", ")}`;
  }
  return null;
}

function validateCreatePodBody(
  data: Record<string, unknown>,
): { error: string } | ValidatedCreatePodBody {
  const nameError = validatePodName(data);
  if (nameError) return { error: nameError };

  const coordinatesError = validatePodCoordinates(data);
  if (coordinatesError) return { error: coordinatesError };

  const modelError = validatePodModel(data);
  if (modelError) return { error: modelError };

  const providerError = validatePodProvider(data);
  if (providerError) return { error: providerError };

  const providerConfigError = validatePodProviderConfig(data);
  if (providerConfigError) return { error: providerConfigError };

  const name = (data.name as string).trim();
  const provider =
    data.provider !== undefined ? (data.provider as ProviderName) : undefined;

  // REST API 的 model 便捷欄位：若 providerConfig.model 未指定，則使用 model 欄位作為 providerConfig.model
  let providerConfig: Record<string, unknown> | undefined =
    data.providerConfig !== undefined
      ? (data.providerConfig as Record<string, unknown>)
      : undefined;

  if (data.model !== undefined && providerConfig === undefined) {
    providerConfig = { model: data.model as string };
  }

  return {
    name,
    x: data.x as number,
    y: data.y as number,
    provider,
    providerConfig,
  };
}

export function handleListPods(
  _req: Request,
  params: Record<string, string>,
): Response {
  const { canvas, error } = requireCanvas(params.id);
  if (error) return error;

  const pods = podStore.list(canvas.id);
  return jsonResponse({ pods }, HTTP_STATUS.OK);
}

export async function handleCreatePod(
  req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const jsonError = requireJsonBody(req);
  if (jsonError) return jsonError;

  const body = await req.json();

  const { canvas, error } = requireCanvas(params.id);
  if (error) return error;

  const validated = validateCreatePodBody(body as Record<string, unknown>);
  if ("error" in validated) {
    return jsonResponse({ error: validated.error }, HTTP_STATUS.BAD_REQUEST);
  }

  // 預檢：讓常見的重複名稱情境快速回錯，不需等到 DB 插入
  if (podStore.hasName(canvas.id, validated.name)) {
    return jsonResponse(
      { error: "同一 Canvas 下已存在相同名稱的 Pod" },
      HTTP_STATUS.CONFLICT,
    );
  }

  let result: Awaited<ReturnType<typeof createPodWithWorkspace>>;
  try {
    result = await createPodWithWorkspace(
      canvas.id,
      {
        name: validated.name,
        x: validated.x,
        y: validated.y,
        rotation: 0,
        provider: validated.provider,
        providerConfig: validated.providerConfig,
      },
      "system",
    );
  } catch (e) {
    // 並發請求同時通過預檢時，DB 的 UNIQUE 約束會擋下後者
    // Bun SQLite 的 UNIQUE 違反 error.code 為 "SQLITE_CONSTRAINT_UNIQUE"
    if (
      e instanceof Error &&
      (e as NodeJS.ErrnoException).code === "SQLITE_CONSTRAINT_UNIQUE"
    ) {
      return jsonResponse({ error: "Pod 名稱已存在" }, HTTP_STATUS.CONFLICT);
    }
    throw e;
  }

  if (!result.success) {
    logger.error(
      "Pod",
      "Error",
      "建立 Pod 失敗",
      getResultErrorString(result.error),
    );
    return jsonResponse(
      { error: "建立 Pod 時發生內部錯誤" },
      HTTP_STATUS.INTERNAL_ERROR,
    );
  }

  return jsonResponse({ pod: result.data.pod }, HTTP_STATUS.CREATED);
}

export async function handleRenamePod(
  req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const jsonError = requireJsonBody(req);
  if (jsonError) return jsonError;

  const body = (await req.json()) as Record<string, unknown>;

  const { canvas, error } = requireCanvas(params.id);
  if (error) return error;

  const pod = resolvePod(canvas.id, decodeURIComponent(params.podId));
  if (!pod) {
    return jsonResponse({ error: "找不到 Pod" }, HTTP_STATUS.NOT_FOUND);
  }

  const nameError = validatePodName(body);
  if (nameError) {
    return jsonResponse({ error: nameError }, HTTP_STATUS.BAD_REQUEST);
  }

  const trimmedName = (body.name as string).trim();

  if (podStore.hasName(canvas.id, trimmedName)) {
    return jsonResponse(
      { error: "同一 Canvas 下已存在相同名稱的 Pod" },
      HTTP_STATUS.CONFLICT,
    );
  }

  const oldName = pod.name;
  const result = podStore.update(canvas.id, pod.id, { name: trimmedName });

  if (!result) {
    logger.error("Pod", "Error", "重新命名 Pod 失敗");
    return jsonResponse(
      { error: "重新命名 Pod 時發生內部錯誤" },
      HTTP_STATUS.INTERNAL_ERROR,
    );
  }

  logger.log(
    "Pod",
    "Rename",
    `已重命名 Pod「${oldName}」為「${result.pod.name}」`,
  );

  socketService.emitToCanvas(canvas.id, WebSocketResponseEvents.POD_RENAMED, {
    requestId: "system",
    canvasId: canvas.id,
    success: true,
    pod: toPodPublicView(result.pod),
    podId: result.pod.id,
    name: result.pod.name,
  });

  return jsonResponse({ pod: result.pod }, HTTP_STATUS.OK);
}

export async function handleDeletePod(
  _req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const { canvas, error } = requireCanvas(params.id);
  if (error) return error;

  const pod = resolvePod(canvas.id, decodeURIComponent(params.podId));
  if (!pod) {
    return jsonResponse({ error: "找不到 Pod" }, HTTP_STATUS.NOT_FOUND);
  }

  const result = await deletePodWithCleanup(canvas.id, pod.id, "system");
  if (!result.success) {
    logger.error(
      "Pod",
      "Error",
      "刪除 Pod 失敗",
      getResultErrorString(result.error),
    );
    return jsonResponse(
      { error: "刪除 Pod 時發生錯誤" },
      HTTP_STATUS.INTERNAL_ERROR,
    );
  }

  return jsonResponse({ success: true }, HTTP_STATUS.OK);
}
