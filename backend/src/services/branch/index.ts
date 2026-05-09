/**
 * branch/index.ts
 *
 * BranchDecider 模組統一入口：
 * - branchDecider singleton（BaseBranchDecider 實例）
 * - 介面與型別 re-export
 * - parser 函式 re-export
 */

export { BaseBranchDecider } from "./baseBranchDecider.js";
export type {
  BranchDecider,
  BranchDecisionInput,
  BranchDecisionOutput,
} from "./branchDecider.js";
export {
  stripMarkdownCodeBlock,
  parseBranchDecision,
  BranchDecisionParseError,
} from "./branchDecisionParser.js";
export type { BranchDecisionParseErrorType } from "./branchDecisionParser.js";

import { BaseBranchDecider } from "./baseBranchDecider.js";

/** Singleton 實例，Phase 3C 的 BranchDecisionService 直接注入使用 */
export const branchDecider = new BaseBranchDecider();
