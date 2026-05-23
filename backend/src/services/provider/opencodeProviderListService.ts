import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import type { OpencodeProviderListResultPayload } from "../../schemas/opencodeSettingsSchemas.js";
import { getOpencodeServerState } from "./opencodeServer.js";
import { logger } from "../../utils/logger.js";

type ResultWithoutRequestId<T> = T extends { requestId: string }
  ? Omit<T, "requestId">
  : never;

const OPENCODE_PROVIDER_LIST_TIMEOUT_MS = 10_000;

function createTimeoutFetch(timeoutMs: number): typeof fetch {
  const timeoutFetch = ((input, init) =>
    fetch(input, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    })) as typeof fetch;
  timeoutFetch.preconnect = fetch.preconnect.bind(fetch);
  return timeoutFetch;
}

function sanitizeOpencodeProviderModel(
  model: unknown,
  fallbackId?: string,
): {
  id: string;
  name: string;
} | null {
  if (!model || typeof model !== "object") return null;
  const rawModel = model as { id?: unknown; name?: unknown };
  const id = typeof rawModel.id === "string" ? rawModel.id : fallbackId;
  if (typeof id !== "string" || id.trim().length === 0) {
    return null;
  }

  return {
    id,
    name: typeof rawModel.name === "string" ? rawModel.name : id,
  };
}

function sanitizeOpencodeProvider(provider: unknown): {
  id: string;
  name: string;
  models: { id: string; name: string }[];
} | null {
  if (!provider || typeof provider !== "object") return null;
  const rawProvider = provider as {
    id?: unknown;
    name?: unknown;
    models?: unknown;
  };
  if (
    typeof rawProvider.id !== "string" ||
    rawProvider.id.trim().length === 0
  ) {
    return null;
  }

  const rawModels = rawProvider.models;
  const models = Array.isArray(rawModels)
    ? rawModels.map((model) => sanitizeOpencodeProviderModel(model))
    : rawModels && typeof rawModels === "object"
      ? Object.entries(rawModels).map(([modelId, model]) =>
          sanitizeOpencodeProviderModel(model, modelId),
        )
      : [];

  return {
    id: rawProvider.id,
    name:
      typeof rawProvider.name === "string" ? rawProvider.name : rawProvider.id,
    models: models.filter((model) => model !== null),
  };
}

function sanitizeProviderDefaults(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function buildProviderListFailedResult(): ResultWithoutRequestId<OpencodeProviderListResultPayload> {
  return {
    success: false,
    error: {
      code: "opencode_provider_list_failed",
      message: "取得 provider 清單失敗，請稍後再試",
    },
  };
}

export function buildOpenCodeProviderMetadataFailedResult(): {
  ok: false;
  code: "opencode_provider_list_failed";
  message: string;
} {
  return {
    ok: false,
    code: "opencode_provider_list_failed",
    message: "取得 OpenCode provider metadata 失敗，請稍後再試",
  };
}

export async function fetchOpencodeProviderListRaw(): Promise<
  | {
      ok: true;
      data:
        | {
            all?: unknown[];
            default?: Record<string, string>;
            connected?: unknown[];
          }
        | null
        | undefined;
    }
  | { ok: false; code: string; message: string }
> {
  const serverState = getOpencodeServerState();

  if (serverState.status !== "ready" || !serverState.baseUrl) {
    return {
      ok: false,
      code: "opencode_server_not_ready",
      message: "opencode server 尚未啟動，請稍候或重啟後端",
    };
  }

  try {
    const client = createOpencodeClient({
      baseUrl: serverState.baseUrl,
      fetch: createTimeoutFetch(OPENCODE_PROVIDER_LIST_TIMEOUT_MS),
    });
    const result = await client.provider.list();

    if (result.error) {
      logger.error(
        "Integration",
        "Error",
        "取得 opencode provider 清單失敗",
        result.error,
      );
      return buildOpenCodeProviderMetadataFailedResult();
    }

    return {
      ok: true,
      data: result.data as
        | {
            all?: unknown[];
            default?: Record<string, string>;
            connected?: unknown[];
          }
        | null
        | undefined,
    };
  } catch (err) {
    logger.error(
      "Integration",
      "Error",
      "取得 opencode provider 清單時發生例外",
      err,
    );
    return buildOpenCodeProviderMetadataFailedResult();
  }
}

export async function listOpencodeProviders(): Promise<
  ResultWithoutRequestId<OpencodeProviderListResultPayload>
> {
  const result = await fetchOpencodeProviderListRaw();

  if (!result.ok) {
    if (result.code === "opencode_server_not_ready") {
      return {
        success: false,
        error: {
          code: result.code,
          message: result.message,
        },
      };
    }

    return buildProviderListFailedResult();
  }

  return {
    success: true,
    all: (result.data?.all ?? [])
      .map(sanitizeOpencodeProvider)
      .filter((provider) => provider !== null),
    default: sanitizeProviderDefaults(result.data?.default),
    connected: (result.data?.connected ?? []).filter(
      (providerId): providerId is string => typeof providerId === "string",
    ),
  };
}
