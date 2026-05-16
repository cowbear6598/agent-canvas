<script setup lang="ts">
import { ref, computed, onUnmounted, watch } from "vue";
import type { ComponentPublicInstance } from "vue";
import { useI18n } from "vue-i18n";
import type { ModelOption, PodProvider } from "@/types/pod";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";

// disabled / disabledTooltip 來自 CanvasPod 上層的「capability OR 訊息鎖」合併判定，
// 本元件僅負責 UI 鎖定（停用 hover 展開、停用點選、降透明度、顯示 tooltip）。
const props = defineProps<{
  podId: string;
  currentModel: string;
  provider: PodProvider;
  disabled?: boolean;
  disabledTooltip?: string;
}>();

const emit = defineEmits<{
  "update:model": [model: string];
}>();

/** 收合動畫總時長（毫秒）：與 CSS transition 0.3s 對齊，確保動畫完全結束後才重設狀態 */
const COLLAPSE_ANIMATION_MS = 300;
/** 選取 feedback 等待時間（毫秒）：讓使用者看到選取視覺回饋後再觸發收合動畫，400ms 為自然停頓感 */
const SELECT_FEEDBACK_DELAY_MS = 400;

const isHovered = ref(false);
const isAnimating = ref(false);
const isCollapsing = ref(false);
const hoverTimeoutId = ref<ReturnType<typeof setTimeout> | null>(null);
const pendingTimers = ref<Set<ReturnType<typeof setTimeout>>>(new Set());

/**
 * TransitionGroup 的 component ref，用來取得 stack root DOM
 * 以便在 mouseleave 時將 scrollTop 重置回視覺底部（column-reverse 的 0），
 * 避免移除 max-height 時 active 卡片從中段「跳」回貼 Pod 底部。
 */
const stackComp = ref<ComponentPublicInstance | null>(null);

/**
 * 建立一個受追蹤的計時器，並回傳 Promise。
 * 內部封裝 setTimeout 的建立與 pendingTimers Set 的追蹤；
 * 元件 unmount 時 onUnmounted 會清掉所有 pendingTimers，
 * 確保所有 timer 都不會在 unmount 後意外觸發。
 * unmount 後若 await 回來，呼叫端應檢查 isUnmounted 決定是否提前退出。
 */
function createTrackedTimer(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const id = setTimeout(() => {
      pendingTimers.value.delete(id);
      resolve();
    }, ms);
    pendingTimers.value.add(id);
  });
}

/** createTrackedTimer 的語意別名，提升呼叫端可讀性 */
function sleep(ms: number): Promise<void> {
  return createTrackedTimer(ms);
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

// disabled 變 true 時強制重置展開狀態：因為 disabled 後 pointer-events 被拔掉，
// @mouseleave 不再觸發，若使用者送訊息瞬間 selector 正展開，會卡在展開狀態無法收合。
watch(
  () => props.disabled,
  (next) => {
    if (!next) return;
    if (hoverTimeoutId.value !== null) {
      clearTimeout(hoverTimeoutId.value);
      hoverTimeoutId.value = null;
    }
    pendingTimers.value.forEach(clearTimeout);
    pendingTimers.value.clear();
    isHovered.value = false;
    isCollapsing.value = false;
    isAnimating.value = false;
  },
);

const { t } = useI18n();

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
 * opencode provider 且 availableModels 為空時，顯示 placeholder 並停用 selector。
 * 此狀態下 selector 呈現 disabled 樣式（沿用 .pod-model-slot--disabled），
 * 不展開、不 emit。
 */
const isOpencodeEmpty = computed(
  (): boolean => props.provider === "opencode" && allOptions.value.length === 0,
);

/**
 * 任意 provider 的 availableModels > 4 時，套用捲動限高 class +
 * 顯示頂部呼吸箭頭。實務上 claude / codex / opencode 是寫死的小清單通常 ≤ 4 個，
 * 只有 opencode 動態載入時會超過；但邏輯不綁 provider，純看數量更乾淨，
 * 未來 provider 模型清單變多也能自動套用。
 */
const isScrollable = computed((): boolean => allOptions.value.length > 4);

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

/**
 * 依 provider 動態決定每張卡片的背景色 class。
 * 命名規則：`card-{provider}`，新增 provider 時只需在 CSS 加一條 rule，不需改 template。
 */
const providerCardClass = computed(() => `card-${props.provider}`);

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
  // disabled 時不展開動畫
  if (props.disabled) return;
  // 單一選項仍允許展開動畫，但不允許切換
  if (isAnimating.value) return;

  if (hoverTimeoutId.value !== null) {
    clearTimeout(hoverTimeoutId.value);
    hoverTimeoutId.value = null;
  }
  // 滑回時若 mouseleave 後還在 collapse 動畫期間，立即解除 collapsing 狀態，
  // 避免 .collapsing 樣式蓋住 .expanded 的展開規則導致卡片不展開。
  isCollapsing.value = false;
  isHovered.value = true;
};

const handleMouseLeave = async (): Promise<void> => {
  if (isAnimating.value) return;

  // 清掉任何 pending hover timer（保留以防競態，目前已無 debounce 但結構保留）
  if (hoverTimeoutId.value !== null) {
    clearTimeout(hoverTimeoutId.value);
    hoverTimeoutId.value = null;
  }

  // 收合前把 stack scroll 位置滾回視覺底部（column-reverse 下 scrollTop=0 即底部），
  // 用 smooth scroll 與接下來的 collapse 動畫同步滑動，不會「跳一下」。
  const stackEl = stackComp.value?.$el as HTMLElement | undefined;
  if (stackEl && stackEl.scrollTop !== 0) {
    stackEl.scrollTo({ top: 0, behavior: "smooth" });
  }

  // mouseleave 立即觸發收合，不再 debounce —— 否則 user 感覺箭頭與卡片
  // 延遲消失。stack 邊緣的容錯由 ::before 偽元素的擴展區處理。
  isHovered.value = false;
  isCollapsing.value = true;
  await sleep(COLLAPSE_ANIMATION_MS);
  if (isUnmounted) return;
  // mouseenter 期間已被 handleMouseEnter 重置時 isHovered=true，這裡不再覆寫；
  // 否則正常解除 collapsing。
  if (!isHovered.value) {
    isCollapsing.value = false;
  }
};

const selectModel = async (model: string): Promise<void> => {
  // disabled 時不允許切換
  if (props.disabled) return;
  // 單一選項時點擊不做任何事
  if (isSingleOption.value) return;
  if (isAnimating.value || isCollapsing.value) return;

  // 以 providerCapabilityStore 的 availableModels 為白名單（透過 effectiveOptions 取得），
  // 不在清單內時直接 return 不 emit，防止 devtools 偽造非法 model 值
  if (!effectiveOptions.value.some((o) => o.value === model)) return;

  // 鎖定選取值：async 函式後續的 await 期間 props.currentModel 可能被外部更新，
  // 用 local const 避免後續比較或 emit 時讀到新值造成競態
  const selectedValue = model;

  if (selectedValue === props.currentModel) {
    // 點擊 active 選項：直接收合
    isCollapsing.value = true;
    await sleep(COLLAPSE_ANIMATION_MS);
    if (isUnmounted) return;
    isHovered.value = false;
    isCollapsing.value = false;
    return;
  }

  isAnimating.value = true;
  emit("update:model", selectedValue);

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
    :class="{ 'pod-model-slot--disabled': disabled || isOpencodeEmpty }"
    :aria-disabled="disabled || isOpencodeEmpty || undefined"
    :title="
      isOpencodeEmpty
        ? t('pod.modelSelector.opencode.emptyPlaceholder')
        : disabled
          ? disabledTooltip
          : undefined
    "
  >
    <!--
      opencode 且 availableModels 為空：顯示 placeholder 文字，沿用 disabled 樣式鎖定。
    -->
    <div
      v-if="isOpencodeEmpty"
      class="model-card model-card--placeholder card-opencode active"
    >
      {{ t("pod.modelSelector.opencode.emptyPlaceholder") }}
    </div>

    <!--
      model-cards-stack：垂直堆疊容器。
      flex-direction: column-reverse → sortedOptions[0]（active）視覺上固定在最底部貼近 Pod，
      非 active 選項從上方依序堆疊，hover 時展開。
      @mouseleave 移到此層：.pod-model-slot 為 pointer-events: none 不接收 mouse 事件，
      展開時 stack 為 pointer-events: auto，可靠地偵測滑鼠移出整個 stack 範圍。
      opencode 且 availableModels > 4：套用 max-h + overflow-y-auto 限制捲動高度。
    -->
    <TransitionGroup
      v-else
      ref="stackComp"
      name="stack-slide"
      tag="div"
      class="model-cards-stack"
      :class="{
        expanded: isHovered,
        collapsing: isCollapsing,
        'model-cards-stack--scrollable': isScrollable,
      }"
      @mouseleave="handleMouseLeave"
      @wheel.stop.passive
    >
      <button
        v-for="option in sortedOptions"
        :key="option.value"
        class="model-card"
        :class="[
          providerCardClass,
          {
            active: option.value === currentModel,
            'card-single': isSingleOption,
          },
        ]"
        @mouseenter="option.value === currentModel && handleMouseEnter()"
        @click.stop="selectModel(option.value)"
      >
        {{ option.label }}
      </button>
    </TransitionGroup>

    <!--
      模型數 > 4 個且展開時，stack 上方顯示呼吸塗鴉箭頭提示「還可往上捲」。
      位置：定位於 .pod-model-slot 的 padding 區之外（top 為負值），不蓋到任何 model card。
      樣式：飽滿塗鴉箭頭（fill + 粗描邊 + 圓角邊），呼應 doodle 風格。
      Transition 包覆：避免 mouseleave 瞬間 v-if 直接 unmount 造成「啵」的視覺跳動。
      pointer-events: none 不攔截滑鼠，aria-hidden 對 SR 友善（重複資訊）。
    -->
    <Transition name="scroll-hint-fade">
      <div
        v-if="isScrollable && isHovered"
        class="model-cards-stack__scroll-hint"
        aria-hidden="true"
      >
        <!--
          塗鴉風飽滿箭頭：三角頭 + 短柄組合 + 暖黃填色 + 深色粗描邊。
          路徑邊角微歪、用 Q 二次貝茲做圓滑頂點，模擬手繪不規則感。
        -->
        <svg
          viewBox="0 0 32 22"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M16 2.8 Q16.6 2.6 17.2 3.2 L28.6 14.6 Q29.4 15.4 28.4 16.1 L21 16.1 L21 18.6 Q21 19.8 19.8 19.8 L12.2 19.8 Q11 19.8 11 18.6 L11 16.1 L3.6 16.1 Q2.6 15.4 3.4 14.6 L14.8 3.2 Q15.4 2.6 16 2.8 Z"
            fill="oklch(0.82 0.16 80)"
            stroke="oklch(0.28 0.04 50)"
            stroke-width="2.2"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
        </svg>
      </div>
    </Transition>
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
   pointer-events: none 讓未展開時 padding 容錯區可被 mousedown 穿透到 canvas，
   避免造成死區（box-select 與 pod 拖曳均不受影響）。
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
  /* pointer-events: none 讓未展開時 padding 容錯區可被 mousedown 穿透到 canvas，避免死區 */
  pointer-events: none;
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
     --model-notch-width 定義於 .pod-wrapper（共同祖先），
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
  /* 偽元素僅作視覺占位/容錯區，不攔截滑鼠事件 */
  pointer-events: none;
  background: transparent;
  z-index: -1;
}

/* 展開狀態：整體上提讓選項展開空間（從 2px 往上移到 -12px，共 14px 行程） */
/* 展開時容器接事件，配合移到 stack 上的 @mouseleave 偵測整體離開以觸發收合 */
.model-cards-stack.expanded {
  transform: translateY(-12px);
  pointer-events: auto;
}

/* .model-card：橫向 tag 樣式 */
.model-card {
  /* 直接寫死 notch × 0.85，避免依賴 width: 100% 在 button 上失效
     --model-notch-width 定義於 .pod-wrapper（共同祖先，pod.css） */
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

/*
  disabled 狀態：由 CanvasPod 上層依「capability OR 訊息鎖」合併決定。
  - 對 model-card 套用降透明度與 not-allowed 游標，視覺上提示無法操作。
  - 停用 pointer-events 阻止 hover 展開與點選；
    active 卡片的 tooltip 由根層 .pod-model-slot 的 :title 接手顯示。
*/
/*
  disabled 強制收合：覆蓋 .expanded 與 .model-card 的展開規則。
  - active 卡片仍可見（opacity 0.5 表示鎖定），其他卡片強制 opacity 0、移出視覺。
  - transition: none 避免清空對話 / 開始對話時的展開或收合動畫，瞬間切換。
  - pointer-events: none 阻止 hover / click。
*/
.pod-model-slot--disabled .model-card {
  cursor: not-allowed;
  pointer-events: none;
  transition: none;
}

.pod-model-slot--disabled .model-card.active {
  opacity: 0.5;
}

.pod-model-slot--disabled .model-cards-stack,
.pod-model-slot--disabled .model-cards-stack.expanded {
  transform: translateY(2px);
  pointer-events: none;
  transition: none;
}

.pod-model-slot--disabled .model-cards-stack .model-card:not(.active) {
  opacity: 0;
  transform: translateY(8px);
}

/* --------------------------------
   Provider / Model 背景色
   --------------------------------
   每個 provider 用一個對應 Pod 色相的底色，所有該 provider 的 model 共用。
*/
/* Claude：磚紅背景，對齊 Pod 漸層色相 */
.card-claude {
  background: oklch(0.88 0.07 45);
}

/* Codex：中性灰色背景 */
.card-codex {
  background: oklch(0.9 0.005 240);
}

/* Opencode：淺橄欖綠背景 */
.card-opencode {
  background: oklch(0.9 0.04 130);
}

/* --------------------------------
   模型數 > 4 時的捲動限高（任意 provider 都套用）
   --------------------------------
   --pod-model-selector-max-h：貼合 4 張卡片的高度
   （每張約 26px 含 gap 4px，合計約 120px；加上 stack padding 2px）。
   .model-cards-stack--scrollable：套用限高 + overflow，並完全隱藏 scrollbar
   （改用上方的呼吸箭頭做為「還可往上捲」提示，避免 scrollbar 視覺被 Pod 邊壓到）。
   設計決策：max-height 永遠生效（不依賴 .expanded / .collapsing），
   原因是若只在展開/收合時生效，collapse 動畫結束的瞬間 max-height 會從
   120px → unset，stack 自然高度撐到 ~156px，雖然非 active 卡片 opacity:0
   不可見，但 column-reverse layout 重排會讓 model 卡片視覺殘影像「重新插入」。
   永遠維持 max-height 後，hover 切換不會造成任何 layout 跳動。
   未 hover 時 active 在 stack 視覺底部，上方卡片 opacity:0 + overflow 裁切，
   視覺上跟原本「自然高度」一模一樣，但 layout 穩定。
*/
.model-cards-stack--scrollable {
  --pod-model-selector-max-h: 120px;
  max-height: var(--pod-model-selector-max-h);
  overflow-y: auto;
  /* Firefox：隱藏 scrollbar */
  scrollbar-width: none;
}

/* WebKit / Blink：隱藏 scrollbar */
.model-cards-stack--scrollable::-webkit-scrollbar {
  display: none;
}

/* --------------------------------
   頂部呼吸 chevron：提示「上方還有更多選項可捲動」
   --------------------------------
   定位：top: -14px 把 chevron 移出 .pod-model-slot 的 padding 區（padding-top: 8px），
   避免與第一張 model card 視覺重疊。
   樣式：SVG 手繪 chevron（QBezier 弧線 + round linecap）+ 微傾斜 + drop-shadow，
   呼應 doodle 風格，不再是冷硬的 mono ↑ 字元。
   呼吸動畫：opacity + y 偏移雙軸，1.4s 循環，不刺激。
*/
.model-cards-stack__scroll-hint {
  position: absolute;
  /* 推遠離 .pod-model-slot 的 padding 區，徹底避開 model card 視覺範圍 */
  top: -32px;
  /* 水平置中：left: 50% + margin-left: -width/2，
     不依賴 transform 做置中，這樣 keyframe 取消 animation 時不會丟失 translateX 而往右偏。 */
  left: 50%;
  width: 32px;
  height: 22px;
  margin-left: -16px;
  pointer-events: none;
  user-select: none;
  filter: drop-shadow(1.5px 1.5px 0 oklch(0.3 0.02 50 / 0.35));
  animation: scroll-hint-breath 1.3s ease-in-out infinite;
}

.model-cards-stack__scroll-hint svg {
  display: block;
  width: 100%;
  height: 100%;
  /* 微傾斜，加強手繪感 */
  transform: rotate(-3deg);
}

/*
  呼吸動畫只控制 Y 軸位移（上下飄動），不做 scale、不改 opacity。
  注意：不能在 keyframe 控制 opacity —— CSS animation 的 opacity 優先級高於 transition，
  會讓 .scroll-hint-fade-leave-active 的 fade 失效，箭頭卡在呼吸狀態永不消失。
*/
@keyframes scroll-hint-breath {
  0%,
  100% {
    transform: translateY(2px);
  }
  50% {
    transform: translateY(-4px);
  }
}

/* mouseleave 時的 fade 轉場：避免直接 unmount 的視覺跳動 */
.scroll-hint-fade-enter-active {
  transition: opacity 0.18s ease-out;
}

.scroll-hint-fade-leave-active {
  /* 離開時 animation 繼續跑（transform 不會瞬間歸位），
     opacity 由此 transition 從 base 1 平滑淡到 0。
     0.3s：對齊 .model-card 的 collapse transition，箭頭與卡片同時開始/結束。
     注意：keyframe 不能控制 opacity，否則 animation 會壓過 transition 導致 fade 無效。 */
  transition: opacity 0.3s ease;
}

.scroll-hint-fade-enter-from,
.scroll-hint-fade-leave-to {
  opacity: 0;
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
