import { buildSkillFiles } from "../../src/api/agentAccessManagementApi.js";

describe("Agent Canvas Skill", () => {
  it("依 Canvas、Pod、Workflow 分類契約，並且不內嵌 Token", () => {
    const files = buildSkillFiles("https://canvas.example.com");
    const decoder = new TextDecoder();
    const decode = (path: string): string =>
      decoder.decode(files[`agent-canvas/${path}`]);
    const skill = decode("SKILL.md");
    const canvas = decode("references/canvas.md");
    const pod = decode("references/pod.md");
    const workflow = decode("references/workflow.md");

    expect(Object.keys(files).sort()).toEqual([
      "agent-canvas/SKILL.md",
      "agent-canvas/references/canvas.md",
      "agent-canvas/references/pod.md",
      "agent-canvas/references/workflow.md",
    ]);
    expect(skill).toContain("name: agent-canvas");
    expect(skill).toContain("Base URL: `https://canvas.example.com`");
    expect(skill).toContain("AGENT_CANVAS_BASE_URL");
    expect(skill).toContain("AGENT_CANVAS_TOKEN");
    expect(skill).toContain("do not ask the user to paste it");
    expect(skill).toContain("references/canvas.md");
    expect(skill).toContain("references/pod.md");
    expect(skill).toContain("references/workflow.md");
    expect(skill).toContain("use columns at least 640 px apart");
    expect(skill).toContain("use rows at least 280 px apart");
    expect(skill).toContain("left Skill/MCP notches");
    expect(skill).toContain("right Goal/Repository notches");
    expect(skill).toContain("Lay out linear Workflows from left to right");
    expect(canvas).toContain('"key": "research"');
    expect(canvas).toContain('{ "key": "summary", "name": "Summarize", "x": 720');
    expect(canvas).toContain("sourcePodId");
    expect(pod).toContain("Pod request and response");
    expect(workflow).toContain("Start Run request and response");
    expect(`${skill}\n${canvas}\n${pod}\n${workflow}`).not.toMatch(
      /Bearer acv1_/,
    );
  });
});
