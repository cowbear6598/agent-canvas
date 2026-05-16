import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createMockPod } from "../../helpers/factories";
import i18n from "@/i18n";
import GoalEditorModal from "@/components/pod/GoalEditorModal.vue";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: { name: "Dialog", template: "<div><slot /></div>", props: ["open"] },
  DialogContent: { name: "DialogContent", template: "<div><slot /></div>" },
  DialogHeader: { name: "DialogHeader", template: "<div><slot /></div>" },
  DialogTitle: { name: "DialogTitle", template: "<div><slot /></div>" },
  DialogDescription: {
    name: "DialogDescription",
    template: "<div><slot /></div>",
  },
  DialogFooter: { name: "DialogFooter", template: "<div><slot /></div>" },
}));

vi.mock("@/components/ui/button", () => ({
  Button: {
    name: "Button",
    props: ["variant", "disabled"],
    template:
      '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>',
  },
}));

function mountGoalEditor(podOverrides = {}) {
  return mount(GoalEditorModal, {
    props: {
      open: true,
      pod: createMockPod({ id: "pod-1", name: "Pod 1", ...podOverrides }),
    },
    global: {
      plugins: [i18n],
    },
  });
}

describe("GoalEditorModal", () => {
  it("可新增多條 todo 並儲存到 Pod goal", async () => {
    const wrapper = mountGoalEditor({ goal: null });

    const initialInput = wrapper.findAll<HTMLInputElement>(
      '[data-testid="goal-editor-input"]',
    )[0];
    expect(initialInput).toBeDefined();

    await initialInput!.setValue("First task");
    await wrapper.find('[data-testid="goal-editor-add"]').trigger("click");

    const inputs = wrapper.findAll<HTMLInputElement>(
      '[data-testid="goal-editor-input"]',
    );
    await inputs[1]!.setValue("Second task");

    await wrapper.find('[data-testid="goal-editor-save"]').trigger("click");

    const submitPayload = wrapper.emitted("submit")?.[0]?.[0] as
      | { todos: Array<{ text: string }> }
      | undefined;
    expect(submitPayload).toBeTruthy();
    expect(submitPayload?.todos).toHaveLength(2);
    expect(submitPayload?.todos.map((todo) => todo.text)).toEqual([
      "First task",
      "Second task",
    ]);
  });

  it("完全空白時儲存應 emit submit(null)（Goal 已改為可選）", async () => {
    const wrapper = mountGoalEditor({ goal: null });

    await wrapper.find('[data-testid="goal-editor-save"]').trigger("click");

    expect(wrapper.emitted("submit")?.[0]).toEqual([null]);
    expect(
      wrapper.find('[data-testid="goal-editor-validation"]').exists(),
    ).toBe(false);
  });

  it("存在空白 row 時儲存應顯示驗證且不 emit submit", async () => {
    const wrapper = mountGoalEditor({ goal: null });

    await wrapper
      .findAll<HTMLInputElement>('[data-testid="goal-editor-input"]')[0]!
      .setValue("First task");
    await wrapper.find('[data-testid="goal-editor-add"]').trigger("click");
    await wrapper.find('[data-testid="goal-editor-save"]').trigger("click");

    expect(
      wrapper.find('[data-testid="goal-editor-validation"]').exists(),
    ).toBe(true);
    expect(wrapper.emitted("submit")).toBeFalsy();
  });

  it("可清空既有 Goal", async () => {
    const wrapper = mountGoalEditor({
      goal: {
        todos: [{ id: "goal-1", text: "Existing task" }],
      },
    });

    const clearButton = wrapper.find<HTMLButtonElement>(
      '[data-testid="goal-editor-clear"]',
    );
    expect(clearButton.attributes("disabled")).toBeUndefined();

    await clearButton.trigger("click");

    expect(wrapper.emitted("submit")?.[0]).toEqual([null]);
  });
});
