import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "./events";

export const webSocketRequestResponsePairs = {
  [WebSocketRequestEvents.POD_CREATE]: WebSocketResponseEvents.POD_CREATED,
  [WebSocketRequestEvents.POD_LIST]: WebSocketResponseEvents.POD_LIST_RESULT,
  [WebSocketRequestEvents.POD_GET]: WebSocketResponseEvents.POD_GET_RESULT,
  [WebSocketRequestEvents.POD_MOVE]: WebSocketResponseEvents.POD_MOVED,
  [WebSocketRequestEvents.POD_RENAME]: WebSocketResponseEvents.POD_RENAMED,
  [WebSocketRequestEvents.POD_SET_GOAL]: WebSocketResponseEvents.POD_GOAL_SET,
  [WebSocketRequestEvents.POD_SET_PROVIDER]:
    WebSocketResponseEvents.POD_PROVIDER_SET,
  [WebSocketRequestEvents.POD_SET_MODEL]: WebSocketResponseEvents.POD_MODEL_SET,
  [WebSocketRequestEvents.POD_SET_THINKING_LEVEL]:
    WebSocketResponseEvents.POD_THINKING_LEVEL_SET,
  [WebSocketRequestEvents.POD_SET_SCHEDULE]:
    WebSocketResponseEvents.POD_SCHEDULE_SET,
  [WebSocketRequestEvents.POD_SET_MEMORY_ENABLED]:
    WebSocketResponseEvents.POD_MEMORY_ENABLED_SET,
  [WebSocketRequestEvents.POD_GET_MEMORY]:
    WebSocketResponseEvents.POD_MEMORY_RESULT,
  [WebSocketRequestEvents.POD_CLEAR_MEMORY]:
    WebSocketResponseEvents.POD_MEMORY_CLEARED,
  [WebSocketRequestEvents.POD_DELETE]: WebSocketResponseEvents.POD_DELETED,
  [WebSocketRequestEvents.CONNECTION_CREATE]:
    WebSocketResponseEvents.CONNECTION_CREATED,
  [WebSocketRequestEvents.CONNECTION_LIST]:
    WebSocketResponseEvents.CONNECTION_LIST_RESULT,
  [WebSocketRequestEvents.CONNECTION_DELETE]:
    WebSocketResponseEvents.CONNECTION_DELETED,
  [WebSocketRequestEvents.CONNECTION_UPDATE]:
    WebSocketResponseEvents.CONNECTION_UPDATED,
  [WebSocketRequestEvents.CANVAS_PASTE]:
    WebSocketResponseEvents.CANVAS_PASTE_RESULT,
  [WebSocketRequestEvents.REPOSITORY_LIST]:
    WebSocketResponseEvents.REPOSITORY_LIST_RESULT,
  [WebSocketRequestEvents.REPOSITORY_CREATE]:
    WebSocketResponseEvents.REPOSITORY_CREATED,
  [WebSocketRequestEvents.REPOSITORY_DELETE]:
    WebSocketResponseEvents.REPOSITORY_DELETED,
  [WebSocketRequestEvents.REPOSITORY_CHECK_GIT]:
    WebSocketResponseEvents.REPOSITORY_CHECK_GIT_RESULT,
  [WebSocketRequestEvents.REPOSITORY_GIT_CLONE]:
    WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT,
  [WebSocketRequestEvents.REPOSITORY_GET_LOCAL_BRANCHES]:
    WebSocketResponseEvents.REPOSITORY_LOCAL_BRANCHES_RESULT,
  [WebSocketRequestEvents.REPOSITORY_CHECK_DIRTY]:
    WebSocketResponseEvents.REPOSITORY_DIRTY_CHECK_RESULT,
  [WebSocketRequestEvents.REPOSITORY_CHECKOUT_BRANCH]:
    WebSocketResponseEvents.REPOSITORY_BRANCH_CHECKED_OUT,
  [WebSocketRequestEvents.REPOSITORY_DELETE_BRANCH]:
    WebSocketResponseEvents.REPOSITORY_BRANCH_DELETED,
  [WebSocketRequestEvents.REPOSITORY_PULL_LATEST]:
    WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT,
  [WebSocketRequestEvents.REPOSITORY_SET_MEMORY_ENABLED]:
    WebSocketResponseEvents.REPOSITORY_MEMORY_ENABLED_SET,
  [WebSocketRequestEvents.REPOSITORY_GET_MEMORY]:
    WebSocketResponseEvents.REPOSITORY_MEMORY_RESULT,
  [WebSocketRequestEvents.REPOSITORY_CLEAR_MEMORY]:
    WebSocketResponseEvents.REPOSITORY_MEMORY_CLEARED,
  [WebSocketRequestEvents.REPOSITORY_NOTE_CREATE]:
    WebSocketResponseEvents.REPOSITORY_NOTE_CREATED,
  [WebSocketRequestEvents.REPOSITORY_NOTE_LIST]:
    WebSocketResponseEvents.REPOSITORY_NOTE_LIST_RESULT,
  [WebSocketRequestEvents.REPOSITORY_NOTE_UPDATE]:
    WebSocketResponseEvents.REPOSITORY_NOTE_UPDATED,
  [WebSocketRequestEvents.REPOSITORY_NOTE_DELETE]:
    WebSocketResponseEvents.REPOSITORY_NOTE_DELETED,
  [WebSocketRequestEvents.POD_BIND_REPOSITORY]:
    WebSocketResponseEvents.POD_REPOSITORY_BOUND,
  [WebSocketRequestEvents.POD_UNBIND_REPOSITORY]:
    WebSocketResponseEvents.POD_REPOSITORY_UNBOUND,
  [WebSocketRequestEvents.MANAGED_MCP_REGISTRY_LIST]:
    WebSocketResponseEvents.MANAGED_MCP_REGISTRY_LIST_RESULT,
  [WebSocketRequestEvents.MANAGED_MCP_REGISTRY_SAVE]:
    WebSocketResponseEvents.MANAGED_MCP_REGISTRY_SAVED,
  [WebSocketRequestEvents.MANAGED_MCP_REGISTRY_DELETE]:
    WebSocketResponseEvents.MANAGED_MCP_REGISTRY_DELETED,
  [WebSocketRequestEvents.MANAGED_MCP_REGISTRY_TEST]:
    WebSocketResponseEvents.MANAGED_MCP_REGISTRY_TEST_RESULT,
  [WebSocketRequestEvents.POD_MCP_AVAILABILITY_LIST]:
    WebSocketResponseEvents.POD_MCP_AVAILABILITY_LIST_RESULT,
  [WebSocketRequestEvents.POD_SET_MCP_SERVER_NAMES]:
    WebSocketResponseEvents.POD_MCP_SERVER_NAMES_UPDATED,
  [WebSocketRequestEvents.CANVAS_CREATE]:
    WebSocketResponseEvents.CANVAS_CREATED,
  [WebSocketRequestEvents.CANVAS_LIST]:
    WebSocketResponseEvents.CANVAS_LIST_RESULT,
  [WebSocketRequestEvents.CANVAS_RENAME]:
    WebSocketResponseEvents.CANVAS_RENAMED,
  [WebSocketRequestEvents.CANVAS_DELETE]:
    WebSocketResponseEvents.CANVAS_DELETED,
  [WebSocketRequestEvents.CANVAS_SWITCH]:
    WebSocketResponseEvents.CANVAS_SWITCHED,
  [WebSocketRequestEvents.CANVAS_REORDER]:
    WebSocketResponseEvents.CANVAS_REORDERED,
  [WebSocketRequestEvents.CANVAS_SECURITY_UPDATE]:
    WebSocketResponseEvents.CANVAS_SECURITY_UPDATED,
  [WebSocketRequestEvents.CONFIG_GET]:
    WebSocketResponseEvents.CONFIG_GET_RESULT,
  [WebSocketRequestEvents.CONFIG_UPDATE]:
    WebSocketResponseEvents.CONFIG_UPDATED,
  [WebSocketRequestEvents.AUTH_BOOTSTRAP]:
    WebSocketResponseEvents.AUTH_BOOTSTRAP_RESULT,
  [WebSocketRequestEvents.AUTH_UNLOCK_WORKSPACE]:
    WebSocketResponseEvents.AUTH_WORKSPACE_UNLOCK_RESULT,
  [WebSocketRequestEvents.AUTH_UNLOCK_CANVAS]:
    WebSocketResponseEvents.AUTH_CANVAS_UNLOCK_RESULT,
  [WebSocketRequestEvents.AUTH_UPDATE_WORKSPACE_PASSWORD]:
    WebSocketResponseEvents.AUTH_WORKSPACE_PASSWORD_UPDATED,
  [WebSocketRequestEvents.INTEGRATION_APP_CREATE]:
    WebSocketResponseEvents.INTEGRATION_APP_CREATED,
  [WebSocketRequestEvents.INTEGRATION_APP_DELETE]:
    WebSocketResponseEvents.INTEGRATION_APP_DELETED,
  [WebSocketRequestEvents.INTEGRATION_APP_LIST]:
    WebSocketResponseEvents.INTEGRATION_APP_LIST_RESULT,
  [WebSocketRequestEvents.INTEGRATION_APP_GET]:
    WebSocketResponseEvents.INTEGRATION_APP_GET_RESULT,
  [WebSocketRequestEvents.INTEGRATION_APP_RESOURCES]:
    WebSocketResponseEvents.INTEGRATION_APP_RESOURCES_RESULT,
  [WebSocketRequestEvents.INTEGRATION_APP_RESOURCES_REFRESH]:
    WebSocketResponseEvents.INTEGRATION_APP_RESOURCES_REFRESHED,
  [WebSocketRequestEvents.POD_BIND_INTEGRATION]:
    WebSocketResponseEvents.POD_INTEGRATION_BOUND,
  [WebSocketRequestEvents.POD_UNBIND_INTEGRATION]:
    WebSocketResponseEvents.POD_INTEGRATION_UNBOUND,
  [WebSocketRequestEvents.RUN_DELETE]: WebSocketResponseEvents.RUN_DELETED,
  [WebSocketRequestEvents.RUN_LOAD_HISTORY]:
    WebSocketResponseEvents.RUN_HISTORY_RESULT,
  [WebSocketRequestEvents.RUN_LOAD_POD_MESSAGES]:
    WebSocketResponseEvents.RUN_POD_MESSAGES_RESULT,
  [WebSocketRequestEvents.PLUGIN_LIST]:
    WebSocketResponseEvents.PLUGIN_LIST_RESULT,
  [WebSocketRequestEvents.PLUGIN_INSTALL]:
    WebSocketResponseEvents.PLUGIN_INSTALLED,
  [WebSocketRequestEvents.PLUGIN_DELETE]:
    WebSocketResponseEvents.PLUGIN_DELETED,
  [WebSocketRequestEvents.PLUGIN_UPDATE]:
    WebSocketResponseEvents.PLUGIN_UPDATED,
  [WebSocketRequestEvents.PLUGIN_REORDER]:
    WebSocketResponseEvents.PLUGIN_REORDERED,
  [WebSocketRequestEvents.POD_SET_PLUGINS]:
    WebSocketResponseEvents.POD_PLUGINS_SET,
  [WebSocketRequestEvents.BACKUP_TEST_CONNECTION]:
    WebSocketResponseEvents.BACKUP_TEST_CONNECTION_RESULT,
  [WebSocketRequestEvents.BACKUP_TRIGGER]:
    WebSocketResponseEvents.BACKUP_TRIGGER_RESULT,
  [WebSocketRequestEvents.PROVIDER_LIST]:
    WebSocketResponseEvents.PROVIDER_LIST_RESULT,
} as const;

export type WebSocketRequestResponsePairs =
  typeof webSocketRequestResponsePairs;

export type PairedWebSocketRequestEvent =
  keyof WebSocketRequestResponsePairs;

export type ResponseEventForRequest<
  TRequestEvent extends PairedWebSocketRequestEvent,
> = WebSocketRequestResponsePairs[TRequestEvent];
