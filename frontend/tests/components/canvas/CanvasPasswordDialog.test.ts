import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import CanvasPasswordDialog from "@/components/canvas/CanvasPasswordDialog.vue";

// Mock Dialog 元件，讓 open prop 控制顯示
vi.mock("@/components/ui/dialog", () => ({
  Dialog: {
    name: "Dialog",
    props: ["open"],
    emits: ["update:open"],
    template: '<div v-if="open" data-testid="dialog"><slot /></div>',
  },
  DialogContent: {
    name: "DialogContent",
    emits: ["keydown"],
    template:
      '<div data-testid="dialog-content" @keydown="$emit(\'keydown\', $event)"><slot /></div>',
  },
  DialogHeader: {
    name: "DialogHeader",
    template: '<div data-testid="dialog-header"><slot /></div>',
  },
  DialogTitle: {
    name: "DialogTitle",
    template: '<div data-testid="dialog-title"><slot /></div>',
  },
  DialogFooter: {
    name: "DialogFooter",
    template: '<div data-testid="dialog-footer"><slot /></div>',
  },
}));

// Mock Button 元件
vi.mock("@/components/ui/button", () => ({
  Button: {
    name: "Button",
    props: ["variant", "disabled"],
    emits: ["click"],
    template:
      '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>',
  },
}));

// Mock Input 元件
vi.mock("@/components/ui/input", () => ({
  Input: {
    name: "Input",
    props: ["modelValue", "type", "placeholder", "disabled"],
    emits: ["update:modelValue"],
    template:
      '<input :type="type" :value="modelValue" :disabled="disabled" :placeholder="placeholder" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
}));

// Mock Loader2 icon
vi.mock("lucide-vue-next", () => ({
  Loader2: {
    name: "Loader2",
    template: '<svg data-testid="loader2" />',
  },
}));

// Mock canvasStore
const mockSetPassword = vi.fn();
const mockChangePassword = vi.fn();
const mockRemovePassword = vi.fn();
const mockVerifyPassword = vi.fn();

vi.mock("@/stores/canvasStore", () => ({
  useCanvasStore: () => ({
    setPassword: mockSetPassword,
    changePassword: mockChangePassword,
    removePassword: mockRemovePassword,
    verifyPassword: mockVerifyPassword,
  }),
}));

type Mode = "set" | "change" | "remove" | "verify";

function mountDialog(mode: Mode, open = true) {
  return mount(CanvasPasswordDialog, {
    props: {
      open,
      mode,
      canvasId: "canvas-1",
      canvasName: "測試 Canvas",
    },
  });
}

describe("CanvasPasswordDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mode=set 時應顯示密碼 + 確認密碼兩個輸入欄", () => {
    const wrapper = mountDialog("set");

    const inputs = wrapper.findAll("input");
    expect(inputs).toHaveLength(2);

    const labels = wrapper.findAll("label");
    const labelTexts = labels.map((l) => l.text());
    expect(labelTexts).toContain("密碼");
    expect(labelTexts).toContain("確認密碼");
  });

  it("mode=change 時應顯示舊密碼 + 新密碼 + 確認新密碼三個輸入欄", () => {
    const wrapper = mountDialog("change");

    const inputs = wrapper.findAll("input");
    expect(inputs).toHaveLength(3);

    const labels = wrapper.findAll("label");
    const labelTexts = labels.map((l) => l.text());
    expect(labelTexts).toContain("舊密碼");
    expect(labelTexts).toContain("新密碼");
    expect(labelTexts).toContain("確認新密碼");
  });

  it("mode=remove 時應顯示當前密碼一個輸入欄", () => {
    const wrapper = mountDialog("remove");

    const inputs = wrapper.findAll("input");
    expect(inputs).toHaveLength(1);

    const labels = wrapper.findAll("label");
    const labelTexts = labels.map((l) => l.text());
    expect(labelTexts).toContain("密碼");
    // 不應顯示確認密碼
    expect(labelTexts).not.toContain("確認密碼");
  });

  it("mode=verify 時應顯示密碼一個輸入欄", () => {
    const wrapper = mountDialog("verify");

    const inputs = wrapper.findAll("input");
    expect(inputs).toHaveLength(1);

    const labels = wrapper.findAll("label");
    const labelTexts = labels.map((l) => l.text());
    expect(labelTexts).toContain("密碼");
  });

  it("確認密碼與密碼不一致時送出按鈕應禁用", async () => {
    const wrapper = mountDialog("set");

    const inputs = wrapper.findAll("input");
    // 填入密碼
    await inputs[0]!.setValue("password123");
    // 填入不一致的確認密碼
    await inputs[1]!.setValue("different123");

    const buttons = wrapper.findAll("button");
    const submitButton = buttons.find((btn) => btn.text().includes("確認"));
    expect(submitButton).toBeDefined();
    expect(submitButton!.element.disabled).toBe(true);
  });

  it("所有欄位填寫且一致時按 Enter 應觸發 submit", async () => {
    mockSetPassword.mockResolvedValueOnce(undefined);
    const wrapper = mountDialog("set");

    const inputs = wrapper.findAll("input");
    await inputs[0]!.setValue("password123");
    await inputs[1]!.setValue("password123");

    const dialogContent = wrapper.find('[data-testid="dialog-content"]');
    await dialogContent.trigger("keydown", { key: "Enter" });

    expect(mockSetPassword).toHaveBeenCalledWith("canvas-1", "password123");
  });

  it("送出中應顯示 loading 狀態且禁用按鈕", async () => {
    // 讓 setPassword 不立即 resolve，保持 isSubmitting=true 狀態
    let resolveSubmit!: () => void;
    const pendingPromise = new Promise<void>((resolve) => {
      resolveSubmit = resolve;
    });
    mockSetPassword.mockReturnValueOnce(pendingPromise);

    const wrapper = mountDialog("set");

    const inputs = wrapper.findAll("input");
    await inputs[0]!.setValue("password123");
    await inputs[1]!.setValue("password123");

    const buttons = wrapper.findAll("button");
    const submitButton = buttons.find((btn) => btn.text().includes("確認"));
    expect(submitButton).toBeDefined();

    // 點擊送出
    await submitButton!.trigger("click");

    // 等待 Vue 更新
    await wrapper.vm.$nextTick();

    // 送出中應顯示 Loader2
    expect(wrapper.find('[data-testid="loader2"]').exists()).toBe(true);

    // 兩個按鈕都應禁用
    const allButtons = wrapper.findAll("button");
    allButtons.forEach((btn) => {
      expect(btn.element.disabled).toBe(true);
    });

    // 釋放 pending promise
    resolveSubmit();
    await wrapper.vm.$nextTick();
  });
});
