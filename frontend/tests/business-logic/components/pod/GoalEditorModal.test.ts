import { shallowMount } from "@vue/test-utils";
import { createTestingPinia } from "@pinia/testing";
import { describe, expect, it, vi } from "vitest";
import GoalEditorModal from "@/components/pod/GoalEditorModal.vue";
import i18n from "@/i18n";

function mountGoalEditor(todoCount: number) {
  return shallowMount(GoalEditorModal, {
    props: {
      open: true,
      pod: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Planner",
        x: 0,
        y: 0,
        rotation: 0,
        provider: "claude",
        providerConfig: { model: "opus" },
        repositoryId: null,
        workspacePath: "/tmp/planner",
        goal: {
          todos: Array.from({ length: todoCount }, (_, index) => ({
            id: `todo-${index + 1}`,
            text: `Todo ${index + 1}`,
          })),
        },
      } as never,
    },
    global: {
      plugins: [createTestingPinia({ createSpy: vi.fn }), i18n],
      stubs: {
        Dialog: { template: "<div><slot /></div>" },
        DialogContent: { template: "<div><slot /></div>" },
        DialogHeader: { template: "<div><slot /></div>" },
        DialogTitle: { template: "<div><slot /></div>" },
        DialogFooter: { template: "<div><slot /></div>" },
        ScrollArea: {
          props: ["style"],
          template:
            '<div data-testid="goal-scroll-area" :style="style"><slot /></div>',
        },
      },
    },
  });
}

function getGoalListHeight(
  wrapper: ReturnType<typeof mountGoalEditor>,
): string {
  return (wrapper.vm.$ as unknown as {
    setupState: { goalListHeight: string };
  }).setupState.goalListHeight;
}

describe("GoalEditorModal", () => {
  it("九張以內的 Goal 卡片都保留完整高度", () => {
    const wrapper = mountGoalEditor(4);

    expect(
      wrapper.find('[data-testid="goal-scroll-area"] .goal-editor-list').exists(),
    ).toBe(true);
    expect(getGoalListHeight(wrapper)).toBe("min(60vh, 15.75rem)");
  });

  it("超過九張 Goal 卡片時將清單高度限制為九張", () => {
    expect(getGoalListHeight(mountGoalEditor(10))).toBe(
      "min(60vh, 35.75rem)",
    );
  });
});
