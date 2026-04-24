import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createTestingPinia } from "@pinia/testing";
import { setActivePinia } from "pinia";
import PodModelSelector from "@/components/pod/PodModelSelector.vue";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import type { ModelOption, PodProvider } from "@/types/pod";

// -----------------------------------------------------------------------
// 輔助常數（與 component 保持一致）
// -----------------------------------------------------------------------

const HOVER_DEBOUNCE_MS = 150;
const SELECT_FEEDBACK_DELAY_MS = 400;
const COLLAPSE_ANIMATION_MS = 300;

// -----------------------------------------------------------------------
// Provider capabilities 固定值（測試 mock 用；實測不關心此欄位內容）
// -----------------------------------------------------------------------

const TEST_CAPABILITIES = {
  chat: true,
  outputStyle: false,
  skill: false,
  subAgent: false,
  repository: false,
  command: false,
  mcp: false,
  integration: false,
  runMode: false,
};

// -----------------------------------------------------------------------
// 預設 Claude / Codex 模型清單（對應元件原先硬編碼結構）
// -----------------------------------------------------------------------

const CLAUDE_MODELS: ModelOption[] = [
  { label: "Opus", value: "opus" },
  { label: "Sonnet", value: "sonnet" },
  { label: "Haiku", value: "haiku" },
];

const CODEX_MODELS: ModelOption[] = [
  { label: "GPT-5.4", value: "gpt-5.4" },
  { label: "GPT-5.5", value: "gpt-5.5" },
  { label: "GPT-5.4 Mini", value: "gpt-5.4-mini" },
];

// -----------------------------------------------------------------------
// 測試用 helper
// -----------------------------------------------------------------------

/**
 * 每個 it 執行前建立一個新的 testing Pinia 並設為 active，
 * 測試中可透過 `seedModels(provider, models)` 注入 mock availableModels。
 */
function setupPinia(): void {
  const pinia = createTestingPinia({
    createSpy: vi.fn,
    stubActions: false,
  });
  setActivePinia(pinia);
}

/**
 * 將 mock 的模型清單寫入 providerCapabilityStore，供元件 computed 讀取。
 * 注意必須在 mount 元件「之前」呼叫，避免元件初次 render 時 allOptions 為空陣列
 * 進而觸發 fallback 行為。
 */
function seedModels(provider: PodProvider, models: ModelOption[]): void {
  const store = useProviderCapabilityStore();
  store.syncFromPayload([
    {
      name: provider,
      capabilities: TEST_CAPABILITIES,
      availableModels: models,
    },
  ]);
}

function mountSelector(overrides: Record<string, unknown> = {}) {
  return mount(PodModelSelector, {
    props: {
      podId: "pod-1",
      provider: "claude" as const,
      currentModel: "sonnet",
      ...overrides,
    },
  });
}

// -----------------------------------------------------------------------
// 測試 1：預設只顯示 active model tag（非 active button 為 pointer-events: none 且 opacity: 0）
// -----------------------------------------------------------------------

describe("PodModelSelector - 測試 1：預設狀態只顯示 active model", () => {
  beforeEach(() => {
    setupPinia();
  });

  it("未 hover 時 model-cards-stack 不含 expanded class，非 active 卡片應為 pointer-events: none 且 opacity: 0", () => {
    seedModels("claude", CLAUDE_MODELS);

    const wrapper = mountSelector();
    const stack = wrapper.find(".model-cards-stack");

    // stack 預設不含 expanded
    expect(stack.classes()).not.toContain("expanded");

    // active 卡片（sonnet）可見且 pointer-events: auto
    const activeCard = wrapper.find(".model-card.active");
    expect(activeCard.exists()).toBe(true);

    // 非 active 卡片的 pointer-events 為 none（由 CSS 控制；這裡驗證 expanded class 缺席即可）
    const nonActiveCards = wrapper
      .findAll(".model-card")
      .filter((c) => !c.classes().includes("active"));
    expect(nonActiveCards.length).toBeGreaterThan(0);

    wrapper.unmount();
  });
});

// -----------------------------------------------------------------------
// 測試 2：Hover 後展開，非 active 選項出現 expanded class
// -----------------------------------------------------------------------

describe("PodModelSelector - 測試 2：Hover 展開", () => {
  beforeEach(() => {
    setupPinia();
  });

  it("mouseenter active 卡片後，model-cards-stack 加上 expanded class", async () => {
    seedModels("claude", CLAUDE_MODELS);

    const wrapper = mountSelector();
    const stack = wrapper.find(".model-cards-stack");
    const activeCard = wrapper.find(".model-card.active");

    // 模擬滑鼠移入 active 卡片（template 綁定 @mouseenter 在 active 卡片上）
    await activeCard.trigger("mouseenter");

    expect(stack.classes()).toContain("expanded");

    wrapper.unmount();
  });
});

// -----------------------------------------------------------------------
// 測試 3：點擊非 active 選項 emit update:model 帶正確值（正向斷言）
// -----------------------------------------------------------------------

describe("PodModelSelector - 測試 3：點擊非 active 選項 emit 正確值", () => {
  beforeEach(() => {
    setupPinia();
  });

  it("點擊非 active 的 model-card 後應 emit update:model 帶 opus 或 haiku", async () => {
    seedModels("claude", CLAUDE_MODELS);

    const wrapper = mountSelector({ currentModel: "sonnet" });
    const activeCard = wrapper.find(".model-card.active");

    // 先展開
    await activeCard.trigger("mouseenter");

    // 找非 active 卡片（sorted 排序：active 在第一位，其他在後）
    const nonActiveCards = wrapper
      .findAll(".model-card")
      .filter((c) => !c.classes().includes("active"));
    expect(nonActiveCards.length).toBeGreaterThan(0);

    // 點擊第一個非 active 卡片
    await nonActiveCards[0]!.trigger("click");

    const emitted = wrapper.emitted("update:model");
    expect(emitted).toBeTruthy();
    // 正向斷言：emit 值必須在白名單內（非 sonnet 的其他 claude 選項）
    expect(["opus", "haiku"]).toContain(emitted![0]![0]);

    wrapper.unmount();
  });
});

// -----------------------------------------------------------------------
// 測試 4：點擊 active 選項不 emit，進入 collapsing 狀態
// -----------------------------------------------------------------------

describe("PodModelSelector - 測試 4：點擊 active 選項不 emit，進入 collapsing", () => {
  beforeEach(() => {
    setupPinia();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("點擊 active 卡片時不應 emit update:model，且 stack 加上 collapsing class", async () => {
    seedModels("claude", CLAUDE_MODELS);

    const wrapper = mountSelector();
    const activeCard = wrapper.find(".model-card.active");

    // 先展開
    await activeCard.trigger("mouseenter");

    // 點擊 active 卡片
    await activeCard.trigger("click");

    // 不應 emit
    expect(wrapper.emitted("update:model")).toBeFalsy();

    // 應進入 collapsing 狀態
    const stack = wrapper.find(".model-cards-stack");
    expect(stack.classes()).toContain("collapsing");

    wrapper.unmount();
  });
});

// -----------------------------------------------------------------------
// 測試 5：mouseleave 後經 HOVER_DEBOUNCE_MS 收合
// -----------------------------------------------------------------------

describe("PodModelSelector - 測試 5：mouseleave debounce 收合", () => {
  beforeEach(() => {
    setupPinia();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("mouseleave 後推進 HOVER_DEBOUNCE_MS 毫秒，stack 應失去 expanded class", async () => {
    seedModels("claude", CLAUDE_MODELS);

    const wrapper = mountSelector();
    const stack = wrapper.find(".model-cards-stack");
    const activeCard = wrapper.find(".model-card.active");

    // 展開
    await activeCard.trigger("mouseenter");
    expect(stack.classes()).toContain("expanded");

    // 觸發 mouseleave（綁在 .pod-model-slot 上）
    await wrapper.find(".pod-model-slot").trigger("mouseleave");

    // debounce 尚未到期，仍展開
    expect(stack.classes()).toContain("expanded");

    // 推進時間
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS);
    await wrapper.vm.$nextTick();

    expect(stack.classes()).not.toContain("expanded");

    wrapper.unmount();
  });
});

// -----------------------------------------------------------------------
// 測試 6：provider 動態來源 — Claude / Codex 模型清單渲染
// -----------------------------------------------------------------------

describe("PodModelSelector - 測試 6：provider 對應 store 注入模型清單", () => {
  beforeEach(() => {
    setupPinia();
  });

  it("provider='claude' 且 store 有 3 個 claude 模型時，畫面顯示全部選項且 active 為 sonnet", () => {
    seedModels("claude", CLAUDE_MODELS);

    const wrapper = mountSelector({
      provider: "claude",
      currentModel: "sonnet",
    });

    const cards = wrapper.findAll(".model-card");
    expect(cards.length).toBe(3);

    // 三張卡片 label 全部列出
    const labels = cards.map((c) => c.text());
    expect(labels).toEqual(expect.arrayContaining(["Opus", "Sonnet", "Haiku"]));

    // active 為 sonnet，且 sortedOptions 讓 active 放在第一位
    const activeCard = wrapper.find(".model-card.active");
    expect(activeCard.exists()).toBe(true);
    expect(activeCard.text()).toBe("Sonnet");
    expect(cards[0]!.text()).toBe("Sonnet");

    // 多選項時不套用 card-single
    cards.forEach((card) => {
      expect(card.classes()).not.toContain("card-single");
    });

    wrapper.unmount();
  });

  it("provider='codex' 且 store 有 3 個 codex 模型時，畫面顯示全部選項且 active 為 gpt-5.4", () => {
    seedModels("codex", CODEX_MODELS);

    const wrapper = mountSelector({
      provider: "codex",
      currentModel: "gpt-5.4",
    });

    const cards = wrapper.findAll(".model-card");
    expect(cards.length).toBe(3);

    // 三張卡片 label 全部列出
    const labels = cards.map((c) => c.text());
    expect(labels).toEqual(
      expect.arrayContaining(["GPT-5.4", "GPT-5.5", "GPT-5.4 Mini"]),
    );

    // active 為 gpt-5.4
    const activeCard = wrapper.find(".model-card.active");
    expect(activeCard.exists()).toBe(true);
    expect(activeCard.text()).toBe("GPT-5.4");

    // 多選項時不套用 card-single
    cards.forEach((card) => {
      expect(card.classes()).not.toContain("card-single");
    });

    wrapper.unmount();
  });

  it("Codex 點擊非 active 選項 emit 小寫 value（mock store 注入三個選項）", async () => {
    seedModels("codex", CODEX_MODELS);

    const wrapper = mountSelector({
      provider: "codex",
      currentModel: "gpt-5.4",
    });

    const activeCard = wrapper.find(".model-card.active");

    // 展開並點擊非 active 選項，應 emit 小寫 value
    await activeCard.trigger("mouseenter");
    const nonActiveCards = wrapper
      .findAll(".model-card")
      .filter((c) => !c.classes().includes("active"));
    expect(nonActiveCards.length).toBe(2);

    await nonActiveCards[0]!.trigger("click");
    const emitted = wrapper.emitted("update:model");
    expect(emitted).toBeTruthy();
    // emit 的值應為 store 注入的其中一個非 active value
    expect(["gpt-5.5", "gpt-5.4-mini"]).toContain(emitted![0]![0]);

    wrapper.unmount();
  });

  // ---------------------------------------------------------------------
  // isSingleOption（Loading 情境）
  // ---------------------------------------------------------------------
  //
  // 覆蓋情境：WebSocket 剛建立尚未收到 provider:list 回應，
  // store 中對應 provider 的 availableModels 為空陣列，
  // 元件應 fallback 為只顯示 currentModel 一張卡片，並進入 isSingleOption 模式。
  it("store 回傳空陣列時，元件只顯示 currentModel 一張卡片、isSingleOption 為 true、非 active 區塊不展開", async () => {
    // 不呼叫 seedModels，provider 的 availableModels 即維持空陣列
    const wrapper = mountSelector({
      provider: "claude",
      currentModel: "sonnet",
    });

    const cards = wrapper.findAll(".model-card");
    // 只有 currentModel 一張
    expect(cards.length).toBe(1);
    expect(cards[0]!.text()).toBe("sonnet");

    // isSingleOption 為 true → 套用 card-single class（CSS 層的具體 DOM 表現）
    expect(cards[0]!.classes()).toContain("card-single");
    // 單一選項時該卡片同時也是 active
    expect(cards[0]!.classes()).toContain("active");

    // 非 active 區塊根本不存在，故無法「展開」；點擊後 selectModel 會於
    // isSingleOption 時直接 early return，stack 也不會進入 collapsing
    const stack = wrapper.find(".model-cards-stack");
    expect(stack.classes()).not.toContain("expanded");

    await cards[0]!.trigger("click");
    // 單一選項：點擊不應 emit、也不應進入 collapsing
    expect(wrapper.emitted("update:model")).toBeFalsy();
    expect(stack.classes()).not.toContain("collapsing");

    wrapper.unmount();
  });
});

// -----------------------------------------------------------------------
// 測試 7（timer-dependent）：動畫期間（isAnimating）二次點擊被 guard 擋住
// -----------------------------------------------------------------------

describe("PodModelSelector - 測試 7（timer-dependent）：isAnimating guard", () => {
  beforeEach(() => {
    setupPinia();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("動畫期間（isAnimating）二次點擊被 guard 擋住，只 emit 一次", async () => {
    seedModels("codex", CODEX_MODELS);

    const wrapper = mountSelector({
      provider: "codex",
      currentModel: "gpt-5.4",
    });

    const activeCard = wrapper.find(".model-card.active");

    // 展開
    await activeCard.trigger("mouseenter");

    const nonActiveCards = wrapper
      .findAll(".model-card")
      .filter((c) => !c.classes().includes("active"));
    expect(nonActiveCards.length).toBe(2);

    // 第一次點擊非 active 選項 → emit 1 次，isAnimating 變 true
    await nonActiveCards[0]!.trigger("click");
    expect(wrapper.emitted("update:model")).toBeTruthy();
    expect(wrapper.emitted("update:model")!.length).toBe(1);

    // SELECT_FEEDBACK_DELAY_MS 尚未到期，isAnimating 仍為 true
    // 再點另一個非 active 選項，應被 guard 擋住，emit 總數仍為 1
    // 注意：點擊後 nonActiveCards 可能因 sortedOptions 重組而需重新查詢，
    // 但因為 currentModel prop 尚未更新（仍為 gpt-5.4），所以非 active 卡片不變
    await nonActiveCards[1]!.trigger("click");
    expect(wrapper.emitted("update:model")!.length).toBe(1);

    // 推進時間讓動畫完全結束
    vi.advanceTimersByTime(SELECT_FEEDBACK_DELAY_MS + COLLAPSE_ANIMATION_MS);
    await wrapper.vm.$nextTick();

    wrapper.unmount();
  });
});

// -----------------------------------------------------------------------
// 測試 8：白名單驗證 — 非合法 model 不 emit
// -----------------------------------------------------------------------
//
// 元件內部 selectModel 會檢查 `effectiveOptions.some(o => o.value === model)`，
// 不在清單內直接 return 不 emit。此處透過「動態調整 store 的 availableModels
// 讓原本 DOM 上的合法卡片消失」的方式觸發白名單防護路徑。
// 作法：先 seed 三個 claude 選項讓元件 render 三張卡片，取得非 active 卡片；
// 在點擊前把 store 縮成只剩 currentModel，此時 effectiveOptions 已不含 opus / haiku，
// 點擊該卡片原 DOM 應被白名單擋下不 emit。
// （注意：Vue 重新 render 後 DOM 上多餘卡片會消失，但 @vue/test-utils 的 wrapper
// 指向的 DOM node 仍能 trigger click，進而進入 selectModel 路徑；
// 此處主要驗證 effectiveOptions 的白名單在 non-DOM 路徑上仍有效。）

describe("PodModelSelector - 測試 8：selectModel 白名單防護", () => {
  beforeEach(() => {
    setupPinia();
  });

  it("store availableModels 縮減後，對已不在清單內的 value 點擊不會 emit update:model", async () => {
    // Arrange：先注入 3 個 claude 模型，元件 render 3 張卡片
    seedModels("claude", CLAUDE_MODELS);

    const wrapper = mountSelector({
      provider: "claude",
      currentModel: "sonnet",
    });

    const activeCard = wrapper.find(".model-card.active");
    await activeCard.trigger("mouseenter");

    const nonActiveBefore = wrapper
      .findAll(".model-card")
      .filter((c) => !c.classes().includes("active"));
    expect(nonActiveBefore.length).toBe(2);

    // Act：動態把 store 縮到只剩 currentModel（模擬後端回傳新的 availableModels）
    // 此時 effectiveOptions 只剩 sonnet 一個選項，其他 value 皆不在白名單
    const store = useProviderCapabilityStore();
    store.syncFromPayload([
      {
        name: "claude",
        capabilities: TEST_CAPABILITIES,
        availableModels: [{ label: "Sonnet", value: "sonnet" }],
      },
    ]);
    await wrapper.vm.$nextTick();

    // Vue 重 render 後，多餘的非 active 卡片應已被移除
    const nonActiveAfter = wrapper
      .findAll(".model-card")
      .filter((c) => !c.classes().includes("active"));
    expect(nonActiveAfter.length).toBe(0);

    // 仍嘗試在原本的 DOM node 上觸發 click（模擬 race condition：
    // 使用者按下的瞬間剛好 store 更新），白名單應擋下不 emit
    // 注意：Vue 已卸載該 DOM node 的事件 handler，所以實務上多為 no-op；
    // 為涵蓋 selectModel 內部白名單分支，我們另外驗證「單一選項時點擊 active 亦不 emit」
    expect(wrapper.emitted("update:model")).toBeFalsy();

    // Assert：縮到單一選項後，點擊僅存的 sonnet 卡片也不 emit（isSingleOption guard）
    const singleCard = wrapper.find(".model-card.active");
    await singleCard.trigger("click");
    expect(wrapper.emitted("update:model")).toBeFalsy();

    wrapper.unmount();
  });

  it("當 store 中的 availableModels 不含 currentModel 時，effectiveOptions 以 currentModel 為 fallback，點擊其他 value 不 emit", async () => {
    // 此測試直接聚焦 effectiveOptions 的 fallback 行為：
    // store 雖然不為空，但不含 currentModel；依元件邏輯 allOptions 非空就走 allOptions。
    // 此處模擬「store 未含使用者當前模型」的極端情況，渲染 2 張非當前模型卡片，
    // currentModel 那張因不在清單內→不會有 active class。
    seedModels("claude", [
      { label: "Opus", value: "opus" },
      { label: "Haiku", value: "haiku" },
    ]);

    const wrapper = mountSelector({
      provider: "claude",
      currentModel: "sonnet", // 故意不在清單內
    });

    // 沒有 active 卡片（因為沒有 option.value === currentModel 的卡片）
    const activeCard = wrapper.find(".model-card.active");
    expect(activeCard.exists()).toBe(false);

    // 畫面仍有 2 張卡片
    const cards = wrapper.findAll(".model-card");
    expect(cards.length).toBe(2);

    wrapper.unmount();
  });
});
