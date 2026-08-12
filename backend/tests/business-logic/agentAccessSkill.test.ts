import { buildSkillFiles } from "../../src/api/agentAccessManagementApi.js";

describe("Agent Canvas Skill", () => {
  it("依 Canvas、Pod、Workflow 分類契約，並且不內嵌 Token", () => {
    const files = buildSkillFiles("https://canvas.example.com");
    const skill = new TextDecoder().decode(
      files["operate-agent-canvas/SKILL.md"],
    );
    const canvas = new TextDecoder().decode(
      files["operate-agent-canvas/references/canvas.md"],
    );
    const pod = new TextDecoder().decode(
      files["operate-agent-canvas/references/pod.md"],
    );
    const workflow = new TextDecoder().decode(
      files["operate-agent-canvas/references/workflow.md"],
    );

    expect(Object.keys(files).sort()).toEqual([
      "operate-agent-canvas/SKILL.md",
      "operate-agent-canvas/references/canvas.md",
      "operate-agent-canvas/references/pod.md",
      "operate-agent-canvas/references/workflow.md",
    ]);
    expect(skill).toContain("Base URL: `https://canvas.example.com`");
    expect(skill).toContain("AGENT_CANVAS_BASE_URL");
    expect(skill).toContain("AGENT_CANVAS_TOKEN");
    expect(skill).toContain("do not ask the user to paste it");
    expect(skill).toContain("references/canvas.md");
    expect(skill).toContain("references/pod.md");
    expect(skill).toContain("references/workflow.md");
    expect(canvas).toContain('"key": "research"');
    expect(canvas).toContain("sourcePodId");
    expect(pod).toContain("Pod request and response");
    expect(workflow).toContain("Start Run request and response");
    expect(`${skill}\n${canvas}\n${pod}\n${workflow}`).not.toMatch(
      /Bearer acv1_/,
    );
  });
});
