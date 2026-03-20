import { ref, onScopeDispose, type Ref } from "vue";

interface PluginMenuPosition {
  x: number;
  y: number;
}

interface UsePluginSubMenuReturn {
  showPluginSubMenu: Ref<boolean>;
  pluginMenuPosition: Ref<PluginMenuPosition>;
  handlePluginMenuEnter: (event: MouseEvent) => void;
  handlePluginMenuLeave: () => void;
  handlePluginSubMenuCancelClose: () => void;
  handlePluginSubMenuClose: () => void;
}

export function usePluginSubMenu(): UsePluginSubMenuReturn {
  const showPluginSubMenu = ref(false);
  const pluginMenuPosition = ref<PluginMenuPosition>({ x: 0, y: 0 });
  let pluginCloseTimer: ReturnType<typeof setTimeout> | null = null;

  function handlePluginMenuEnter(event: MouseEvent): void {
    if (pluginCloseTimer !== null) {
      clearTimeout(pluginCloseTimer);
      pluginCloseTimer = null;
    }
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    pluginMenuPosition.value = {
      x: rect.right,
      y: rect.top,
    };
    showPluginSubMenu.value = true;
  }

  function handlePluginMenuLeave(): void {
    pluginCloseTimer = setTimeout(() => {
      showPluginSubMenu.value = false;
      pluginCloseTimer = null;
    }, 150);
  }

  function handlePluginSubMenuCancelClose(): void {
    if (pluginCloseTimer !== null) {
      clearTimeout(pluginCloseTimer);
      pluginCloseTimer = null;
    }
  }

  function handlePluginSubMenuClose(): void {
    showPluginSubMenu.value = false;
    if (pluginCloseTimer !== null) {
      clearTimeout(pluginCloseTimer);
      pluginCloseTimer = null;
    }
  }

  // 元件卸載時清除未觸發的 timer，避免修改已卸載的 ref
  onScopeDispose(() => {
    if (pluginCloseTimer !== null) {
      clearTimeout(pluginCloseTimer);
      pluginCloseTimer = null;
    }
  });

  return {
    showPluginSubMenu,
    pluginMenuPosition,
    handlePluginMenuEnter,
    handlePluginMenuLeave,
    handlePluginSubMenuCancelClose,
    handlePluginSubMenuClose,
  };
}
