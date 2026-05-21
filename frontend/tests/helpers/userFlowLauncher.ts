import { mount, type MountingOptions, type VueWrapper } from "@vue/test-utils";
import {
  createPinia,
  setActivePinia,
  type Pinia,
  type StateTree,
} from "pinia";
import { defineComponent, h, type Component } from "vue";
import {
  createMemoryHistory,
  createRouter,
  type RouteRecordRaw,
  type Router,
} from "vue-router";
import App from "@/App.vue";
import i18n from "@/i18n";

type MountGlobalOptions = NonNullable<MountingOptions<Component>["global"]>;

export interface UserFlowAppContext {
  pinia: Pinia;
  router: Router;
  i18n: typeof i18n;
}

export interface CreateUserFlowAppContextOptions {
  initialPiniaState?: Record<string, StateTree>;
  initialRoute?: string;
  routes?: RouteRecordRaw[];
}

export interface MountUserFlowOptions {
  component?: Component;
  props?: Record<string, unknown>;
  attachTo?: MountingOptions<Component>["attachTo"];
  global?: MountGlobalOptions;
  initialPiniaState?: Record<string, StateTree>;
  initialRoute?: string;
  routes?: RouteRecordRaw[];
}

export interface MountedUserFlowApp extends UserFlowAppContext {
  wrapper: VueWrapper;
  unmount: () => void;
}

const EmptyRouteView = defineComponent({
  name: "UserFlowEmptyRouteView",
  setup() {
    return () => h("div");
  },
});

function createDefaultRoutes(): RouteRecordRaw[] {
  return [
    {
      path: "/",
      name: "home",
      component: EmptyRouteView,
    },
    {
      path: "/:pathMatch(.*)*",
      name: "not-found",
      component: EmptyRouteView,
    },
  ];
}

export function createUserFlowAppContext(
  options: CreateUserFlowAppContextOptions = {},
): UserFlowAppContext {
  const pinia = createPinia();
  pinia.state.value = { ...(options.initialPiniaState ?? {}) };
  setActivePinia(pinia);

  const router = createRouter({
    history: createMemoryHistory(),
    routes: options.routes ?? createDefaultRoutes(),
  });

  return {
    pinia,
    router,
    i18n,
  };
}

export async function mountUserFlowApp(
  options: MountUserFlowOptions = {},
): Promise<MountedUserFlowApp> {
  const component = options.component ?? App;
  const context = createUserFlowAppContext(options);

  await context.router.push(options.initialRoute ?? "/");
  await context.router.isReady();

  const globalPlugins = [
    context.pinia,
    context.router,
    context.i18n,
    ...(options.global?.plugins ?? []),
  ];

  const wrapper = mount(component, {
    props: options.props,
    attachTo: options.attachTo,
    global: {
      ...options.global,
      plugins: globalPlugins,
    },
  });

  return {
    ...context,
    wrapper,
    unmount: () => wrapper.unmount(),
  };
}
