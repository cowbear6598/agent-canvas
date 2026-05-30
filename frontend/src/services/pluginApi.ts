import { createWebSocketRequest } from "@/services/websocket/createWebSocketRequest";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/types/websocket/events";
import type {
  PluginListPayload,
  PluginInstallPayload,
  PluginDeletePayload,
  PluginUpdatePayload,
  PluginReorderPayload,
} from "@/types/websocket/requests";
import type {
  PluginListResultPayload,
  PluginInstalledPayload,
  PluginDeletedPayload,
  PluginUpdatedPayload,
  PluginReorderedPayload,
} from "@/types/websocket/responses";
import type { InstalledPlugin } from "@/types/plugin";
import { t } from "@/i18n";
import { getApiBaseUrl } from "@/services/utils";

function mapBundleUploadError(
  code: string | undefined,
  message: string | undefined,
): string {
  switch (code) {
    case "PLUGIN_ALREADY_INSTALLED":
      return t("errors.bundleUploadAlreadyInstalled");
    case "BUNDLE_FILE_TOO_LARGE":
      return t("errors.bundleUploadFileTooLarge");
    case "BUNDLE_SKILL_NOT_FOUND":
      return t("errors.bundleUploadSkillMissing");
    case "EMPTY_BUNDLE_ARCHIVE":
      return t("errors.bundleUploadArchiveEmpty");
    case "BUNDLE_PATH_TRAVERSAL":
      return t("errors.bundleUploadPathTraversal");
    case "BUNDLE_SYMLINK_FORBIDDEN":
      return t("errors.bundleUploadSymlinkForbidden");
    case "BUNDLE_ENTRY_TOO_LARGE":
      return t("errors.bundleUploadEntryTooLarge");
    case "BUNDLE_ARCHIVE_TOO_LARGE":
      return t("errors.bundleUploadArchiveTooLarge");
    case "BUNDLE_TOO_MANY_FILES":
      return t("errors.bundleUploadTooManyFiles");
    case "INVALID_BUNDLE_ARCHIVE":
      return t("errors.bundleUploadInvalidArchive");
    default:
      return message || t("errors.bundleUploadFailed");
  }
}

export async function listPlugins(): Promise<InstalledPlugin[]> {
  const result = await createWebSocketRequest<
    PluginListPayload,
    PluginListResultPayload
  >({
    requestEvent: WebSocketRequestEvents.PLUGIN_LIST,
    responseEvent: WebSocketResponseEvents.PLUGIN_LIST_RESULT,
    payload: {},
  });

  if (!result.plugins) {
    throw new Error(t("errors.pluginListMissingPlugins"));
  }

  return result.plugins;
}

export async function installPlugin(
  githubRepo: string,
): Promise<InstalledPlugin> {
  const result = await createWebSocketRequest<
    PluginInstallPayload,
    PluginInstalledPayload
  >({
    requestEvent: WebSocketRequestEvents.PLUGIN_INSTALL,
    responseEvent: WebSocketResponseEvents.PLUGIN_INSTALLED,
    payload: { githubRepo },
  });

  if (!result.plugin) {
    throw new Error(t("errors.pluginInstallMissingPlugin"));
  }

  return result.plugin;
}

export async function deletePlugin(
  pluginId: string,
): Promise<{ pluginId: string; plugins?: InstalledPlugin[] }> {
  const result = await createWebSocketRequest<
    PluginDeletePayload,
    PluginDeletedPayload
  >({
    requestEvent: WebSocketRequestEvents.PLUGIN_DELETE,
    responseEvent: WebSocketResponseEvents.PLUGIN_DELETED,
    payload: { pluginId },
  });

  return {
    pluginId: result.pluginId ?? pluginId,
    plugins: result.plugins,
  };
}

export async function updatePlugin(pluginId: string): Promise<InstalledPlugin> {
  const result = await createWebSocketRequest<
    PluginUpdatePayload,
    PluginUpdatedPayload
  >({
    requestEvent: WebSocketRequestEvents.PLUGIN_UPDATE,
    responseEvent: WebSocketResponseEvents.PLUGIN_UPDATED,
    payload: { pluginId },
  });

  if (!result.plugin) {
    throw new Error(t("errors.pluginUpdateMissingPlugin"));
  }

  return result.plugin;
}

export async function reorderPlugins(
  idsInOrder: string[],
): Promise<InstalledPlugin[]> {
  const result = await createWebSocketRequest<
    PluginReorderPayload,
    PluginReorderedPayload
  >({
    requestEvent: WebSocketRequestEvents.PLUGIN_REORDER,
    responseEvent: WebSocketResponseEvents.PLUGIN_REORDERED,
    payload: { pluginIds: idsInOrder },
  });

  if (!result.plugins) {
    throw new Error(t("errors.pluginReorderMissingPlugins"));
  }

  return result.plugins;
}

export async function uploadPluginBundle(
  file: File,
): Promise<InstalledPlugin> {
  const formData = new FormData();
  formData.append("bundle", file);

  const response = await fetch(`${getApiBaseUrl()}/api/bundles/import`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  const body = (await response.json().catch(() => null)) as
    | { bundle?: InstalledPlugin; error?: string; code?: string }
    | null;

  if (!response.ok) {
    throw new Error(mapBundleUploadError(body?.code, body?.error));
  }

  if (!body?.bundle) {
    throw new Error(t("errors.bundleUploadMissingBundle"));
  }

  return body.bundle;
}
