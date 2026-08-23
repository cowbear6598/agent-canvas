import { shallowMount } from "@vue/test-utils";
import { createTestingPinia } from "@pinia/testing";
import { describe, expect, it, vi } from "vitest";
import GoalEditorModal from "@/components/pod/GoalEditorModal.vue";
import i18n from "@/i18n";

describe("GoalEditorModal", () => {
  it("使用共用 ScrollArea 承載可溢出的 Goal 清單，並為兩張卡片保留完整高度", () => {
    const wrapper = shallowMount(GoalEditorModal, {
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
            todos: [
              { id: "todo-1", text: "Ship" },
              { id: "todo-2", text: "Verify" },
            ],
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
            template: '<div data-testid="goal-scroll-area" :style="style"><slot /></div>',
          },
        },
      },
    });

    expect(wrapper.find('[data-testid="goal-scroll-area"] .goal-editor-list').exists()).toBe(true);
    const setupState = (wrapper.vm.$ as unknown as {
      setupState: { goalListHeight: string };
    }).setupState;

    expect(setupState.goalListHeight).toBe("min(60vh, 7.5rem)");
  });
});
