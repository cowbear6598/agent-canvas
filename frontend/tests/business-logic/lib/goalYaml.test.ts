import { describe, expect, it } from "vitest";
import {
  createGoalYamlFilename,
  GoalYamlError,
  parseGoalYaml,
  serializeGoalYaml,
} from "@/lib/goalYaml";

describe("goalYaml", () => {
  it("可保留 Todo 順序與多行內容，且不匯出內部 ID", () => {
    const yaml = serializeGoalYaml([
      { text: "第一步\n補充內容" },
      { text: "第二步" },
    ]);

    expect(yaml).toContain("version: 1");
    expect(yaml).not.toContain("id:");
    expect(parseGoalYaml(yaml)).toEqual(["第一步\n補充內容", "第二步"]);
  });

  it("可匯入空 Todo 清單以清空 Goal", () => {
    expect(parseGoalYaml("version: 1\ntodos: []\n")).toEqual([]);
  });

  it("拒絕無法解析的 YAML", () => {
    expect(() => parseGoalYaml("version: [\n")).toThrowError(GoalYamlError);
  });

  it("拒絕不支援的格式版本", () => {
    expect(() => parseGoalYaml("version: 2\ntodos: []\n")).toThrowError(
      expect.objectContaining({ code: "unsupportedVersion" }),
    );
  });

  it("拒絕缺少文字或只有空白的 Todo", () => {
    expect(() =>
      parseGoalYaml("version: 1\ntodos:\n  - text: '   '\n"),
    ).toThrowError(expect.objectContaining({ code: "invalidTodo" }));
  });

  it("匯出檔名會移除不安全字元", () => {
    expect(createGoalYamlFilename(' Planner / QA: "A" ')).toBe(
      "Planner-QA-A-goal.yaml",
    );
    expect(createGoalYamlFilename("  ")).toBe("goal-goal.yaml");
  });
});
