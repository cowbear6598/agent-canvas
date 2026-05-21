import { HTTP_STATUS } from "../constants.js";
import { executeIntegrationReply } from "../services/integration/integrationReplyService.js";
import { getResultErrorString } from "../types/index.js";
import { jsonResponse, requireJsonBody } from "./apiHelpers.js";

interface IntegrationReplyBody {
  capabilityToken?: unknown;
  text?: unknown;
}

export async function handleInternalIntegrationReply(
  req: Request,
): Promise<Response> {
  const formatError = requireJsonBody(req);
  if (formatError) return formatError;

  let body: IntegrationReplyBody;
  try {
    body = (await req.json()) as IntegrationReplyBody;
  } catch {
    return jsonResponse(
      { success: false, error: "無效的 JSON" },
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const capabilityToken =
    typeof body.capabilityToken === "string" ? body.capabilityToken : "";
  const text = typeof body.text === "string" ? body.text : "";

  if (!capabilityToken || !text.trim()) {
    return jsonResponse(
      { success: false, error: "capabilityToken 與 text 為必填" },
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  const result = await executeIntegrationReply(capabilityToken, text);
  if (!result.success) {
    return jsonResponse(
      { success: false, error: getResultErrorString(result.error) },
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  return jsonResponse({ success: true }, HTTP_STATUS.OK);
}
