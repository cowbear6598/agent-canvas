// 清空訊息時 reactive Map 會觸發此 computed 重算，自動解鎖 notch
import { computed, unref } from "vue";
import type { ComputedRef, MaybeRef } from "vue";
import { useChatStore } from "@/stores/chat";

/**
 * 判斷指定 Pod 是否已存在對話訊息
 * 用於決定 6 個 notch 是否需要鎖定（已有對話 → 鎖住）
 */
export function usePodHasMessages(
  podId: MaybeRef<string>,
): ComputedRef<boolean> {
  const chatStore = useChatStore();
  return computed(() => !!chatStore.messagesByPodId.get(unref(podId))?.length);
}

export default usePodHasMessages;
