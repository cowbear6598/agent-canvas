import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { webSocketMockFactory } from "../helpers/mockWebSocket";
import { setupStoreTest } from "../helpers/testSetup";
import { createMockPod } from "../helpers/factories";
import { useGoalClipboardStore } from "@/stores/goalClipboardStore";
import { useClipboardStore } from "@/stores/clipboardStore";
import { usePodStore } from "@/stores/pod";
import GoalEditorModal from "@/components/pod/GoalEditorModal.vue";
import type { GoalTodoItem } from "@/types";
import type { CopiedPod } from "@/types/clipboard";

// WebSocket service mock（其他 store 初始化時可能間接依賴）
vi.mock("@/services/websocket", () => webSocketMockFactory());

// useToast mock：避免 toast 元件副作用干擾測試
vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: vi.fn(),
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}));

// VueDraggable 在 jsdom 中 sortable.js 無法正常運作，以 stub 替代
vi.mock("vue-draggable-plus", () => ({
  VueDraggable: {
    name: "VueDraggable",
    props: ["modelValue", "handle", "animation", "ghostClass", "chosenClass"],
    emits: ["update:modelValue", "end"],
    template: `<div class="vue-draggable-stub"><slot /></div>`,
  },
}));

// ── 輔助函式 ─────────────────────────────────────────────────────────────────

/**
 * 掛載 GoalEditorModal，預設帶 open=true。
 *
 * Dialog / DialogContent 預設透過 reka-ui DialogPortal 以 Teleport 把內容移到
 * document.body 之外，導致 wrapper.find() 找不到內部按鈕。這裡將相關元件以
 * pass-through div 取代，讓 slot 內容直接 inline 渲染在 wrapper 樹內。
 * GoalTodoEditorModal 以 stub 替代，避免巢狀 Dialog 干擾。
 */
function mountGoalEditor(pod: ReturnType<typeof createMockPod>) {
  const passthroughStub = {
    template: `<div><slot /></div>`,
  };
  return mount(GoalEditorModal, {
    props: {
      open: true,
      pod,
    },
    global: {
      stubs: {
        Dialog: passthroughStub,
        DialogContent: passthroughStub,
        DialogHeader: passthroughStub,
        DialogFooter: passthroughStub,
        DialogTitle: passthroughStub,
        GoalTodoEditorModal: true,
      },
    },
  });
}

/**
 * 取得 <script setup> 元件的內部 setup state（未 defineExpose 的屬性）。
 * 透過 Vue 內部 $.setupState 存取。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSetupState(vm: any): {
  todos: GoalTodoItem[];
  appendTodo: (text: string) => void;
} {
  return vm.$.setupState;
}

/**
 * 建立含有兩個 todo 的 Mock Pod（用於複製來源測試）
 */
function createPodWithGoal() {
  return createMockPod({
    goal: {
      todos: [
        { id: "src-todo-1", text: "第一個任務" },
        { id: "src-todo-2", text: "第二個任務" },
      ],
    },
  });
}

/**
 * 建立無 goal 的 Mock Pod（用於貼上目標測試）
 */
function createPodWithoutGoal() {
  return createMockPod({ goal: null });
}

/**
 * 建立含有兩個 todo 的 GoalTodoItem 陣列（剪貼簿注入用）
 */
function makeClipboardTodos(): GoalTodoItem[] {
  return [
    { id: "clip-todo-1", text: "剪貼簿任務 A" },
    { id: "clip-todo-2", text: "剪貼簿任務 B" },
  ];
}

// ── 測試套件 ──────────────────────────────────────────────────────────────────

describe("goalCopyPasteFlow", () => {
  let goalClipboardStore: ReturnType<typeof useGoalClipboardStore>;
  let clipboardStore: ReturnType<typeof useClipboardStore>;

  setupStoreTest();

  beforeEach(() => {
    goalClipboardStore = useGoalClipboardStore();
    clipboardStore = useClipboardStore();
    // usePodStore 初始化確認（前置條件驗證）
    usePodStore();
  });

  // ── F1：複製當前 form state todos 到 Goal 剪貼簿 ─────────────────────────────

  it("F1：複製當前 form state todos 到 Goal 剪貼簿", async () => {
    const pod = createPodWithGoal();
    const wrapper = mountGoalEditor(pod);

    const copyBtn = wrapper.find('[data-testid="goal-editor-copy"]');
    expect(copyBtn.exists()).toBe(true);
    await copyBtn.trigger("click");

    expect(goalClipboardStore.todos).toHaveLength(2);
    expect(goalClipboardStore.todos[0]).toMatchObject({
      id: "src-todo-1",
      text: "第一個任務",
    });
    expect(goalClipboardStore.todos[1]).toMatchObject({
      id: "src-todo-2",
      text: "第二個任務",
    });
    expect(goalClipboardStore.isEmpty).toBe(false);

    wrapper.unmount();
  });

  // ── F2：貼到尚未設定 goal 的 Pod ──────────────────────────────────────────────

  it("F2：貼到尚未設定 goal 的 Pod，todos 內容正確且 id 重新產生", async () => {
    // 先注入剪貼簿內容
    const clipTodos = makeClipboardTodos();
    goalClipboardStore.setGoalTodos(clipTodos);

    // Mount 一個沒有 goal 的 Pod
    const pod = createPodWithoutGoal();
    const wrapper = mountGoalEditor(pod);

    // 剪貼簿不為空，貼上按鈕應可用
    const pasteBtn = wrapper.find('[data-testid="goal-editor-paste"]');
    expect(pasteBtn.exists()).toBe(true);
    expect(pasteBtn.attributes("disabled")).toBeUndefined();

    await pasteBtn.trigger("click");
    await wrapper.vm.$nextTick();

    // 確認畫面上的 todo cards
    const cards = wrapper.findAll('[data-testid="goal-card-preview"]');
    expect(cards).toHaveLength(2);

    // 取得元件內部 todos（透過 Vue $.setupState 存取 <script setup> 未 expose 的屬性）
    const { todos: vmTodos } = getSetupState(wrapper.vm);
    expect(vmTodos).toHaveLength(2);

    // text 相同
    expect(vmTodos[0]!.text).toBe("剪貼簿任務 A");
    expect(vmTodos[1]!.text).toBe("剪貼簿任務 B");

    // id 必須不同於原剪貼簿 id（consumeAsNewTodos 產生新 UUID）
    expect(vmTodos[0]!.id).not.toBe("clip-todo-1");
    expect(vmTodos[1]!.id).not.toBe("clip-todo-2");

    wrapper.unmount();
  });

  // ── F3：貼到已有 goal 的 Pod 直接覆蓋 ────────────────────────────────────────

  it("F3：貼到已有 goal 的 Pod 直接覆蓋，不跳確認 dialog", async () => {
    // 剪貼簿放三個 todo
    const clipTodos: GoalTodoItem[] = [
      { id: "clip-a", text: "覆蓋任務 X" },
      { id: "clip-b", text: "覆蓋任務 Y" },
      { id: "clip-c", text: "覆蓋任務 Z" },
    ];
    goalClipboardStore.setGoalTodos(clipTodos);

    // Pod 原本有兩個 todo
    const pod = createPodWithGoal();
    const wrapper = mountGoalEditor(pod);

    // 原本有兩個 card
    expect(wrapper.findAll('[data-testid="goal-card-preview"]')).toHaveLength(
      2,
    );

    const pasteBtn = wrapper.find('[data-testid="goal-editor-paste"]');
    await pasteBtn.trigger("click");
    await wrapper.vm.$nextTick();

    const cards = wrapper.findAll('[data-testid="goal-card-preview"]');
    expect(cards).toHaveLength(3);

    const { todos: vmTodos } = getSetupState(wrapper.vm);
    expect(vmTodos).toHaveLength(3);
    expect(vmTodos[0]!.text).toBe("覆蓋任務 X");
    expect(vmTodos[1]!.text).toBe("覆蓋任務 Y");
    expect(vmTodos[2]!.text).toBe("覆蓋任務 Z");

    // id 全為新生成，與剪貼簿不同
    const clipIds = new Set(["clip-a", "clip-b", "clip-c"]);
    // 原 goal ids
    const origIds = new Set(["src-todo-1", "src-todo-2"]);
    for (const todo of vmTodos) {
      expect(clipIds.has(todo.id)).toBe(false);
      expect(origIds.has(todo.id)).toBe(false);
    }

    // 沒有跳出任何 confirm dialog（整個貼上流程不使用 window.confirm）
    wrapper.unmount();
  });

  // ── F4：剪貼簿為空時貼上按鈕 disabled ────────────────────────────────────────

  it("F4：剪貼簿為空時貼上按鈕 disabled", () => {
    // 不 setGoalTodos，剪貼簿為空
    expect(goalClipboardStore.isEmpty).toBe(true);

    const pod = createPodWithoutGoal();
    const wrapper = mountGoalEditor(pod);

    const pasteBtn = wrapper.find('[data-testid="goal-editor-paste"]');
    expect(pasteBtn.exists()).toBe(true);
    // reka-ui / shadcn Button 的 disabled 屬性
    expect(pasteBtn.attributes("disabled")).toBeDefined();

    wrapper.unmount();
  });

  // ── F5：貼上後再微調 todo 才儲存 ──────────────────────────────────────────────

  it("F5：貼上後再微調 todo 才儲存，submit 事件 payload 為修改後的 goal", async () => {
    // 注入兩個剪貼簿 todo
    const clipTodos = makeClipboardTodos();
    goalClipboardStore.setGoalTodos(clipTodos);

    const pod = createPodWithoutGoal();
    const wrapper = mountGoalEditor(pod);

    // 執行貼上
    const pasteBtn = wrapper.find('[data-testid="goal-editor-paste"]');
    await pasteBtn.trigger("click");
    await wrapper.vm.$nextTick();

    // 透過 Vue $.setupState 存取 todos 與 appendTodo（未 defineExpose 的內部屬性）
    const setupState = getSetupState(wrapper.vm);

    // 修改第一筆 todo 文字
    setupState.todos[0]!.text = "修改後的任務文字";

    // 追加一筆新 todo
    setupState.appendTodo("新追加的任務");
    await wrapper.vm.$nextTick();

    // 觸發儲存
    const saveBtn = wrapper.find('[data-testid="goal-editor-save"]');
    await saveBtn.trigger("click");

    const emitted = wrapper.emitted("submit");
    expect(emitted).toBeTruthy();
    expect(emitted).toHaveLength(1);

    const [payload] = emitted![0] as [{ todos: GoalTodoItem[] } | null];
    expect(payload).not.toBeNull();
    expect(payload!.todos).toHaveLength(3);
    expect(payload!.todos[0]!.text).toBe("修改後的任務文字");
    expect(payload!.todos[1]!.text).toBe("剪貼簿任務 B");
    expect(payload!.todos[2]!.text).toBe("新追加的任務");

    // id 全為新 UUID（非原剪貼簿 id）
    const origClipIds = new Set(["clip-todo-1", "clip-todo-2"]);
    for (const todo of payload!.todos) {
      expect(origClipIds.has(todo.id)).toBe(false);
    }

    wrapper.unmount();
  });

  // ── F6：重新整理頁面後 Goal 剪貼簿被清空 ──────────────────────────────────────

  it("F6：重建 Pinia 模擬重新整理後，Goal 剪貼簿清空且貼上按鈕 disabled", async () => {
    // 先注入剪貼簿並掛載編輯器
    goalClipboardStore.setGoalTodos(makeClipboardTodos());
    let wrapper = mountGoalEditor(createPodWithoutGoal());

    // 確認此時貼上按鈕可用
    expect(
      wrapper.find('[data-testid="goal-editor-paste"]').attributes("disabled"),
    ).toBeUndefined();
    wrapper.unmount();

    // 重建 Pinia，模擬重新整理頁面（Pinia 為 in-memory，reload 後 state 歸零）
    const freshPinia = createPinia();
    setActivePinia(freshPinia);

    // 重新取得 store（全新的 Pinia instance，todos 應為初始空陣列）
    const freshGoalClipboardStore = useGoalClipboardStore();
    expect(freshGoalClipboardStore.isEmpty).toBe(true);

    // 重新掛載編輯器
    wrapper = mountGoalEditor(createPodWithoutGoal());
    const pasteBtn = wrapper.find('[data-testid="goal-editor-paste"]');
    expect(pasteBtn.attributes("disabled")).toBeDefined();

    wrapper.unmount();
  });

  // ── F7：Goal 剪貼簿與 Pod 剪貼簿互不影響 ──────────────────────────────────────

  it("F7：Goal 剪貼簿與 Pod 剪貼簿互不影響，貼上仍能成功", async () => {
    // 注入 Goal 剪貼簿
    goalClipboardStore.setGoalTodos(makeClipboardTodos());

    // 注入 Pod 剪貼簿（模擬 Cmd+C 複製 Pod 操作）
    const copiedPod: CopiedPod = {
      id: "pod-copied-1",
      name: "複製的 Pod",
      x: 100,
      y: 100,
      rotation: 0,
      provider: "claude",
      providerConfig: { model: "opus" },
      repositoryId: null,
      goal: null,
    };
    clipboardStore.setCopy([copiedPod], [], []);

    // Goal 剪貼簿不受 Pod 剪貼簿 setCopy 影響
    expect(goalClipboardStore.todos).toHaveLength(2);
    expect(goalClipboardStore.isEmpty).toBe(false);
    expect(goalClipboardStore.todos[0]).toMatchObject({
      id: "clip-todo-1",
      text: "剪貼簿任務 A",
    });

    // Pod 剪貼簿內容正確
    expect(clipboardStore.copiedPods).toHaveLength(1);
    expect(clipboardStore.copiedPods[0]).toMatchObject({ id: "pod-copied-1" });

    // 在另一個 Pod 的 GoalEditorModal 中貼上，仍能成功
    const targetPod = createPodWithoutGoal();
    const wrapper = mountGoalEditor(targetPod);

    const pasteBtn = wrapper.find('[data-testid="goal-editor-paste"]');
    expect(pasteBtn.attributes("disabled")).toBeUndefined();
    await pasteBtn.trigger("click");
    await wrapper.vm.$nextTick();

    const cards = wrapper.findAll('[data-testid="goal-card-preview"]');
    expect(cards).toHaveLength(2);

    const { todos: vmTodos } = getSetupState(wrapper.vm);
    expect(vmTodos[0]!.text).toBe("剪貼簿任務 A");
    expect(vmTodos[1]!.text).toBe("剪貼簿任務 B");

    // Pod 剪貼簿內容不受 goal paste 影響，仍完整
    expect(clipboardStore.copiedPods).toHaveLength(1);

    wrapper.unmount();
  });
});
