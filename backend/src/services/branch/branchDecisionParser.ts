/**
 * branchDecisionParser
 *
 * 純函式模組：負責解析 AI 回傳的 branch 決策原始字串。
 * - stripMarkdownCodeBlock：剝除 ```json / ``` 包裝
 * - parseBranchDecision：完整解析流程（strip → JSON.parse → zod → label 驗證）
 */

import { z } from "zod";

// ─── 錯誤分類 ─────────────────────────────────────────────────────────────────

/** AI 回應解析失敗的錯誤類型 */
export const BranchDecisionParseError = {
  /** JSON 解析失敗 */
  PARSE_FAIL: "PARSE_FAIL",
  /** zod schema 驗證失敗 */
  SCHEMA_FAIL: "SCHEMA_FAIL",
  /** selectedLabel 不在合法清單內 */
  LABEL_HALLUCINATION: "LABEL_HALLUCINATION",
} as const;

export type BranchDecisionParseErrorType =
  (typeof BranchDecisionParseError)[keyof typeof BranchDecisionParseError];

export const BRANCH_NO_SELECTION_LABEL = "NO_BRANCH_SELECTED";

// ─── zod schema ───────────────────────────────────────────────────────────────

const branchDecisionSchema = z.object({
  selectedLabel: z.string(),
});

// ─── 公開函式 ─────────────────────────────────────────────────────────────────

/**
 * 剝除 AI 回應中可能包裹的 markdown code block（```json / ```）。
 * 同時 trim 開頭結尾空白。
 */
export function stripMarkdownCodeBlock(raw: string): string {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  return stripped;
}

function extractFirstJsonObjectContainingSelectedLabel(raw: string): string {
  const selectedLabelIndex = raw.indexOf('"selectedLabel"');
  if (selectedLabelIndex === -1) return raw;

  const start = raw.lastIndexOf("{", selectedLabelIndex);
  if (start === -1) return raw;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, index + 1).trim();
      }
    }
  }

  return raw;
}

function tryParseLooseSelectedLabel(
  cleaned: string,
  validLabels: string[],
):
  | { ok: true; selectedLabel: string; noSelection?: false }
  | { ok: true; selectedLabel: null; noSelection: true }
  | null {
  const normalized = cleaned.trim().replace(/^["']|["']$/g, "");

  if (normalized === BRANCH_NO_SELECTION_LABEL) {
    return { ok: true, selectedLabel: null, noSelection: true };
  }

  const exactLabel = validLabels.find((label) => label === normalized);
  if (exactLabel) {
    return { ok: true, selectedLabel: exactLabel, noSelection: false };
  }

  return null;
}

/**
 * 解析 AI 回傳的 branch 決策字串。
 *
 * 流程：
 * 1. stripMarkdownCodeBlock
 * 2. JSON.parse（失敗 → PARSE_FAIL）
 * 3. zod schema 驗證（失敗 → SCHEMA_FAIL）
 * 4. 檢查 selectedLabel 是否在 validLabels 內（否 → LABEL_HALLUCINATION）
 *
 * @param raw - AI 原始回傳字串
 * @param validLabels - 合法的 branch label 列表
 */
export function parseBranchDecision(
  raw: string,
  validLabels: string[],
):
  | { ok: true; selectedLabel: string; noSelection?: false }
  | { ok: true; selectedLabel: null; noSelection: true }
  | { ok: false; reason: BranchDecisionParseErrorType } {
  const cleaned = extractFirstJsonObjectContainingSelectedLabel(
    stripMarkdownCodeBlock(raw),
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const looseResult = tryParseLooseSelectedLabel(cleaned, validLabels);
    if (looseResult) {
      return looseResult;
    }
    return { ok: false, reason: BranchDecisionParseError.PARSE_FAIL };
  }

  const result = branchDecisionSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, reason: BranchDecisionParseError.SCHEMA_FAIL };
  }

  const { selectedLabel } = result.data;

  if (selectedLabel === BRANCH_NO_SELECTION_LABEL) {
    return { ok: true, selectedLabel: null, noSelection: true };
  }

  if (!validLabels.includes(selectedLabel)) {
    return { ok: false, reason: BranchDecisionParseError.LABEL_HALLUCINATION };
  }

  return { ok: true, selectedLabel, noSelection: false };
}
