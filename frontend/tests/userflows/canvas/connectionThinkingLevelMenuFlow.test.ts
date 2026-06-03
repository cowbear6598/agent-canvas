import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import BranchSettingsPanel from "@/components/canvas/connectionMenu/BranchSettingsPanel.vue";

describe("connection model 設定入口收斂", () => {
  it("branch 區塊不再提供 provider、model、thinking level 操作入口", () => {
    const wrapper = mount(BranchSettingsPanel, {
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
    });

    expect(wrapper.text()).not.toContain("branchProvider");
    expect(wrapper.text()).not.toContain("branchModel");
    expect(wrapper.text()).not.toContain("branchThinkingLevel");
    const buttonLabels = wrapper
      .findAll("button")
      .map((button) => button.text());
    expect(buttonLabels).toEqual(["canvas.connectionContextMenu.branchSettings"]);
  });

  it("branch 區塊保留單一設定編輯入口", async () => {
    const wrapper = mount(BranchSettingsPanel, {
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
    });

    expect(wrapper.text()).toContain("branchSettings");

    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("branchSettings"))
      ?.trigger("click");

    expect(wrapper.emitted("edit-branch-settings")).toHaveLength(1);
  });
});
