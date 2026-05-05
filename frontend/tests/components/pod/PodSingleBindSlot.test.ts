import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createTestingPinia } from "@pinia/testing";
import PodSingleBindSlot from "@/components/pod/PodSingleBindSlot.vue";

vi.mock("@/composables/pod/useSlotDropTarget", () => ({
  useSlotDropTarget: () => ({
    isDropTarget: { value: false },
    isInserting: { value: false },
  }),
}));

// 在模組外宣告共用 mock，方便各測試追蹤呼叫次數
const mockHandleSlotClick = vi.fn();

vi.mock("@/composables/pod/useSlotEject", () => ({
  useSlotEject: () => ({
    isEjecting: { value: false },
    handleSlotClick: mockHandleSlotClick,
  }),
}));

function createMockStore(overrides = {}) {
  return {
    draggedNoteId: null,
    getNoteById: vi.fn(),
    setNoteAnimating: vi.fn(),
    unbindFromPod: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const defaultProps = {
  podId: "pod-1",
  boundNote: undefined,
  store: createMockStore(),
  label: "Skill",
  slotClass: "skill-slot",
};

describe("PodSingleBindSlot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("未綁定 note 時", () => {
    it("應顯示 label 文字", () => {
      const wrapper = mount(PodSingleBindSlot, {
        props: defaultProps,
        global: {
          plugins: [
            createTestingPinia({ createSpy: vi.fn, stubActions: true }),
          ],
        },
      });

      expect(wrapper.text()).toContain("Skill");
      wrapper.unmount();
    });
  });

  describe("已綁定 note 時", () => {
    it("應顯示 note 名稱", () => {
      const boundNote = {
        id: "note-1",
        name: "My Skill",
        boundToPodId: "pod-1",
        x: 0,
        y: 0,
        originalPosition: null,
      };

      const wrapper = mount(PodSingleBindSlot, {
        props: { ...defaultProps, boundNote },
        global: {
          plugins: [
            createTestingPinia({ createSpy: vi.fn, stubActions: true }),
          ],
        },
      });

      expect(wrapper.text()).toContain("My Skill");
      wrapper.unmount();
    });
  });

  describe("disabled 狀態時", () => {
    it("disabled=true 且已綁定 boundNote，觸發 click 不應呼叫 ejectSlotClick（handleSlotClick）", async () => {
      const boundNote = {
        id: "note-1",
        name: "My Skill",
        boundToPodId: "pod-1",
        x: 0,
        y: 0,
        originalPosition: null,
      };

      const wrapper = mount(PodSingleBindSlot, {
        props: { ...defaultProps, boundNote, disabled: true },
        global: {
          plugins: [
            createTestingPinia({ createSpy: vi.fn, stubActions: true }),
          ],
        },
      });

      // 直接觸發 click（disabled 時 DOM 仍可觸發，但 JS guard 應阻擋業務邏輯）
      await wrapper.trigger("click");

      // disabled guard 應在呼叫 ejectSlotClick 之前 return，因此 handleSlotClick 不應被呼叫
      expect(mockHandleSlotClick).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it("disabled=true 且已綁定 boundNote，觸發 click 不應 emit note-removed", async () => {
      const boundNote = {
        id: "note-1",
        name: "My Skill",
        boundToPodId: "pod-1",
        x: 0,
        y: 0,
        originalPosition: null,
      };

      const wrapper = mount(PodSingleBindSlot, {
        props: { ...defaultProps, boundNote, disabled: true },
        global: {
          plugins: [
            createTestingPinia({ createSpy: vi.fn, stubActions: true }),
          ],
        },
      });

      await wrapper.trigger("click");

      // disabled slot 的點擊不應誤觸發 unbind（eject）
      expect(wrapper.emitted("note-removed")).toBeUndefined();
      wrapper.unmount();
    });
  });
});
