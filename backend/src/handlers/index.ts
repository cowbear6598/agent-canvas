import { HandlerRegistry } from "./registry.js";
import { podHandlerGroup } from "./groups/podHandlerGroup.js";
import { chatHandlerGroup } from "./groups/chatHandlerGroup.js";
import { connectionHandlerGroup } from "./groups/connectionHandlerGroup.js";
import { workflowHandlerGroup } from "./groups/workflowHandlerGroup.js";
import { commandHandlerGroup } from "./groups/commandHandlerGroup.js";
import { pasteHandlerGroup } from "./groups/pasteHandlerGroup.js";
import { repositoryHandlerGroup } from "./groups/repositoryHandlerGroup.js";
import { subAgentHandlerGroup } from "./groups/subAgentHandlerGroup.js";
import { multiInstanceHandlerGroup } from "./groups/multiInstanceHandlerGroup.js";
import { canvasHandlerGroup } from "./groups/canvasHandlerGroup.js";
import { groupHandlerGroup } from "./groups/groupHandlerGroup.js";
import { cursorHandlerGroup } from "./groups/cursorHandlerGroup.js";
import { mcpServerHandlerGroup } from "./groups/mcpServerHandlerGroup.js";
import { configHandlerGroup } from "./groups/configHandlerGroup.js";
import { integrationHandlerGroup } from "./groups/integrationHandlerGroup.js";
import { runHandlerGroup } from "./groups/runHandlerGroup.js";
import { pluginHandlerGroup } from "./groups/pluginHandlerGroup.js";
import { backupHandlerGroup } from "./groups/backupHandlerGroup.js";
import { providerHandlerGroup } from "./groups/providerHandlerGroup.js";

const registry = new HandlerRegistry();

registry.registerGroup(podHandlerGroup);
registry.registerGroup(chatHandlerGroup);
registry.registerGroup(connectionHandlerGroup);
registry.registerGroup(workflowHandlerGroup);
registry.registerGroup(commandHandlerGroup);
registry.registerGroup(pasteHandlerGroup);
registry.registerGroup(repositoryHandlerGroup);
registry.registerGroup(subAgentHandlerGroup);
registry.registerGroup(multiInstanceHandlerGroup);
registry.registerGroup(canvasHandlerGroup);
registry.registerGroup(groupHandlerGroup);
registry.registerGroup(cursorHandlerGroup);
registry.registerGroup(mcpServerHandlerGroup);
registry.registerGroup(configHandlerGroup);
registry.registerGroup(integrationHandlerGroup);
registry.registerGroup(runHandlerGroup);
registry.registerGroup(pluginHandlerGroup);
registry.registerGroup(backupHandlerGroup);
registry.registerGroup(providerHandlerGroup);

export function registerAllHandlers(): void {
  registry.registerToRouter();
}
