import { HTTP_STATUS } from "../constants.js";
import { jsonResponse, requireJsonBody } from "./apiHelpers.js";
import {
  createPodPackArchive,
  importPodPackArchive,
  MAX_POD_PACK_BYTES,
  previewPodPackArchive,
} from "../services/podPack/podPackService.js";
import { podPackImportOptionsSchema } from "../schemas/podPackSchemas.js";

function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "POD_PACK_UNKNOWN_ERROR";
  const tooLarge = message.includes("TOO_LARGE") || message.includes("SIZE_INVALID");
  const notFound = message.includes("NOT_FOUND");
  return jsonResponse(
    { error: message, code: message.split(":", 1)[0] },
    tooLarge ? 413 : notFound ? HTTP_STATUS.NOT_FOUND : HTTP_STATUS.BAD_REQUEST,
  );
}

async function readPodPackFile(req: Request): Promise<Uint8Array | Response> {
  // Bun 與 DOM lib 的 FormData iterator 型別定義不同，但執行期介面一致。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let formData: any;
  try { formData = await req.formData(); } catch {
    return jsonResponse({ error: "無法解析 podpack 表單", code: "POD_PACK_FORM_INVALID" }, HTTP_STATUS.BAD_REQUEST);
  }
  const file = formData.get("podpack");
  if (!(file instanceof File)) {
    return jsonResponse({ error: "缺少 .podpack 檔案", code: "POD_PACK_FILE_REQUIRED" }, HTTP_STATUS.BAD_REQUEST);
  }
  if (file.size > MAX_POD_PACK_BYTES) {
    return jsonResponse({ error: "podpack 超過允許大小", code: "POD_PACK_TOO_LARGE" }, 413);
  }
  return new Uint8Array(await file.arrayBuffer());
}

export async function handleExportPodPack(req: Request): Promise<Response> {
  const invalidBody = requireJsonBody(req);
  if (invalidBody) return invalidBody;
  try {
    const archive = await createPodPackArchive(await req.json());
    return new Response(archive, {
      status: HTTP_STATUS.OK,
      headers: {
        "Content-Type": "application/vnd.agent-canvas.podpack+zip",
        "Content-Disposition": `attachment; filename="pods-${new Date().toISOString().slice(0, 10)}.podpack"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) { return errorResponse(error); }
}

export async function handlePreviewPodPack(req: Request): Promise<Response> {
  const file = await readPodPackFile(req);
  if (file instanceof Response) return file;
  try { return jsonResponse({ preview: await previewPodPackArchive(file) }, HTTP_STATUS.OK); }
  catch (error) { return errorResponse(error); }
}

export async function handleImportPodPack(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const options = podPackImportOptionsSchema.safeParse({
    canvasId: url.searchParams.get("canvasId"),
    targetX: Number(url.searchParams.get("targetX")),
    targetY: Number(url.searchParams.get("targetY")),
  });
  if (!options.success) {
    return jsonResponse({ error: "podpack 匯入位置或 Canvas 不合法", code: "POD_PACK_IMPORT_OPTIONS_INVALID" }, HTTP_STATUS.BAD_REQUEST);
  }
  const file = await readPodPackFile(req);
  if (file instanceof Response) return file;
  try { return jsonResponse(await importPodPackArchive(file, options.data), HTTP_STATUS.CREATED); }
  catch (error) { return errorResponse(error); }
}
