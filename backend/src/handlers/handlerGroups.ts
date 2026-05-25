import type { HandlerGroup } from "./registry.js";
import { podHandlerGroup } from "./groups/podHandlerGroup.js";
import { chatHandlerGroup } from "./groups/chatHandlerGroup.js";
import { connectionHandlerGroup } from "./groups/connectionHandlerGroup.js";
import { pasteHandlerGroup } from "./groups/pasteHandlerGroup.js";
import { repositoryHandlerGroup } from "./groups/repositoryHandlerGroup.js";
import { canvasHandlerGroup } from "./groups/canvasHandlerGroup.js";
import { canvasSecurityHandlerGroup } from "./groups/canvasSecurityHandlerGroup.js";
import { cursorHandlerGroup } from "./groups/cursorHandlerGroup.js";
import { configHandlerGroup } from "./groups/configHandlerGroup.js";
import { authHandlerGroup } from "./groups/authHandlerGroup.js";
import { integrationHandlerGroup } from "./groups/integrationHandlerGroup.js";
import { runHandlerGroup } from "./groups/runHandlerGroup.js";
import { pluginHandlerGroup } from "./groups/pluginHandlerGroup.js";
import { backupHandlerGroup } from "./groups/backupHandlerGroup.js";
import { providerHandlerGroup } from "./groups/providerHandlerGroup.js";
import { mcpHandlerGroup } from "./groups/mcpHandlerGroup.js";
import { opencodeSettingsHandlerGroup } from "./groups/opencodeSettingsHandlerGroup.js";

export const allHandlerGroups = [
  podHandlerGroup,
  chatHandlerGroup,
  connectionHandlerGroup,
  pasteHandlerGroup,
  repositoryHandlerGroup,
  canvasHandlerGroup,
  canvasSecurityHandlerGroup,
  cursorHandlerGroup,
  configHandlerGroup,
  authHandlerGroup,
  integrationHandlerGroup,
  runHandlerGroup,
  pluginHandlerGroup,
  backupHandlerGroup,
  providerHandlerGroup,
  mcpHandlerGroup,
  opencodeSettingsHandlerGroup,
] satisfies HandlerGroup[];
