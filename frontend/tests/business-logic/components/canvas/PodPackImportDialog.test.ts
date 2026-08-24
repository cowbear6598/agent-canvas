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
    repositories: [
      {
        originalKey: "repository-1",
        name: "GameFactory",
        resolvedName: "GameFactory-imported",
        fingerprint: "b".repeat(64),
        action: "rename",
        source: "directory",
      },
    ],
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
    omitted: ["chats", "runtimeWorkspaces", "secrets"],
  };
}

describe("PodPackImportDialog", () => {
  it("隱藏匯入細節，只保留必要的相依項目與警告", () => {
    const wrapper = mount(PodPackImportDialog, {
      props: { preview: createPreview() },
      global: { plugins: [i18n] },
    });
    const text = wrapper.text();

    expect(text).toContain("GameFactory");
    expect(text).not.toContain("GameFactory-imported");
    expect(text).not.toContain("skills/develop-script");
    expect(text).not.toContain("skills/render-takes");
    expect(text).not.toContain("podPack.import.omitted");
    expect(text).not.toContain("Pod 對話紀錄");
    expect(text).toContain(
      i18n.global.t("podPack.import.executableFiles", { count: 2 }),
    );
    expect(text).not.toContain("initialize_chapter.py");
    expect(text).not.toContain("compile_h3_jobs.py");
    expect(text).not.toContain(i18n.global.t("podPack.action.reuse"));
  });
});
