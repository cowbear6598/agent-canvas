/**
 * 同一個 pod 的資源選單可並存；一般 pod 互動則不應觸發外部點擊關閉。
 * 跨 pod 開啟資源選單時，由 CanvasContainer 統一關閉先前選單。
 */
export function shouldPreservePodResourceMenu(
  event: MouseEvent,
  podId: string,
): boolean {
  const target = event.target as Element;
  const resourceMenuPodId = target.closest<HTMLElement>(
    "[data-resource-menu-pod-id]",
  )?.dataset.resourceMenuPodId;

  return resourceMenuPodId === podId || target.closest(".pod-wrapper") !== null;
}
