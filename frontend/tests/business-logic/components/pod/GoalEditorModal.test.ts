import { flushPromises, shallowMount } from "@vue/test-utils";
import { createTestingPinia } from "@pinia/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GoalEditorModal from "@/components/pod/GoalEditorModal.vue";
import i18n from "@/i18n";

const { toastMock } = vi.hoisted(() => ({
  toastMock: vi.fn(),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

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

function getTodos(
  wrapper: ReturnType<typeof mountGoalEditor>,
): Array<{ id: string; text: string }> {
  return (
    wrapper.vm as unknown as {
      todos: Array<{ id: string; text: string }>;
    }
  ).todos;
}

function createYamlFile(name: string, content: string): File {
  return {
    name,
    size: new TextEncoder().encode(content).byteLength,
    text: vi.fn().mockResolvedValue(content),
  } as unknown as File;
}

async function selectYamlFile(
  wrapper: ReturnType<typeof mountGoalEditor>,
  file: File,
): Promise<void> {
  const input = wrapper.get<HTMLInputElement>(
    '[data-testid="goal-editor-yaml-input"]',
  );
  Object.defineProperty(input.element, "files", {
    configurable: true,
    value: [file],
  });
  await input.trigger("change");
  await flushPromises();
}

describe("GoalEditorModal", () => {
  beforeEach(() => {
    toastMock.mockClear();
  });

  it("YAML 匯入會完整取代現有 Todo 並產生新的 ID", async () => {
    const wrapper = mountGoalEditor(2);
    const file = createYamlFile(
      "replacement.yaml",
      [
        "version: 1",
        "todos:",
        "  - text: 新的第一步",
        "  - text: |-",
        "      新的第二步",
        "      多行內容",
        "",
      ].join("\n"),
    );

    await selectYamlFile(wrapper, file);

    const todos = getTodos(wrapper);
    expect(todos.map((todo) => todo.text)).toEqual([
      "新的第一步",
      "新的第二步\n多行內容",
    ]);
    expect(todos.map((todo) => todo.id)).not.toContain("todo-1");
    expect(toastMock).toHaveBeenCalledWith({ title: "Goal YAML 已匯入" });
  });

  it("無效 YAML 不會取代現有 Todo", async () => {
    const wrapper = mountGoalEditor(2);
    const file = createYamlFile("broken.yaml", "version: 2\ntodos: []\n");

    await selectYamlFile(wrapper, file);

    expect(getTodos(wrapper).map((todo) => todo.text)).toEqual([
      "Todo 1",
      "Todo 2",
    ]);
    expect(toastMock).toHaveBeenCalledWith({
      title: "Goal YAML 匯入失敗",
      description: "不支援此 Goal YAML 版本",
      variant: "destructive",
    });
  });

  it("Import 與 Export 操作群組位於按鈕列最右側", () => {
    const wrapper = mountGoalEditor(1);
    const actions = wrapper.get(".goal-editor-file-actions");

    expect(actions.classes()).toContain("goal-editor-file-actions");
    expect(actions.get('[data-testid="goal-editor-import"]').text()).toContain(
      "匯入",
    );
    expect(actions.get('[data-testid="goal-editor-export"]').text()).toContain(
      "匯出",
    );
  });

  it("Export 會以 Pod 名稱下載版本化 YAML", async () => {
    const wrapper = mountGoalEditor(2);
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const createObjectUrlMock = vi.fn().mockReturnValue("blob:goal-yaml");
    const revokeObjectUrlMock = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrlMock,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrlMock,
    });
    let downloadedFilename = "";
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloadedFilename = this.download;
      });

    try {
      await wrapper.get('[data-testid="goal-editor-export"]').trigger("click");

      expect(createObjectUrlMock).toHaveBeenCalledWith(expect.any(Blob));
      expect(downloadedFilename).toBe("Planner-goal.yaml");
      expect(revokeObjectUrlMock).toHaveBeenCalledWith("blob:goal-yaml");
      expect(toastMock).toHaveBeenCalledWith({ title: "Goal YAML 已匯出" });
    } finally {
      clickSpy.mockRestore();
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: originalCreateObjectUrl,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: originalRevokeObjectUrl,
      });
    }
  });

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
