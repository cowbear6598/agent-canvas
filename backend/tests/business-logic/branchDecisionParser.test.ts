import { describe, expect, it } from "vitest";

import {
  BRANCH_NO_SELECTION_LABEL,
  BranchDecisionParseError,
  parseBranchDecision,
  stripMarkdownCodeBlock,
} from "../../src/services/branch/branchDecisionParser.js";

describe("stripMarkdownCodeBlock", () => {
  it("剝除 ```json ... ``` 包裝", () => {
    const raw = '```json\n{"selectedLabel":"Checklist"}\n```';
    expect(stripMarkdownCodeBlock(raw)).toBe('{"selectedLabel":"Checklist"}');
  });

  it("剝除 ``` ... ``` 包裝（無 json 標記）", () => {
    const raw = '```\n{"selectedLabel":"Checklist"}\n```';
    expect(stripMarkdownCodeBlock(raw)).toBe('{"selectedLabel":"Checklist"}');
  });

  it("無包裝時保持原樣（trim 開頭結尾空白）", () => {
    const raw = '  {"selectedLabel":"Checklist"}  ';
    expect(stripMarkdownCodeBlock(raw)).toBe('{"selectedLabel":"Checklist"}');
  });
});

describe("parseBranchDecision", () => {
  const validLabels = ["Checklist", "Code Review", "Hotfix"];

  it("合法 JSON + valid label → ok", () => {
    const result = parseBranchDecision(
      '{"selectedLabel":"Checklist"}',
      validLabels,
    );
    expect(result).toEqual({
      ok: true,
      selectedLabel: "Checklist",
      noSelection: false,
    });
  });

  it("帶 markdown code block 的合法 JSON → 剝除後 ok", () => {
    const result = parseBranchDecision(
      '```json\n{"selectedLabel":"Code Review"}\n```',
      validLabels,
    );
    expect(result).toEqual({
      ok: true,
      selectedLabel: "Code Review",
      noSelection: false,
    });
  });

  it("回覆含說明文字與 JSON → 擷取 selectedLabel JSON 後 ok", () => {
    const result = parseBranchDecision(
      '我會選擇清單分支。\n{"selectedLabel":"Checklist"}\n原因：最符合。',
      validLabels,
    );
    expect(result).toEqual({
      ok: true,
      selectedLabel: "Checklist",
      noSelection: false,
    });
  });

  it("回覆含多個 JSON 時優先擷取含 selectedLabel 的 JSON", () => {
    const result = parseBranchDecision(
      '{"note":"ignore"}\n最後答案：{"selectedLabel":"Hotfix"}',
      validLabels,
    );
    expect(result).toEqual({
      ok: true,
      selectedLabel: "Hotfix",
      noSelection: false,
    });
  });

  it("只回傳純文字 label → 直接視為合法 selectedLabel", () => {
    const result = parseBranchDecision("Hotfix", validLabels);
    expect(result).toEqual({
      ok: true,
      selectedLabel: "Hotfix",
      noSelection: false,
    });
  });

  it("說明文字中只出現一個合法 label 但不是純 label → 仍視為 PARSE_FAIL", () => {
    const result = parseBranchDecision(
      "我會選擇 Hotfix，因為最符合情境。",
      validLabels,
    );
    expect(result).toEqual({
      ok: false,
      reason: BranchDecisionParseError.PARSE_FAIL,
    });
  });

  it("selectedLabel 為 NO_BRANCH_SELECTED → noSelection", () => {
    const result = parseBranchDecision(
      `{"selectedLabel":"${BRANCH_NO_SELECTION_LABEL}"}`,
      validLabels,
    );
    expect(result).toEqual({
      ok: true,
      selectedLabel: null,
      noSelection: true,
    });
  });

  it("非 JSON 純文字 → PARSE_FAIL", () => {
    const result = parseBranchDecision("這不是 JSON", validLabels);
    expect(result).toEqual({
      ok: false,
      reason: BranchDecisionParseError.PARSE_FAIL,
    });
  });

  it("合法 JSON 但 schema 不符（缺欄位）→ SCHEMA_FAIL", () => {
    const result = parseBranchDecision(
      '{"otherField":"Checklist"}',
      validLabels,
    );
    expect(result).toEqual({
      ok: false,
      reason: BranchDecisionParseError.SCHEMA_FAIL,
    });
  });

  it("合法 JSON 但 selectedLabel 型別錯誤（number）→ SCHEMA_FAIL", () => {
    const result = parseBranchDecision('{"selectedLabel":123}', validLabels);
    expect(result).toEqual({
      ok: false,
      reason: BranchDecisionParseError.SCHEMA_FAIL,
    });
  });

  it("selectedLabel 不在 validLabels → LABEL_HALLUCINATION", () => {
    const result = parseBranchDecision(
      '{"selectedLabel":"NonExistent"}',
      validLabels,
    );
    expect(result).toEqual({
      ok: false,
      reason: BranchDecisionParseError.LABEL_HALLUCINATION,
    });
  });

  it("selectedLabel 為 None → LABEL_HALLUCINATION", () => {
    const result = parseBranchDecision('{"selectedLabel":"None"}', validLabels);
    expect(result).toEqual({
      ok: false,
      reason: BranchDecisionParseError.LABEL_HALLUCINATION,
    });
  });
});
