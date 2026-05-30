import { HTTP_STATUS } from "../constants.js";
import { jsonResponse } from "./apiHelpers.js";
import {
  formatBundleImportError,
  importBundleArchive,
  MAX_BUNDLE_ARCHIVE_BYTES,
} from "../services/plugin/pluginInstallService.js";

function resolveBundleImportStatus(code: string): number {
  switch (code) {
    case "PLUGIN_ALREADY_INSTALLED":
      return HTTP_STATUS.CONFLICT;
    case "BUNDLE_SKILL_NOT_FOUND":
    case "EMPTY_BUNDLE_ARCHIVE":
    case "BUNDLE_PATH_TRAVERSAL":
    case "BUNDLE_SYMLINK_FORBIDDEN":
    case "INVALID_BUNDLE_ARCHIVE":
    case "BUNDLE_TOO_MANY_FILES":
      return HTTP_STATUS.BAD_REQUEST;
    case "BUNDLE_FILE_TOO_LARGE":
    case "BUNDLE_ENTRY_TOO_LARGE":
    case "BUNDLE_ARCHIVE_TOO_LARGE":
      return 413;
    default:
      return HTTP_STATUS.INTERNAL_ERROR;
  }
}

export async function handleImportBundle(
  req: Request,
): Promise<Response> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let formData: any;
  try {
    formData = await req.formData();
  } catch {
    return jsonResponse(
      {
        error: "無法解析 bundle 匯入表單，請確認請求格式為 multipart/form-data",
        code: "INVALID_BUNDLE_FORM_DATA",
      },
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const bundle = formData.get("bundle");
  if (bundle === null) {
    return jsonResponse(
      {
        error: "缺少 bundle 檔案",
        code: "BUNDLE_FILE_REQUIRED",
      },
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  if (!(bundle instanceof File)) {
    return jsonResponse(
      {
        error: "bundle 欄位必須為檔案類型",
        code: "BUNDLE_FILE_INVALID",
      },
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  if (bundle.size > MAX_BUNDLE_ARCHIVE_BYTES) {
    return new Response(
      JSON.stringify({
        error: `bundle 壓縮檔超過允許的最大大小（${MAX_BUNDLE_ARCHIVE_BYTES / 1024 / 1024} MB）`,
        code: "BUNDLE_FILE_TOO_LARGE",
      }),
      { status: 413, headers: { "Content-Type": "application/json" } },
    );
  }

  const result = await importBundleArchive(bundle);
  if (!result.success) {
    const errorCode =
      typeof result.error === "string"
        ? result.error
        : result.error.key;
    const [code] = errorCode.split(":", 1);
    return jsonResponse(
      {
        error: formatBundleImportError(errorCode),
        code,
      },
      resolveBundleImportStatus(code),
    );
  }

  return jsonResponse({ bundle: result.data }, HTTP_STATUS.CREATED);
}
