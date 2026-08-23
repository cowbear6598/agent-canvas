import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PodPackImportDialog from "@/components/canvas/PodPackImportDialog.vue";
import i18n from "@/i18n";
import type { PodPackPreview } from "@/types";

function createPreview(): PodPackPreview {
  return {
    format: "agent-canvas-pod-pack",
    version: 1,
    podCount: 1,
    connectionCount: 0,
    repositories: [],
    plugins: [
      {
        originalKey: "plugin-1",
        name: "AI video production",
        resolvedName: "AI video production",
        fingerprint: "a".repeat(64),
        action: "reuse",
        skills: [
          { skillName: "skills/develop-script", description: "" },
          { skillName: "skills/render-takes", description: "" },
        ],
        executableFiles: [
          "skills/develop-script/scripts/initialize_chapter.py",
          "skills/render-takes/scripts/compile_h3_jobs.py",
        ],
      },
    ],
    managedMcps: [],
    omitted: [],
  };
}

describe("PodPackImportDialog", () => {
  it("逐項顯示可用 Skill，且可執行檔只顯示數量警告", () => {
    const wrapper = mount(PodPackImportDialog, {
      props: { preview: createPreview() },
      global: { plugins: [i18n] },
    });

    const skillItems = wrapper.findAll("li li");
    expect(skillItems.map((item) => item.text())).toEqual([
      "skills/develop-script",
      "skills/render-takes",
    ]);
    expect(wrapper.text()).toContain(
      i18n.global.t("podPack.import.executableFiles", { count: 2 }),
    );
    expect(wrapper.text()).not.toContain("initialize_chapter.py");
    expect(wrapper.text()).not.toContain("compile_h3_jobs.py");
    expect(wrapper.text()).not.toContain(i18n.global.t("podPack.action.reuse"));
  });
});
