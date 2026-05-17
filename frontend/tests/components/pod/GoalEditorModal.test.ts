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
    emits: ["click"],
    template:
      '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>',
  },
}));

vi.mock("vue-draggable-plus", () => ({
  VueDraggable: {
    name: "VueDraggable",
    props: ["modelValue"],
    template: "<div><slot /></div>",
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

async function openSubModalAdd(wrapper: ReturnType<typeof mountGoalEditor>) {
  await wrapper.find('[data-testid="goal-editor-add"]').trigger("click");
}

async function openSubModalEditByIndex(
  wrapper: ReturnType<typeof mountGoalEditor>,
  index: number,
) {
  const previews = wrapper.findAll('[data-testid="goal-card-preview"]');
  await previews[index]!.trigger("click");
}

async function submitSubModal(
  wrapper: ReturnType<typeof mountGoalEditor>,
  text: string,
) {
  const textarea = wrapper.find<HTMLTextAreaElement>(
    '[data-testid="goal-todo-editor-textarea"]',
  );
  await textarea.setValue(text);
  await wrapper.find('[data-testid="goal-todo-editor-save"]').trigger("click");
}

describe("GoalEditorModal", () => {
  it("可透過子 Modal 新增多條 todo 並儲存到 Pod goal", async () => {
    const wrapper = mountGoalEditor({ goal: null });

    await openSubModalAdd(wrapper);
    await submitSubModal(wrapper, "First task");

    await openSubModalAdd(wrapper);
    await submitSubModal(wrapper, "Second task");

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

  it("可透過子 Modal 編輯既有 todo 並保留順序", async () => {
    const wrapper = mountGoalEditor({
      goal: {
        todos: [
          { id: "goal-1", text: "Original A" },
          { id: "goal-2", text: "Original B" },
        ],
      },
    });

    await openSubModalEditByIndex(wrapper, 0);
    await submitSubModal(wrapper, "Updated A");

    await wrapper.find('[data-testid="goal-editor-save"]').trigger("click");

    const submitPayload = wrapper.emitted("submit")?.[0]?.[0] as
      | { todos: Array<{ id: string; text: string }> }
      | undefined;
    expect(submitPayload).toBeTruthy();
    expect(submitPayload?.todos.map((todo) => todo.id)).toEqual([
      "goal-1",
      "goal-2",
    ]);
    expect(submitPayload?.todos.map((todo) => todo.text)).toEqual([
      "Updated A",
      "Original B",
    ]);
  });
});
