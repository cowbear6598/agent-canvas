/**
 * branchDecider 單元測試
 *
 * 測試對象：BaseBranchDecider（以 branchDecider singleton 為入口）
 *
 * Mock 邊界：
 *   - executeDisposableChat（AI 服務邊界）
 *
 * 不 mock：
 *   - parseBranchDecision（純函式，跑真的）
 *   - branchPromptBuilder（純函式，跑真的）
 */

vi.mock("../../src/services/disposableChatService.js", () => ({
  executeDisposableChat: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { branchDecider } from "../../src/services/branch/index.js";
import { BRANCH_NO_SELECTION_LABEL } from "../../src/services/branch/index.js";
import { executeDisposableChat } from "../../src/services/disposableChatService.js";
import { BranchAbortError } from "../../src/services/branch/abortError.js";
import type { BranchDecisionInput } from "../../src/services/branch/branchDecider.js";
import type { PersistedMessage } from "../../src/types/persistence.js";
import type { Pod } from "../../src/types/pod.js";
import type { RunContext } from "../../src/types/run.js";

function asMock(fn: unknown): Mock<any> {
  return fn as Mock<any>;
}

// ─── 工廠函式 ────────────────────────────────────────────────────────────────

function makeMessage(
  overrides: Partial<PersistedMessage> = {},
): PersistedMessage {
  return {
    id: "msg-1",
    role: "assistant",
    content: "任務完成",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<BranchDecisionInput> = {},
): BranchDecisionInput {
  const sourcePod: Pod = {
    id: "source-pod",
    name: "Source Pod",
    workspacePath: "/tmp/workspace",
    x: 0,
    y: 0,
    rotation: 0,
    sessionId: null,
    mcpServerNames: [],
    pluginIds: [],
    provider: "claude",
    providerConfig: { model: "claude-sonnet-4-5" },
    repositoryId: null,
  };
  const runContext: RunContext = {
    runId: "run-1",
    canvasId: "canvas-1",
    sourcePodId: "source-pod",
  };

  return {
    canvasId: "canvas-1",
    sourcePodId: "source-pod",
    sourcePodName: "Source Pod",
    sourcePod,
    branches: [
      {
        label: "Checklist",
        description: "清單分支",
        targetPodName: "Checklist Pod",
      },
      { label: "Review", targetPodName: "Review Pod" },
    ],
    recentMessages: [makeMessage()],
    provider: "claude",
    model: "claude-sonnet-4-5",
    workspacePath: "/tmp/workspace",
    runContext,
    ...overrides,
  };
}

function makeDisposableChatResult(content: string) {
  return {
    content,
    success: true,
    resolvedModel: "claude-sonnet-4-5",
  };
}

function makeDisposableChatFailure(error: string) {
  return {
    content: "",
    success: false,
    error,
    resolvedModel: "claude-sonnet-4-5",
  };
}

// ─── 測試 ─────────────────────────────────────────────────────────────────────

describe("BaseBranchDecider.decide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── 案例 1：recentMessages 與 persistedSummary 皆為空 ─────────────────────
  it("recentMessages 與 persistedSummary 皆為空 → fail closed，不自動選第一個 branch label", async () => {
    const input = makeInput({ recentMessages: [], persistedSummary: null });

    const result = await branchDecider.decide(input);

    expect(result).toEqual({
      kind: "failed",
      failure: {
        kind: "no_selection",
        message: "缺少可判斷 branch 的上下文",
        attempts: [
          {
            attempt: 1,
            kind: "no_selection",
            message: "缺少可判斷 branch 的上下文",
          },
        ],
      },
    });
    expect(asMock(executeDisposableChat)).not.toHaveBeenCalled();
  });

  // ─── 案例 2：正常 JSON 回應且 label 在 branches 中 ────────────────────────
  it("收到正常 JSON 回應且 label 在 branches 中 → 回傳對應 selectedLabel", async () => {
    asMock(executeDisposableChat).mockResolvedValueOnce(
      makeDisposableChatResult('{"selectedLabel":"Checklist"}'),
    );

    const result = await branchDecider.decide(makeInput());

    expect(result).toEqual({ kind: "success", selectedLabel: "Checklist" });
    expect(asMock(executeDisposableChat)).toHaveBeenCalledTimes(1);
  });

  it("呼叫 executeDisposableChat 時會傳入 branch thinkingLevel", async () => {
    asMock(executeDisposableChat).mockResolvedValueOnce(
      makeDisposableChatResult('{"selectedLabel":"Checklist"}'),
    );

    await branchDecider.decide(makeInput({ thinkingLevel: "high" }));

    expect(asMock(executeDisposableChat)).toHaveBeenCalledWith(
      expect.objectContaining({ thinkingLevel: "high" }),
    );
  });

  // ─── 案例 3：markdown code block 包裹的 JSON ────────────────────────────────
  it("收到 markdown code block 包裹的 JSON → 剝除後成功 parse", async () => {
    asMock(executeDisposableChat).mockResolvedValueOnce(
      makeDisposableChatResult('```json\n{"selectedLabel":"Review"}\n```'),
    );

    const result = await branchDecider.decide(makeInput());

    expect(result).toEqual({ kind: "success", selectedLabel: "Review" });
    expect(asMock(executeDisposableChat)).toHaveBeenCalledTimes(1);
  });

  // ─── 案例 4：第一次 hallucination，第二次正確 ────────────────────────────────
  it("第一次 label 不在 validLabels（hallucination），第二次正確 → 回傳第二次的 selectedLabel", async () => {
    // 第一次回傳不存在的 label
    asMock(executeDisposableChat)
      .mockResolvedValueOnce(
        makeDisposableChatResult('{"selectedLabel":"NotExistBranch"}'),
      )
      // 第二次回傳合法 label
      .mockResolvedValueOnce(
        makeDisposableChatResult('{"selectedLabel":"Checklist"}'),
      );

    const result = await branchDecider.decide(makeInput());

    expect(result).toEqual({ kind: "success", selectedLabel: "Checklist" });
    expect(asMock(executeDisposableChat)).toHaveBeenCalledTimes(2);
  });

  it("模型回傳 NO_BRANCH_SELECTED → 回傳 no_selection 失敗且不 retry", async () => {
    asMock(executeDisposableChat).mockResolvedValueOnce(
      makeDisposableChatResult(
        `{"selectedLabel":"${BRANCH_NO_SELECTION_LABEL}"}`,
      ),
    );

    const result = await branchDecider.decide(makeInput());

    expect(result).toEqual({
      kind: "failed",
      failure: {
        kind: "no_selection",
        message: "模型判斷沒有安全可選的 branch",
        attempts: [
          {
            attempt: 1,
            kind: "no_selection",
            message: "模型判斷沒有安全可選的 branch",
          },
        ],
      },
    });
    expect(asMock(executeDisposableChat)).toHaveBeenCalledTimes(1);
  });

  it("第一次模型回傳 None → parse error 後 retry，第二次正確 → 回傳第二次的 selectedLabel", async () => {
    asMock(executeDisposableChat)
      .mockResolvedValueOnce(
        makeDisposableChatResult('{"selectedLabel":"None"}'),
      )
      .mockResolvedValueOnce(
        makeDisposableChatResult('{"selectedLabel":"Checklist"}'),
      );

    const result = await branchDecider.decide(makeInput());

    expect(result).toEqual({ kind: "success", selectedLabel: "Checklist" });
    expect(asMock(executeDisposableChat)).toHaveBeenCalledTimes(2);
  });

  it("兩次模型都回傳 None → 回傳結構化 parse error 失敗", async () => {
    asMock(executeDisposableChat)
      .mockResolvedValueOnce(
        makeDisposableChatResult('{"selectedLabel":"None"}'),
      )
      .mockResolvedValueOnce(
        makeDisposableChatResult('{"selectedLabel":"None"}'),
      );

    const result = await branchDecider.decide(makeInput());

    expect(result).toEqual({
      kind: "failed",
      failure: {
        kind: "parse_error",
        message: "LABEL_HALLUCINATION",
        attempts: [
          { attempt: 1, kind: "parse_error", message: "LABEL_HALLUCINATION" },
          { attempt: 2, kind: "parse_error", message: "LABEL_HALLUCINATION" },
        ],
      },
    });
    expect(asMock(executeDisposableChat)).toHaveBeenCalledTimes(2);
  });

  // ─── 案例 5：兩次都 hallucination → 結構化失敗 ──────────────────────────
  it("兩次都 hallucination → 回傳結構化失敗，不再偽裝成 None", async () => {
    asMock(executeDisposableChat)
      .mockResolvedValueOnce(
        makeDisposableChatResult('{"selectedLabel":"FakeLabel1"}'),
      )
      .mockResolvedValueOnce(
        makeDisposableChatResult('{"selectedLabel":"FakeLabel2"}'),
      );

    const result = await branchDecider.decide(makeInput());

    expect(result).toEqual({
      kind: "failed",
      failure: {
        kind: "parse_error",
        message: "LABEL_HALLUCINATION",
        attempts: [
          { attempt: 1, kind: "parse_error", message: "LABEL_HALLUCINATION" },
          { attempt: 2, kind: "parse_error", message: "LABEL_HALLUCINATION" },
        ],
      },
    });
    expect(asMock(executeDisposableChat)).toHaveBeenCalledTimes(2);
  });

  // ─── 案例 6：收到非 JSON 純文字 → retry 後仍失敗 ──────────────────
  it("收到非 JSON 純文字 → retry 一次後仍失敗 → 回傳結構化失敗", async () => {
    asMock(executeDisposableChat)
      .mockResolvedValueOnce(makeDisposableChatResult("這不是 JSON"))
      .mockResolvedValueOnce(makeDisposableChatResult("還是非 JSON 內容"));

    const result = await branchDecider.decide(makeInput());

    expect(result).toEqual(
      expect.objectContaining({
        kind: "failed",
        failure: expect.objectContaining({
          kind: "parse_error",
          attempts: expect.arrayContaining([
            expect.objectContaining({ attempt: 1, kind: "parse_error" }),
            expect.objectContaining({ attempt: 2, kind: "parse_error" }),
          ]),
        }),
      }),
    );
    expect(asMock(executeDisposableChat)).toHaveBeenCalledTimes(2);
  });

  it("收到說明文字包住 JSON 的回應 → 擷取 JSON 後回傳對應 selectedLabel", async () => {
    asMock(executeDisposableChat).mockResolvedValueOnce(
      makeDisposableChatResult(
        '我會選這條。\n{"selectedLabel":"Checklist"}\n這是最合理的選項。',
      ),
    );

    const result = await branchDecider.decide(makeInput());

    expect(result).toEqual({ kind: "success", selectedLabel: "Checklist" });
    expect(asMock(executeDisposableChat)).toHaveBeenCalledTimes(1);
  });

  it("第一次 executeDisposableChat 回傳 success=false → retry 成功後回傳第二次 selectedLabel", async () => {
    asMock(executeDisposableChat)
      .mockResolvedValueOnce(makeDisposableChatFailure("OpenCode 未回傳文字內容"))
      .mockResolvedValueOnce(
        makeDisposableChatResult('{"selectedLabel":"Review"}'),
      );

    const result = await branchDecider.decide(makeInput());

    expect(result).toEqual({ kind: "success", selectedLabel: "Review" });
    expect(asMock(executeDisposableChat)).toHaveBeenCalledTimes(2);
    expect(asMock(executeDisposableChat)).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sourcePod: expect.objectContaining({ id: "source-pod" }),
        runContext: expect.objectContaining({ runId: "run-1" }),
      }),
    );
    expect(asMock(executeDisposableChat)).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sourcePod: expect.objectContaining({ id: "source-pod" }),
        runContext: expect.objectContaining({ runId: "run-1" }),
      }),
    );
  });

  // ─── 案例 7：zod 驗證失敗 → retry 後仍失敗 ───────────────────────
  it("收到 zod 驗證失敗的物件 → retry 一次後仍失敗 → 回傳結構化失敗", async () => {
    // selectedLabel 應為 string，這裡給 number 讓 zod 失敗
    asMock(executeDisposableChat)
      .mockResolvedValueOnce(makeDisposableChatResult('{"selectedLabel":123}'))
      .mockResolvedValueOnce(makeDisposableChatResult('{"selectedLabel":456}'));

    const result = await branchDecider.decide(makeInput());

    expect(result).toEqual(
      expect.objectContaining({
        kind: "failed",
        failure: expect.objectContaining({
          kind: "parse_error",
          attempts: expect.arrayContaining([
            expect.objectContaining({ attempt: 1, kind: "parse_error" }),
            expect.objectContaining({ attempt: 2, kind: "parse_error" }),
          ]),
        }),
      }),
    );
    expect(asMock(executeDisposableChat)).toHaveBeenCalledTimes(2);
  });

  // ─── 案例 8：abortSignal 在第一次呼叫前已 aborted → throw BranchAbortError ──
  it("abortSignal.aborted 在第一次 executeDisposableChat 之前為 true → throw BranchAbortError，不呼叫 executeDisposableChat", async () => {
    const controller = new AbortController();
    controller.abort(); // 立即 abort

    const input = makeInput({ abortSignal: controller.signal });

    await expect(branchDecider.decide(input)).rejects.toThrow(BranchAbortError);
    expect(asMock(executeDisposableChat)).not.toHaveBeenCalled();
  });

  // ─── 案例 9：abortSignal 在第一次呼叫之後變 true → throw BranchAbortError，不 retry ──
  it("abortSignal.aborted 在第一次 executeDisposableChat 之後才為 true → throw BranchAbortError，不進行 retry", async () => {
    const controller = new AbortController();

    // 第一次呼叫後 abort（模擬第一次呼叫回應後訊號被中止）
    asMock(executeDisposableChat).mockImplementationOnce(async () => {
      // 第一次呼叫回傳解析失敗的內容，觸發 retry 前先 abort
      controller.abort();
      return makeDisposableChatResult('{"selectedLabel":"NotExistBranch"}');
    });

    const input = makeInput({ abortSignal: controller.signal });

    await expect(branchDecider.decide(input)).rejects.toThrow(BranchAbortError);
    // 第一次有呼叫，但因為 abort 不進行 retry（第二次不呼叫）
    expect(asMock(executeDisposableChat)).toHaveBeenCalledTimes(1);
  });
});
