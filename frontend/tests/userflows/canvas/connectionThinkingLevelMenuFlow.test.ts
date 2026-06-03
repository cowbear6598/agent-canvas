import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import SummarySection from "@/components/canvas/connectionMenu/SummarySection.vue";
import BranchSettingsPanel from "@/components/canvas/connectionMenu/BranchSettingsPanel.vue";

describe("connection model 設定入口收斂", () => {
  it("summary 區塊不再提供 provider、model、thinking level 操作入口", () => {
    const wrapper = mount(SummarySection, {
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
    });

    expect(wrapper.text()).not.toContain("summaryProvider");
    expect(wrapper.text()).not.toContain("summaryModel");
    expect(wrapper.text()).not.toContain("summaryThinkingLevel");
    expect(wrapper.findAll("button")).toHaveLength(0);
  });

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
    expect(buttonLabels).toEqual([
      "canvas.connectionContextMenu.branchLabel",
      "canvas.connectionContextMenu.branchDescription",
    ]);
  });

  it("branch 區塊保留 label 與 description 編輯入口", async () => {
    const wrapper = mount(BranchSettingsPanel, {
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
    });

    expect(wrapper.text()).toContain("branchLabel");
    expect(wrapper.text()).toContain("branchDescription");

    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("branchLabel"))
      ?.trigger("click");

    expect(wrapper.emitted("edit-branch-settings")).toHaveLength(1);
  });
});
