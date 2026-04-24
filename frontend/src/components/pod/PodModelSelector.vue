<script setup lang="ts">
import { ref, computed, onUnmounted } from "vue";
import type { ModelOption, PodProvider } from "@/types/pod";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";

const props = defineProps<{
  podId: string;
  currentModel: string;
  provider: PodProvider;
}>();

const emit = defineEmits<{
  "update:model": [model: string];
}>();

const HOVER_DEBOUNCE_MS = 150;
const COLLAPSE_ANIMATION_MS = 300;
const SELECT_FEEDBACK_DELAY_MS = 400;

const isHovered = ref(false);
const isAnimating = ref(false);
const isCollapsing = ref(false);
const hoverTimeoutId = ref<ReturnType<typeof setTimeout> | null>(null);
const pendingTimers = ref<Set<ReturnType<typeof setTimeout>>>(new Set());

/** 追蹤 timer 並回傳 Promise，元件 unmount 後若 await 回來可檢查 isUnmounted */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const id = setTimeout(() => {
      pendingTimers.value.delete(id);
      resolve();
    }, ms);
    pendingTimers.value.add(id);
  });
}

/** 元件 unmount 後設為 true，供 async 函式提前退出 */
let isUnmounted = false;

onUnmounted(() => {
  isUnmounted = true;
  // 清掉 hover debounce timer
  if (hoverTimeoutId.value !== null) {
    clearTimeout(hoverTimeoutId.value);
    hoverTimeoutId.value = null;
  }
  // 清掉所有 pending select/collapse timer
  pendingTimers.value.forEach(clearTimeout);
  pendingTimers.value.clear();
});

const providerCapabilityStore = useProviderCapabilityStore();

/**
 * 依 provider 動態決定可選模型清單。
 * 由 providerCapabilityStore 統一管理各 provider 的 availableModels，
 * 後端於 provider:list 回應中帶入；store 尚未載入時會回傳空陣列。
 */
const allOptions = computed((): ReadonlyArray<ModelOption> => {
  return providerCapabilityStore.getAvailableModels(props.provider);
});

/**
 * Fallback 用的 effectiveOptions：
 * - 若 store 尚未載入（WebSocket 連線瞬間未完成或斷線中），allOptions 為空陣列，
 *   此時退回只顯示 currentModel 一張卡片，避免選擇器空白或出錯。
 * - 否則直接使用 allOptions。
 * sortedOptions、isSingleOption、selectModel 皆以 effectiveOptions 為依據。
 */
const effectiveOptions = computed((): ReadonlyArray<ModelOption> => {
  if (allOptions.value.length === 0) {
    return [{ label: props.currentModel, value: props.currentModel }];
  }
  return allOptions.value;
});

/** 單一選項時不開放切換，也不展開多張卡片 */
const isSingleOption = computed(() => effectiveOptions.value.length === 1);

/** 單次迴圈同時收集 active 與 others，避免兩次掃描 */
const sortedOptions = computed((): ModelOption[] => {
  const active: ModelOption[] = [];
  const others: ModelOption[] = [];
  for (const o of effectiveOptions.value) {
    if (o.value === props.currentModel) {
      active.push(o);
    } else {
      others.push(o);
    }
  }
  return active.length > 0
    ? [...active, ...others]
    : [...effectiveOptions.value];
});

const handleMouseEnter = (): void => {
  // 單一選項仍允許展開動畫，但不允許切換
  if (isAnimating.value) return;

  if (hoverTimeoutId.value !== null) {
    clearTimeout(hoverTimeoutId.value);
    hoverTimeoutId.value = null;
  }
  isHovered.value = true;
};

const handleMouseLeave = (): void => {
  if (isAnimating.value) return;

  hoverTimeoutId.value = setTimeout(() => {
    isHovered.value = false;
    hoverTimeoutId.value = null;
  }, HOVER_DEBOUNCE_MS);
};

const selectModel = async (model: string): Promise<void> => {
  // 單一選項時點擊不做任何事
  if (isSingleOption.value) return;
  if (isAnimating.value || isCollapsing.value) return;

  // 以 providerCapabilityStore 的 availableModels 為白名單（透過 effectiveOptions 取得），
  // 不在清單內時直接 return 不 emit，防止 devtools 偽造非法 model 值
  if (!effectiveOptions.value.some((o) => o.value === model)) return;

  if (model === props.currentModel) {
    // 點擊 active 選項：直接收合
    isCollapsing.value = true;
    await sleep(COLLAPSE_ANIMATION_MS);
    if (isUnmounted) return;
    isHovered.value = false;
    isCollapsing.value = false;
    return;
  }

  isAnimating.value = true;
  emit("update:model", model);

  // 視覺 feedback 後觸發收合動畫
  await sleep(SELECT_FEEDBACK_DELAY_MS);
  if (isUnmounted) return;
  isCollapsing.value = true;

  await sleep(COLLAPSE_ANIMATION_MS);
  if (isUnmounted) return;
  isHovered.value = false;
  isCollapsing.value = false;
  isAnimating.value = false;
};
</script>

<template>
  <!-- 上方中央定位錨點 -->
  <div
    class="pod-model-slot"
    @mouseleave="handleMouseLeave"
  >
    <!--
      model-cards-stack：垂直堆疊容器。
      flex-direction: column-reverse → sortedOptions[0]（active）視覺上固定在最底部貼近 Pod，
      非 active 選項從上方依序堆疊，hover 時展開。
    -->
    <TransitionGroup
      name="stack-slide"
      tag="div"
      class="model-cards-stack"
      :class="{ expanded: isHovered, collapsing: isCollapsing }"
    >
      <button
        v-for="option in sortedOptions"
        :key="option.value"
        class="model-card"
        :class="{
          active: option.value === currentModel,
          'card-single': isSingleOption,
          'card-opus': option.value === 'opus',
          'card-sonnet': option.value === 'sonnet',
          'card-haiku': option.value === 'haiku',
          'card-codex': provider === 'codex',
        }"
        @mouseenter="option.value === currentModel && handleMouseEnter()"
        @click.stop="selectModel(option.value)"
      >
        {{ option.label }}
      </button>
    </TransitionGroup>
  </div>
</template>

<style scoped>
/*
  Pod Model Selector CSS
  ====================================================
  .pod-model-slot     : 定位錨點，絕對定位在 Pod 上方中央
  .model-cards-stack  : 垂直堆疊容器（column-reverse；active 在底部貼 Pod）
  .model-card         : 橫向 tag 卡片，等寬、padding 水平排列
*/

/* --------------------------------
   定位錨點：Pod 上方中央
   --------------------------------
   bottom: 100% 讓整個 selector 在 Pod 上緣外。
   left: 50% + translateX(-50%) 對齊 Pod 水平中心。
   margin-bottom: -2px 下推 2px 讓 active card 底邊與 Pod 邊框對齊 notch
   （配合 .model-cards-stack 預設 translateY(2px)，共下推 4px，
   讓卡片底部邊框與 Pod 上邊框微微重疊產生「插槽」視覺）。
   z-index: -1 讓 selector 插入 Pod 內（被 Pod 本體遮住底部），
   只露出上方部分，產生「插進 Pod」的視覺感。
   pointer-events 由子元素 .model-cards-stack 與 .model-card 各自控制，
   z-index 負值不影響 click 事件觸發。
   padding 向上與左右延伸作為 hover 容錯區（搭配 ::before 偽元素）。
*/
.pod-model-slot {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  width: fit-content;
  /* 下推 2px 讓底邊與 Pod 邊框對齊 notch */
  margin-bottom: -2px;
  z-index: -1;
  /* 向上與左右延伸 hover 容錯區，使 mouseleave 不在縫隙處誤觸 */
  padding: 8px 12px 0 12px;
}

/*
  model-cards-stack：垂直堆疊容器。
  column-reverse 讓 sortedOptions[0]（active）視覺固定在最底部貼近 Pod；
  非 active 卡片從上方往下堆疊，hover 展開時向上顯現。
  預設輕微往下位移（貼 Pod）；展開時整體上提讓選項有空間展開。
  ::before 偽元素向上、左右擴展 hover 判定區，防止卡片縫隙間誤觸 mouseleave。
  寬度：由 --model-notch-width × 0.85 決定（notch 與 card 永遠保持 15% 差距規則）。
*/
.model-cards-stack {
  display: flex;
  flex-direction: column-reverse;
  align-items: stretch;
  gap: 4px;
  position: relative;
  /* notch 與 card 永遠保持 15% 差距：card = notch × 0.85
     --model-notch-width 定義於 .pod-with-notch（共同祖先），
     PodModelSelector 與 .pod-doodle 皆可繼承此變數 */
  width: calc(var(--model-notch-width) * 0.85);
  /* 預設只有 active 卡片可互動；.expanded 後開放整個容器 */
  pointer-events: none;
  transition: transform 0.3s ease;
  /* 下推 2px 配合 margin-bottom: -2px，讓底邊與 Pod 邊框剛好重疊 */
  transform: translateY(2px);
}

/* 上方容錯 hover 區：透明，防止滑鼠在卡片縫隙間誤觸 mouseleave */
.model-cards-stack::before {
  content: "";
  position: absolute;
  top: -16px;
  left: -16px;
  right: -16px;
  bottom: 0;
  pointer-events: auto;
  background: transparent;
  z-index: -1;
}

/* 展開狀態：整體上提讓選項展開空間（從 2px 往上移到 -12px，共 14px 行程） */
.model-cards-stack.expanded {
  transform: translateY(-12px);
  pointer-events: auto;
}

/* .model-card：橫向 tag 樣式 */
.model-card {
  /* 直接寫死 notch × 0.85，避免依賴 width: 100% 在 button 上失效
     --model-notch-width 定義於 .pod-with-notch（共同祖先，pod.css） */
  width: calc(var(--model-notch-width) * 0.85);
  /* border-box 確保 padding 不增加視覺寬度 */
  box-sizing: border-box;
  /* column-reverse flex 容器內防止 button 被 flex-shrink 壓縮 */
  flex-shrink: 0;
  /* text-align: center 確保名稱文字始終置中（無論文字長度） */
  text-align: center;
  padding: 4px 10px;
  border: 2px solid var(--doodle-ink);
  border-radius: 2px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: normal;
  color: oklch(0.3 0.02 50);
  box-shadow: 2px 2px 0 oklch(0.4 0.02 50 / 0.3);
  cursor: pointer;
  /* 預設隱藏：稍微往下位移，展開時滑上來 */
  opacity: 0;
  transform: translateY(8px);
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
  white-space: nowrap;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

/* active 卡片永遠可見，位移回零（貼底部） */
.model-card.active {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

/* hover 展開時，非 active 卡片從下方滑入並可互動 */
.model-cards-stack.expanded .model-card:not(.active) {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

/* 收合動畫：非 active 卡片淡出並往下滑出 */
.model-cards-stack.collapsing .model-card:not(.active) {
  opacity: 0;
  transform: translateY(8px);
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}

.model-card:hover {
  box-shadow: 3px 3px 0 oklch(0.4 0.02 50 / 0.4);
}

/* 單一選項：cursor 提示無法切換，但仍允許 hover 事件 */
.model-card.card-single {
  cursor: default;
}

/* --------------------------------
   Provider / Model 背景色
   --------------------------------
   保留各 model 特色色彩；移除垂直文字時代的 letter-spacing hack。
*/
.card-opus {
  background: var(--doodle-yellow);
}

.card-sonnet {
  background: var(--doodle-light-blue);
}

.card-haiku {
  background: oklch(0.85 0.1 150);
}

/* Codex：中性灰色背景 */
.card-codex {
  background: oklch(0.9 0.005 240);
}

/* --------------------------------
   TransitionGroup stack-slide 動畫
   --------------------------------
   整組 stack 新增/移除選項時（目前 options 是靜態的，
   僅保留做未來動態 availableModels 用途）。
*/
.stack-slide-enter-active,
.stack-slide-leave-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}

.stack-slide-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}

.stack-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
