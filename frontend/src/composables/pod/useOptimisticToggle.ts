import { ref } from "vue";
import type { Ref } from "vue";
import { useToast } from "@/composables/useToast";

export interface OptimisticToggleParams<TItem> {
  /** 取得目前本地狀態（快照用） */
  getCurrent: () => TItem[];
  /** 更新本地元件狀態 */
  setLocal: (items: TItem[]) => void;
  /** 同步更新 store 狀態 */
  setStore: (items: TItem[]) => void;
  /** 呼叫後端 API */
  callApi: (items: TItem[]) => Promise<unknown>;
  /** 將錯誤轉為顯示用描述字串 */
  resolveError: (err: unknown) => string;
  /** 成功 toast 設定（選用） */
  successToast?: { title: string };
  /** 失敗 toast 設定 */
  failToast: { title: string };
}

export interface OptimisticToggleResult {
  isToggling: Ref<boolean>;
  runToggle: <TItem>(
    nextItems: TItem[],
    params: OptimisticToggleParams<TItem>,
  ) => Promise<void>;
}

/**
 * 可複用的樂觀更新 toggle composable。
 *
 * 處理：
 * 1. in-flight guard（isToggling）防止快速連按
 * 2. 樂觀更新本地狀態與 store
 * 3. 呼叫 API 失敗時自動回滾
 * 4. 失敗時顯示 toast
 *
 * 注意：canvasId 取得與 nextItems 組裝由呼叫方負責，
 * composable 不介入 canvasId 邏輯。
 */
export function useOptimisticToggle(): OptimisticToggleResult {
  const isToggling = ref(false);
  const { toast } = useToast();

  const runToggle = async <TItem>(
    nextItems: TItem[],
    params: OptimisticToggleParams<TItem>,
  ): Promise<void> => {
    // in-flight guard
    if (isToggling.value) return;
    isToggling.value = true;

    const previous = params.getCurrent();

    // 樂觀更新
    params.setLocal(nextItems);
    params.setStore(nextItems);

    try {
      await params.callApi(nextItems);

      if (params.successToast) {
        toast({ title: params.successToast.title });
      }
    } catch (err: unknown) {
      // 回滾
      params.setLocal(previous);
      params.setStore(previous);

      toast({
        title: params.failToast.title,
        description: params.resolveError(err),
        variant: "destructive",
      });
    } finally {
      isToggling.value = false;
    }
  };

  return { isToggling, runToggle };
}
