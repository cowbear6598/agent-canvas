import {
  createAppEventWiring,
  listeners,
} from "./eventHandlers/appEventWiring";

const appEventWiring = createAppEventWiring();

export { listeners };

export function registerUnifiedListeners(): void {
  appEventWiring.register();
}

export function unregisterUnifiedListeners(): void {
  appEventWiring.unregister();
}

export const useUnifiedEventListeners = (): {
  registerUnifiedListeners: () => void;
  unregisterUnifiedListeners: () => void;
} => {
  return {
    registerUnifiedListeners,
    unregisterUnifiedListeners,
  };
};
