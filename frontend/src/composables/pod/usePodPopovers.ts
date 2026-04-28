import { type Ref, ref } from "vue";

export interface UsePodPopoversReturn {
  showPluginPopover: Ref<boolean>;
  pluginAnchorRect: Ref<DOMRect | null>;
  handlePluginClick: (event: MouseEvent) => void;
  showMcpPopover: Ref<boolean>;
  mcpAnchorRect: Ref<DOMRect | null>;
  handleMcpClick: (event: MouseEvent) => void;
}

/**
 * 管理 CanvasPod 的 Plugin / MCP popover 開關狀態與點擊處理。
 * 抽出此 composable 以降低 CanvasPod.vue script setup 的職責數量。
 */
export function usePodPopovers(): UsePodPopoversReturn {
  const showPluginPopover = ref(false);
  const pluginAnchorRect = ref<DOMRect | null>(null);

  const handlePluginClick = (event: MouseEvent): void => {
    // 已開啟時點擊視為 toggle 關閉
    if (showPluginPopover.value) {
      showPluginPopover.value = false;
      return;
    }
    pluginAnchorRect.value = (
      event.currentTarget as HTMLElement
    ).getBoundingClientRect();
    showPluginPopover.value = true;
  };

  const showMcpPopover = ref(false);
  const mcpAnchorRect = ref<DOMRect | null>(null);

  const handleMcpClick = (event: MouseEvent): void => {
    // 已開啟時點擊視為 toggle 關閉
    if (showMcpPopover.value) {
      showMcpPopover.value = false;
      return;
    }
    mcpAnchorRect.value = (
      event.currentTarget as HTMLElement
    ).getBoundingClientRect();
    showMcpPopover.value = true;
  };

  return {
    showPluginPopover,
    pluginAnchorRect,
    handlePluginClick,
    showMcpPopover,
    mcpAnchorRect,
    handleMcpClick,
  };
}
