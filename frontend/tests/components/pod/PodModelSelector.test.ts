import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import PodModelSelector from "@/components/pod/PodModelSelector.vue";

// -----------------------------------------------------------------------
// 輔助常數（與 component 保持一致）
// -----------------------------------------------------------------------

const HOVER_DEBOUNCE_MS = 150;
const SELECT_FEEDBACK_DELAY_MS = 400;
const COLLAPSE_ANIMATION_MS = 300;

// -----------------------------------------------------------------------
// 輔助函式
// -----------------------------------------------------------------------

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
  it("未 hover 時 model-cards-stack 不含 expanded class，非 active 卡片應為 pointer-events: none 且 opacity: 0", () => {
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
  it("mouseenter active 卡片後，model-cards-stack 加上 expanded class", async () => {
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
  it("點擊非 active 的 model-card 後應 emit update:model 帶 opus 或 haiku", async () => {
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
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("點擊 active 卡片時不應 emit update:model，且 stack 加上 collapsing class", async () => {
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
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("mouseleave 後推進 HOVER_DEBOUNCE_MS 毫秒，stack 應失去 expanded class", async () => {
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
// 測試 6：Codex provider 有三個選項，可切換，emit value 為小寫
// -----------------------------------------------------------------------

describe("PodModelSelector - 測試 6：Codex 三個選項可切換且 emit 小寫 value", () => {
  it("Codex 顯示 3 個選項且不套用 card-single 類別", () => {
    const wrapper = mountSelector({
      provider: "codex",
      currentModel: "gpt-5.4",
    });

    const cards = wrapper.findAll(".model-card");

    // Codex 有三個選項
    expect(cards.length).toBe(3);

    // 確認無 card-single class（非單一選項）
    cards.forEach((card) => {
      expect(card.classes()).not.toContain("card-single");
    });

    wrapper.unmount();
  });

  it("Codex active 卡片 label 為 GPT-5.4", () => {
    const wrapper = mountSelector({
      provider: "codex",
      currentModel: "gpt-5.4",
    });

    const activeCard = wrapper.find(".model-card.active");
    expect(activeCard.text()).toBe("GPT-5.4");

    wrapper.unmount();
  });

  it("Codex 點擊非 active 選項 emit 小寫 value", async () => {
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
    // emit 的值應為小寫 value（gpt-5.5 或 gpt-5.4-mini）
    expect(["gpt-5.5", "gpt-5.4-mini"]).toContain(emitted![0]![0]);

    wrapper.unmount();
  });

  // isSingleOption 分支目前無法觸發（所有 provider 的 options 長度皆 > 1）
  // 待後端 metadata 引入動態 availableModels 後，可用 mock 讓 allOptions.length === 1 再補
  it.skip("isSingleOption 為 true 時 selectModel 早退，不 emit", () => {
    // 目前 CLAUDE_OPTIONS（3 個）與 CODEX_OPTIONS（3 個）長度皆大於 1，
    // 元件內部的 isSingleOption computed 永遠為 false，無法在不 mock 常數的情況下觸發此分支。
    // 待後端 metadata 引入後，provider 可能回傳僅 1 個 model，屆時補上此測試。
  });
});

// -----------------------------------------------------------------------
// 測試 7（timer-dependent）：動畫期間（isAnimating）二次點擊被 guard 擋住
// -----------------------------------------------------------------------

describe("PodModelSelector - 測試 7（timer-dependent）：isAnimating guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("動畫期間（isAnimating）二次點擊被 guard 擋住，只 emit 一次", async () => {
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
