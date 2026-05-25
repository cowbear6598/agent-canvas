import { HandlerRegistry } from "./registry.js";
import { allHandlerGroups } from "./handlerGroups.js";

const registry = new HandlerRegistry();

for (const group of allHandlerGroups) {
  registry.registerGroup(group);
}

export function registerAllHandlers(): void {
  registry.registerToRouter();
}

export { allHandlerGroups } from "./handlerGroups.js";
