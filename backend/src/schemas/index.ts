export * from "./base.js";
export * from "./events.js";
export * from "./podSchemas.js";
export * from "./chatSchemas.js";
export * from "./connectionSchemas.js";
export * from "./workflowSchemas.js";
export * from "./commandSchemas.js";
export * from "./pasteSchemas.js";
export * from "./repositorySchemas.js";
export * from "./subAgentSchemas.js";
export * from "./multiInstanceSchemas.js";
export * from "./scheduleSchemas.js";
export * from "./canvasSchemas.js";
export * from "./groupSchemas.js";
export * from "./cursorSchemas.js";
export * from "./mcpServerSchemas.js";
export * from "./configSchemas.js";
export * from "./integrationSchemas.js";
export * from "./runSchemas.js";
export * from "./pluginSchemas.js";
export * from "./backupSchemas.js";
export * from "./providerSchemas.js";

/** 系統內部使用的 connectionId 常數（非真實 WebSocket 連線） */
export const SystemConnectionIds = {
  SCHEDULE: "schedule",
  WORKFLOW: "workflow",
} as const;
