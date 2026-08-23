import { HTTP_STATUS } from "../constants.js";
import { jsonResponse, requireJsonBody } from "./apiHelpers.js";
import { podPackImportOptionsSchema } from "../schemas/podPackSchemas.js";
import {
  cancelTransfer,
  createExportTransfer,
  getTransferDownload,
  importTransfer,
  stageImportTransfer,
} from "../services/podPack/podPackTransferService.js";

function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "POD_PACK_UNKNOWN_ERROR";
  const notFound = message.includes("NOT_FOUND");
  const diskFull = message.includes("DISK_FULL");
  return jsonResponse(
    { error: message, code: message.split(":", 1)[0] },
    diskFull ? 507 : notFound ? HTTP_STATUS.NOT_FOUND : HTTP_STATUS.BAD_REQUEST,
  );
}

export async function handleExportPodPack(req: Request): Promise<Response> {
  const invalidBody = requireJsonBody(req);
  if (invalidBody) return invalidBody;
  try {
    return jsonResponse({
      transfer: await createExportTransfer(
        await req.json(),
        req.headers.get("x-pod-pack-transfer-id") ?? undefined,
      ),
    }, HTTP_STATUS.ACCEPTED);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handlePreviewPodPack(req: Request): Promise<Response> {
  try {
    const filename = decodeURIComponent(req.headers.get("x-pod-pack-filename") ?? "import.podpack");
    const transfer = await stageImportTransfer(
      req,
      filename,
      req.headers.get("x-pod-pack-transfer-id") ?? undefined,
    );
    return jsonResponse({
      transferId: transfer.id,
      filename: transfer.filename,
      size: transfer.size,
      preview: transfer.preview,
    }, HTTP_STATUS.CREATED);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleImportPodPack(req: Request): Promise<Response> {
  const invalidBody = requireJsonBody(req);
  if (invalidBody) return invalidBody;
  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return jsonResponse({ error: "無法解析 podpack 匯入資料", code: "POD_PACK_IMPORT_OPTIONS_INVALID" }, HTTP_STATUS.BAD_REQUEST); }
  const transferId = typeof body.transferId === "string" ? body.transferId : "";
  const options = podPackImportOptionsSchema.safeParse({
    canvasId: body.canvasId,
    targetX: body.targetX,
    targetY: body.targetY,
  });
  if (!transferId || !options.success) {
    return jsonResponse({ error: "podpack 匯入位置、Canvas 或 transfer 不合法", code: "POD_PACK_IMPORT_OPTIONS_INVALID" }, HTTP_STATUS.BAD_REQUEST);
  }
  try { return jsonResponse(await importTransfer(transferId, options.data), HTTP_STATUS.CREATED); }
  catch (error) { return errorResponse(error); }
}

export async function handleDownloadPodPack(
  _req: Request,
  params: Record<string, string>,
): Promise<Response> {
  try {
    const { metadata, file } = await getTransferDownload(params.transferId ?? "");
    return new Response(file, {
      status: HTTP_STATUS.OK,
      headers: {
        "Content-Type": "application/vnd.agent-canvas.podpack+zip",
        "Content-Disposition": `attachment; filename="${metadata.filename}"`,
        "Content-Length": String(metadata.size),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleCancelPodPackTransfer(
  _req: Request,
  params: Record<string, string>,
): Promise<Response> {
  try {
    await cancelTransfer(params.transferId ?? "");
    return jsonResponse({ success: true }, HTTP_STATUS.OK);
  } catch (error) {
    return errorResponse(error);
  }
}
