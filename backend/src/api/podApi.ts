import { podStore } from '../services/podStore.js';
import { jsonResponse, requireCanvas, resolvePod, requireJsonBody } from './apiHelpers.js';
import { createPodWithWorkspace, deletePodWithCleanup } from '../services/podService.js';
import { logger } from '../utils/logger.js';
import type { ModelType } from '../types/pod.js';
import { HTTP_STATUS } from '../constants.js';

const VALID_MODELS: ModelType[] = ['opus', 'sonnet', 'haiku'];

interface ValidatedCreatePodBody {
	name: string;
	x: number;
	y: number;
	model: ModelType;
}

function validatePodName(data: Record<string, unknown>): string | null {
	if (!data.name || typeof data.name !== 'string' || data.name.trim() === '') {
		return 'Pod 名稱不能為空';
	}
	if (data.name.trim().length > 100) {
		return 'Pod 名稱不能超過 100 個字元';
	}
	return null;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

const COORDINATE_RANGE = { min: -100000, max: 100000 };

function isInCoordinateRange(value: number): boolean {
	return value >= COORDINATE_RANGE.min && value <= COORDINATE_RANGE.max;
}

function validatePodCoordinates(data: Record<string, unknown>): string | null {
	if (!isFiniteNumber(data.x) || !isFiniteNumber(data.y)) {
		return '必須提供有效的 x 和 y 座標';
	}
	if (!isInCoordinateRange(data.x) || !isInCoordinateRange(data.y)) {
		return '必須提供有效的 x 和 y 座標';
	}
	return null;
}

function validatePodModel(data: Record<string, unknown>): string | null {
	if (data.model !== undefined && !VALID_MODELS.includes(data.model as ModelType)) {
		return '無效的模型類型';
	}
	return null;
}

function validateCreatePodBody(data: Record<string, unknown>): { error: string } | ValidatedCreatePodBody {
	const nameError = validatePodName(data);
	if (nameError) return { error: nameError };

	const coordinatesError = validatePodCoordinates(data);
	if (coordinatesError) return { error: coordinatesError };

	const modelError = validatePodModel(data);
	if (modelError) return { error: modelError };

	const name = (data.name as string).trim();
	const model = (data.model as ModelType) ?? 'opus';

	return { name, x: data.x as number, y: data.y as number, model };
}

export function handleListPods(_req: Request, params: Record<string, string>): Response {
	const { canvas, error } = requireCanvas(params.id);
	if (error) return error;

	const pods = podStore.getAll(canvas.id);
	return jsonResponse({ pods }, HTTP_STATUS.OK);
}

export async function handleCreatePod(req: Request, params: Record<string, string>): Promise<Response> {
	const jsonError = requireJsonBody(req);
	if (jsonError) return jsonError;

	const body = await req.json();

	const { canvas, error } = requireCanvas(params.id);
	if (error) return error;

	const validated = validateCreatePodBody(body as Record<string, unknown>);
	if ('error' in validated) {
		return jsonResponse({ error: validated.error }, HTTP_STATUS.BAD_REQUEST);
	}

	if (podStore.hasName(canvas.id, validated.name)) {
		return jsonResponse({ error: '同一 Canvas 下已存在相同名稱的 Pod' }, HTTP_STATUS.CONFLICT);
	}

	const result = await createPodWithWorkspace(
		canvas.id,
		{
			name: validated.name,
			x: validated.x,
			y: validated.y,
			rotation: 0,
			model: validated.model,
		},
		'system',
	);

	if (!result.success) {
		logger.error('Pod', 'Error', '建立 Pod 失敗', result.error);
		return jsonResponse({ error: '建立 Pod 時發生內部錯誤' }, HTTP_STATUS.INTERNAL_ERROR);
	}

	return jsonResponse({ pod: result.data.pod }, HTTP_STATUS.CREATED);
}

export async function handleDeletePod(_req: Request, params: Record<string, string>): Promise<Response> {
	const { canvas, error } = requireCanvas(params.id);
	if (error) return error;

	const pod = resolvePod(canvas.id, decodeURIComponent(params.podId));
	if (!pod) {
		return jsonResponse({ error: '找不到 Pod' }, HTTP_STATUS.NOT_FOUND);
	}

	const result = await deletePodWithCleanup(canvas.id, pod.id, 'system');
	if (!result.success) {
		logger.error('Pod', 'Error', '刪除 Pod 失敗', result.error);
		return jsonResponse({ error: '刪除 Pod 時發生錯誤' }, HTTP_STATUS.INTERNAL_ERROR);
	}

	return jsonResponse({ success: true }, HTTP_STATUS.OK);
}
