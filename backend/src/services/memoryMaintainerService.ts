import { z } from "zod";

import {
  executeStructuredDisposableTask,
  type StructuredDisposableTaskOutput,
} from "./disposableChatService.js";
import { configStore } from "./configStore.js";
import { memoryStateService, type MemoryScopeType } from "./memoryStateService.js";
import { podStore } from "./podStore.js";
import { runWorkflowSnapshotStore } from "./workflow/runWorkflowSnapshotStore.js";
import { repositoryService } from "./repositoryService.js";
import {
  runRepoActivitySnapshotService,
} from "./runRepoActivitySnapshotService.js";
import { runStore } from "./runStore.js";
import { resolvePodCwd } from "./shared/podPathResolver.js";
import { logger } from "../utils/logger.js";
import type { PersistedMessage, PersistedToolUseInfo } from "../types/persistence.js";
import type { Pod } from "../types/pod.js";
import type { RunContext } from "../types/run.js";

const MAX_MEMORY_RETRY_COUNT = 3;
const MAX_SUMMARY_FORMAT_CORRECTION_COUNT = 3;
const MAX_EVIDENCE_MESSAGES = 8;
const MAX_MESSAGE_CONTENT_LENGTH = 600;
const MAX_TOOL_OUTPUT_LENGTH = 400;

const memoryCandidateSchema = z.object({
  observations: z.array(
    z.object({
      title: z.string().trim().min(1),
      summary: z.string().trim().min(1),
      accepted: z.boolean(),
      reason: z.string().trim().min(1),
    }),
  ),
});

const memoryMergedSummarySchema = z.object({
  summary: z.string().trim().min(1).nullable(),
  reason: z.string().trim().min(1),
});

type MemoryCandidateResult = z.infer<typeof memoryCandidateSchema>;

interface MemoryEvidenceToolTrace {
  toolName: string;
  status: PersistedToolUseInfo["status"];
  input: Record<string, unknown>;
  output: string | null;
}

interface MemoryEvidenceMessage {
  podName: string;
  role: PersistedMessage["role"];
  content: string;
  toolTraces: MemoryEvidenceToolTrace[];
}

interface MemoryEvidencePack {
  scopeType: MemoryScopeType;
  scopeId: string;
  podId: string;
  podName: string;
  repositoryId: string | null;
  repositoryName: string | null;
  repositoryCurrentBranch: string | null;
  existingSummary: string | null;
  lastResponseSummary: string | null;
  recentMessages: MemoryEvidenceMessage[];
  recentToolTraces: MemoryEvidenceToolTrace[];
}

interface RunScopeInput {
  runContext: RunContext;
  pod: Pod;
}

interface MemoryScopeTask {
  scopeType: MemoryScopeType;
  scopeId: string;
  pod: Pod;
  runContext: RunContext;
  scopePods?: Pod[];
  workspacePath?: string | null;
}

interface SummaryFormatValidationResult {
  valid: boolean;
  error: string | null;
}

interface XmlMemoryBlock {
  tagName: string;
  content: string;
}

const GENERIC_POD_MEMORY_PATTERNS = [
  /goal runtime/i,
  /active todo/i,
  /開始動作前先檢查/i,
  /若沒有 active todo/i,
  /依照使用者當前的明確要求處理/i,
  /建立或修改檔案後/i,
  /檢查內容與檔案狀態/i,
  /確認結果無誤後再回報/i,
  /快速檢查/i,
  /git status/i,
];

function getScopeLogLabel(task: MemoryScopeTask): string {
  if (task.scopeType === "pod") {
    return `Pod Memory（${task.pod.name}）`;
  }

  return `Repo Memory（${task.scopeId}）`;
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function toEvidenceToolTrace(tool: PersistedToolUseInfo): MemoryEvidenceToolTrace {
  return {
    toolName: tool.toolName,
    status: tool.status,
    input: tool.input,
    output:
      typeof tool.output === "string"
        ? truncateText(tool.output, MAX_TOOL_OUTPUT_LENGTH)
        : null,
  };
}

function collectToolTraces(message: PersistedMessage): MemoryEvidenceToolTrace[] {
  return (message.subMessages ?? []).flatMap((subMessage) =>
    (subMessage.toolUse ?? []).map(toEvidenceToolTrace),
  );
}

function buildEvidenceMessages(
  entries: Array<{ podName: string; message: PersistedMessage }>,
): MemoryEvidenceMessage[] {
  return entries.map(({ podName, message }) => ({
    podName,
    role: message.role,
    content: truncateText(message.content, MAX_MESSAGE_CONTENT_LENGTH),
    toolTraces: collectToolTraces(message),
  }));
}

function flattenToolTraces(
  messages: MemoryEvidenceMessage[],
): MemoryEvidenceToolTrace[] {
  return messages.flatMap((message) => message.toolTraces);
}

function validateMemorySummaryFormat(summary: string | null): SummaryFormatValidationResult {
  if (summary === null) {
    return { valid: true, error: null };
  }

  const trimmed = summary.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: "summary 不可為空字串" };
  }

  if (trimmed.includes("```")) {
    return { valid: false, error: "不可使用 Markdown code fence" };
  }

  const tagPattern = /<([a-z][a-z0-9-]*)>([\s\S]*?)<\/\1>/g;
  let cursor = 0;
  let matchedCount = 0;

  for (const match of trimmed.matchAll(tagPattern)) {
    const fullMatch = match[0];
    const content = match[2] ?? "";
    const matchIndex = match.index ?? -1;

    if (matchIndex !== cursor) {
      const gapText = trimmed.slice(cursor, matchIndex).trim();
      if (gapText.length > 0) {
        return {
          valid: false,
          error: "XML 區塊之間不可夾帶未包在 tag 內的文字",
        };
      }
    }

    if (content.trim().length === 0) {
      return { valid: false, error: "每個 XML tag 內都必須有內容" };
    }

    if (/<\/?[a-z][a-z0-9-]*>/i.test(content)) {
      return {
        valid: false,
        error: "目前只允許單層 XML 區塊，tag 內不可再巢狀其他 tag",
      };
    }

    cursor = matchIndex + fullMatch.length;
    matchedCount += 1;
  }

  if (matchedCount === 0) {
    return {
      valid: false,
      error: "summary 必須完全由一個以上的 XML 區塊組成",
    };
  }

  if (trimmed.slice(cursor).trim().length > 0) {
    return {
      valid: false,
      error: "XML 區塊後不可有額外文字",
    };
  }

  return { valid: true, error: null };
}

function parseXmlMemoryBlocks(summary: string | null): XmlMemoryBlock[] {
  if (summary === null) {
    return [];
  }

  const blocks: XmlMemoryBlock[] = [];
  const tagPattern = /<([a-z][a-z0-9-]*)>([\s\S]*?)<\/\1>/g;

  for (const match of summary.matchAll(tagPattern)) {
    blocks.push({
      tagName: match[1] ?? "",
      content: (match[2] ?? "").trim(),
    });
  }

  return blocks;
}

function serializeXmlMemoryBlocks(blocks: XmlMemoryBlock[]): string | null {
  if (blocks.length === 0) {
    return null;
  }

  return blocks
    .map(
      (block) =>
        `<${block.tagName}>\n${block.content}\n</${block.tagName}>`,
    )
    .join("\n\n");
}

function isGenericPodMemoryText(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();
  return GENERIC_POD_MEMORY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function sanitizePodMemorySummary(summary: string | null): string | null {
  const blocks = parseXmlMemoryBlocks(summary).filter(
    (block) => !isGenericPodMemoryText(`${block.tagName} ${block.content}`),
  );
  return serializeXmlMemoryBlocks(blocks);
}

function buildCandidateSystemPrompt(scopeType: MemoryScopeType): string {
  if (scopeType === "pod") {
    return [
      "你是 Pod Memory Maintainer。",
      "你的任務是從本輪證據中挑出適合長期保留的 Pod 級穩定記憶。",
      "只保留這顆 Pod 自己的工作方式、工具偏好、互動習慣、固定限制與交接資訊。",
      "不要把 repository 共用事實、專案目的、目錄結構、repo 規範寫進 Pod Memory，除非那是這顆 Pod 專屬的工作規則。",
      "產品共用的基線行為也不要收進 Pod Memory，例如先檢查 Goal Runtime active todo、修改後順手檢查檔案內容或 git 狀態、最後再回報這類通用流程。",
      "只有明顯屬於這顆 Pod 的長期習慣或限制，才可 accepted=true。",
      "短期進度、一次性除錯細節、暫時狀態與噪音都應拒絕。",
      "所有 reason 與 summary 都使用 zh-TW。",
    ].join("\n");
  }

  return [
    "你是 Repository Memory Maintainer。",
    "你的任務是從本輪證據中挑出適合長期保留的 Repository 級穩定記憶。",
    "只保留這個 repository 本身的目的、結構、工作流程、程式風格與固定限制。",
    "不要把單一 Pod 的工作習慣、口吻、一次性偏好寫進 Repo Memory，除非那是 repo 共用規則。",
    "短期進度、一次性除錯細節、暫時狀態與噪音都應拒絕。",
    "所有 reason 與 summary 都使用 zh-TW。",
  ].join("\n");
}

function buildCandidateUserPrompt(evidencePack: MemoryEvidencePack): string {
  return JSON.stringify(
    {
      task: "請從以下證據產出 observations；accepted=true 代表建議納入正式記憶。",
      evidencePack,
    },
    null,
    2,
  );
}

function buildMergerSystemPrompt(scopeType: MemoryScopeType): string {
  const scopeLabel = scopeType === "pod" ? "Pod" : "Repository";
  const scopeSpecificRules =
    scopeType === "pod"
      ? "只保留這顆 Pod 自己的工作方式、工具習慣、固定限制與交接資訊；不要寫 repository 共用背景。"
      : "只保留 repository 目的、結構、workflow、code style 與固定限制；不要寫單一 Pod 的個人習慣。";
  return [
    `你是 ${scopeLabel} Memory Summary Merger。`,
    "請把既有 summary 與本輪 accepted observations 合併成一份可供未來 session 注入的精簡記憶。",
    `${scopeSpecificRules}`,
    "summary 必須使用 XML 區塊格式。",
    "tag 名稱不要限定在固定清單內，請依內容自訂語意清楚的 kebab-case 名稱，例如 <code-style>、<structure>、<workflow>。",
    "summary 必須完全由一個以上的單層 XML 區塊組成，不可在 tag 外面夾帶任何文字。",
    "每個 tag 內都必須有內容，沒有內容的 tag 直接省略。",
    "tag 內文使用 zh-TW，寫成精簡短句或單行條列重點，不要使用 Markdown code fence。",
    "避免冗長贅述，保留具體可行的重點。",
    "若沒有可保留的新資訊且既有 summary 也為空，請回傳 null。",
  ].join("\n");
}

function buildMergerUserPrompt(params: {
  scopeType: MemoryScopeType;
  existingSummary: string | null;
  acceptedObservations: MemoryCandidateResult["observations"];
  validationFeedback?: string | null;
  previousInvalidSummary?: string | null;
}): string {
  return JSON.stringify(
    {
      task: "請輸出合併後的正式記憶。",
      scopeType: params.scopeType,
      existingSummary: params.existingSummary,
      acceptedObservations: params.acceptedObservations,
      validationFeedback: params.validationFeedback ?? null,
      previousInvalidSummary: params.previousInvalidSummary ?? null,
    },
    null,
    2,
  );
}

class MemoryMaintainerService {
  private readonly scopeLocks = new Map<string, Promise<void>>();

  private normalizeCandidateObservations(
    task: MemoryScopeTask,
    observations: MemoryCandidateResult["observations"],
  ): MemoryCandidateResult["observations"] {
    if (task.scopeType !== "pod") {
      return observations;
    }

    return observations.map((observation) => {
      if (
        observation.accepted &&
        isGenericPodMemoryText(
          `${observation.title} ${observation.summary} ${observation.reason}`,
        )
      ) {
        return {
          ...observation,
          accepted: false,
          reason: `${observation.reason}；屬於產品共用基線行為，不應寫入 Pod Memory`,
        };
      }

      return observation;
    });
  }

  private async withScopeLock<T>(
    lockKey: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.scopeLocks.get(lockKey) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.scopeLocks.set(lockKey, previous.finally(() => current));

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.scopeLocks.get(lockKey) === current) {
        this.scopeLocks.delete(lockKey);
      }
    }
  }

  private createPodMemoryTasks(input: RunScopeInput): MemoryScopeTask[] {
    const tasks: MemoryScopeTask[] = [];
    if (input.pod.memoryEnabled === true) {
      tasks.push({
        scopeType: "pod",
        scopeId: input.pod.id,
        pod: input.pod,
        runContext: input.runContext,
      });
    }

    return tasks;
  }

  private getExistingSummary(
    scopeType: MemoryScopeType,
    scopeId: string,
  ): string | null {
    if (scopeType === "pod") {
      return memoryStateService.getPodState(scopeId)?.summary ?? null;
    }

    return memoryStateService.getRepoState(scopeId)?.summary ?? null;
  }

  private buildEvidencePack(task: MemoryScopeTask): MemoryEvidencePack | null {
    const scopePods = task.scopePods ?? [task.pod];
    const recentMessages = scopePods
      .flatMap((pod) =>
        runStore.getRunMessages(task.runContext.runId, pod.id).map((message) => ({
          podName: pod.name,
          message,
        })),
      )
      .sort((left, right) => left.message.timestamp.localeCompare(right.message.timestamp))
      .slice(-MAX_EVIDENCE_MESSAGES);
    const evidenceMessages = buildEvidenceMessages(recentMessages);
    const instances = scopePods
      .map((pod) => ({
        pod,
        instance: runStore.getPodInstance(task.runContext.runId, pod.id),
      }))
      .filter((entry) => entry.instance);
    const repoMetadata = task.pod.repositoryId
      ? repositoryService.getMetadata(task.pod.repositoryId)
      : undefined;
    const lastResponseSummaries = instances
      .flatMap(({ pod, instance }) => {
        const summary = instance?.lastResponseSummary?.trim() ?? "";
        return summary.length > 0 ? [`[${pod.name}] ${summary}`] : [];
      })
      .join("\n");

    if (
      evidenceMessages.length === 0 &&
      lastResponseSummaries.length === 0
    ) {
      return null;
    }

    return {
      scopeType: task.scopeType,
      scopeId: task.scopeId,
      podId: task.pod.id,
      podName: task.pod.name,
      repositoryId: task.pod.repositoryId,
      repositoryCurrentBranch: repoMetadata?.currentBranch ?? null,
      repositoryName: repoMetadata?.name ?? task.pod.repositoryId,
      existingSummary: this.getExistingSummary(task.scopeType, task.scopeId),
      lastResponseSummary:
        lastResponseSummaries.length > 0 ? lastResponseSummaries : null,
      recentMessages: evidenceMessages,
      recentToolTraces: flattenToolTraces(evidenceMessages),
    };
  }

  private getWorkspacePath(task: MemoryScopeTask): string {
    if (task.workspacePath) {
      return task.workspacePath;
    }

    return resolvePodCwd(task.pod);
  }

  private async runCandidateBuilder(
    task: MemoryScopeTask,
    evidencePack: MemoryEvidencePack,
  ): Promise<StructuredDisposableTaskOutput<typeof memoryCandidateSchema>> {
    const memoryConfig = configStore.getMemoryConfig();
    return executeStructuredDisposableTask({
      provider: memoryConfig.memoryProvider,
      model: memoryConfig.memoryModel,
      thinkingLevel: memoryConfig.memoryThinkingLevel,
      systemPrompt: buildCandidateSystemPrompt(task.scopeType),
      userMessage: buildCandidateUserPrompt(evidencePack),
      workspacePath: this.getWorkspacePath(task),
      logCategory: "Memory",
      logLabel: `${getScopeLogLabel(task)} 候選記憶建構`,
      schema: memoryCandidateSchema,
      responseFormat: {
        schemaName: "memory_candidate_result",
        description:
          "欄位 observations 必須存在；每筆 observation 都要含 title、summary、accepted、reason。",
      },
      toolContracts: [
        {
          name: "candidate_builder",
          description: "從證據中抽取候選記憶觀察。",
          inputDescription: "既有 summary、last response summary、recent messages、tool traces 與 repository 綁定資訊。",
          outputDescription:
            "observations 陣列；每筆 observation 說明是否 accepted 與原因。",
        },
      ],
    });
  }

  private async runSummaryMerger(
    task: MemoryScopeTask,
    existingSummary: string | null,
    acceptedObservations: MemoryCandidateResult["observations"],
    options?: {
      validationFeedback?: string | null;
      previousInvalidSummary?: string | null;
    },
  ): Promise<StructuredDisposableTaskOutput<typeof memoryMergedSummarySchema>> {
    const memoryConfig = configStore.getMemoryConfig();
    return executeStructuredDisposableTask({
      provider: memoryConfig.memoryProvider,
      model: memoryConfig.memoryModel,
      thinkingLevel: memoryConfig.memoryThinkingLevel,
      systemPrompt: buildMergerSystemPrompt(task.scopeType),
      userMessage: buildMergerUserPrompt({
        scopeType: task.scopeType,
        existingSummary,
        acceptedObservations,
        validationFeedback: options?.validationFeedback ?? null,
        previousInvalidSummary: options?.previousInvalidSummary ?? null,
      }),
      workspacePath: this.getWorkspacePath(task),
      logCategory: "Memory",
      logLabel: `${getScopeLogLabel(task)} 正式記憶合併`,
      schema: memoryMergedSummarySchema,
      responseFormat: {
        schemaName: "memory_merged_summary_result",
        description: "欄位 summary 可為字串或 null，並提供 reason。",
      },
      toolContracts: [
        {
          name: "summary_merger",
          description: "把 accepted observations 合併為正式記憶。",
          inputDescription: "既有 summary 與 accepted observations。",
          outputDescription: "summary 與 merge reason。",
        },
        {
          name: "memory_output_validator",
          description: "確保輸出只保留長期可用、可直接注入的新 session 記憶。",
          inputDescription: "合併後的 summary 草稿。",
          outputDescription: "最終精簡 summary 與驗證原因。",
        },
      ],
    });
  }

  private async runValidatedSummaryMerger(
    task: MemoryScopeTask,
    existingSummary: string | null,
    acceptedObservations: MemoryCandidateResult["observations"],
  ): Promise<StructuredDisposableTaskOutput<typeof memoryMergedSummarySchema>> {
    let validationFeedback: string | null = null;
    let previousInvalidSummary: string | null = null;
    let lastResult: StructuredDisposableTaskOutput<typeof memoryMergedSummarySchema> | null =
      null;

    for (
      let attempt = 1;
      attempt <= MAX_SUMMARY_FORMAT_CORRECTION_COUNT;
      attempt += 1
    ) {
      const mergedResult = await this.runSummaryMerger(
        task,
        existingSummary,
        acceptedObservations,
        {
          validationFeedback,
          previousInvalidSummary,
        },
      );
      lastResult = mergedResult;

      if (!mergedResult.success) {
        return mergedResult;
      }

      const validationResult = validateMemorySummaryFormat(
        mergedResult.data.summary,
      );
      if (validationResult.valid) {
        return mergedResult;
      }

      validationFeedback = [
        "你上一版的 summary 格式未通過驗證，請直接修正成合法 XML 區塊格式後重新輸出。",
        `驗證錯誤：${validationResult.error}`,
        "請保留原本語意，但修正格式。",
      ].join("\n");
      previousInvalidSummary = mergedResult.data.summary;

      logger.log(
        "Memory",
        "Update",
        `${getScopeLogLabel(task)} XML 格式驗證未通過，要求模型重修（attempt=${attempt}）`,
      );
    }

    return {
      success: false,
      error:
        lastResult && lastResult.success
          ? `正式記憶 XML 格式驗證失敗：${validateMemorySummaryFormat(lastResult.data.summary).error ?? "格式不合法"}`
          : "正式記憶 XML 格式驗證失敗",
      resolvedModel: lastResult?.resolvedModel ?? "",
      rawContent: lastResult?.rawContent ?? "",
    };
  }

  private writeSummary(
    scopeType: MemoryScopeType,
    scopeId: string,
    summary: string | null,
  ): void {
    if (scopeType === "pod") {
      memoryStateService.writePodSummary(scopeId, sanitizePodMemorySummary(summary));
      return;
    }

    memoryStateService.writeRepoSummary(scopeId, summary);
  }

  private async executeTask(task: MemoryScopeTask): Promise<void> {
    const scopeLockKey = `${task.scopeType}:${task.scopeId}`;
    await this.withScopeLock(scopeLockKey, async () => {
      const scopeLabel = getScopeLogLabel(task);
      memoryStateService.clearScopeMaintenanceRecords(task.scopeType, task.scopeId);

      const job = memoryStateService.createJob({
        scopeType: task.scopeType,
        scopeId: task.scopeId,
        sourcePodId: task.pod.id,
        repositoryId: task.pod.repositoryId,
        status: "pending",
        metadata: {
          runId: task.runContext.runId,
        },
      });

      logger.log(
        "Memory",
        "Create",
        `${scopeLabel} 已建立維護工作（runId=${task.runContext.runId}）`,
      );

      for (let attempt = 1; attempt <= MAX_MEMORY_RETRY_COUNT; attempt += 1) {
        memoryStateService.updateJob(job.id, {
          status: "running",
          attemptCount: attempt,
          errorMessage: null,
          metadata: {
            runId: task.runContext.runId,
            scopeType: task.scopeType,
          },
        });

        try {
          const currentPodState = memoryStateService.getPodState(task.pod.id);
          const currentRepoState =
            task.scopeType === "repository"
              ? memoryStateService.getRepoState(task.scopeId)
              : null;
          const isScopeEnabled =
            task.scopeType === "pod"
              ? currentPodState?.memoryEnabled
              : currentRepoState?.memoryEnabled;
          if (!isScopeEnabled) {
            logger.log(
              "Memory",
              "Update",
              `${scopeLabel} 已略過：memory 已停用`,
            );
            memoryStateService.clearScopeMaintenanceRecords(
              task.scopeType,
              task.scopeId,
            );
            return;
          }

          const evidencePack = this.buildEvidencePack(task);
          if (!evidencePack) {
            logger.log(
              "Memory",
              "Update",
              `${scopeLabel} 已略過：沒有可用證據`,
            );
            memoryStateService.updateJob(job.id, {
              status: "completed",
              attemptCount: attempt,
              metadata: {
                runId: task.runContext.runId,
                skippedReason: "no_evidence",
              },
            });
            return;
          }

          logger.log(
            "Memory",
            "Init",
            `${scopeLabel} 開始候選記憶建構（attempt=${attempt}）`,
          );
          const candidateResult = await this.runCandidateBuilder(task, evidencePack);
          if (!candidateResult.success) {
            throw new Error(candidateResult.error);
          }

          const normalizedObservations = this.normalizeCandidateObservations(
            task,
            candidateResult.data.observations,
          );

          for (const observation of normalizedObservations) {
            memoryStateService.recordObservation({
              jobId: job.id,
              scopeType: task.scopeType,
              scopeId: task.scopeId,
              kind: "candidate",
              status: observation.accepted ? "accepted" : "rejected",
              summary: observation.summary,
              payload: {
                title: observation.title,
                reason: observation.reason,
              },
            });
          }

          const acceptedObservations = normalizedObservations.filter(
            (observation) => observation.accepted,
          );

          logger.log(
            "Memory",
            "Init",
            `${scopeLabel} 開始正式記憶合併（accepted=${acceptedObservations.length}）`,
          );
          const mergedResult = await this.runValidatedSummaryMerger(
            task,
            evidencePack.existingSummary,
            acceptedObservations,
          );

          if (!mergedResult.success) {
            throw new Error(mergedResult.error);
          }

          const finalSummary = mergedResult.data.summary;
          this.writeSummary(task.scopeType, task.scopeId, finalSummary);
          memoryStateService.recordObservation({
            jobId: job.id,
            scopeType: task.scopeType,
            scopeId: task.scopeId,
            kind: "summary_merge",
            status: "applied",
            summary: finalSummary,
            payload: {
              reason: mergedResult.data.reason,
              acceptedObservationCount: acceptedObservations.length,
              resolvedModel: mergedResult.resolvedModel,
            },
          });

          memoryStateService.updateJob(job.id, {
            status: "completed",
            attemptCount: attempt,
            metadata: {
              runId: task.runContext.runId,
              acceptedObservationCount: acceptedObservations.length,
              resolvedModel: mergedResult.resolvedModel,
            },
          });
          logger.log(
            "Memory",
            "Complete",
            `${scopeLabel} 維護完成（accepted=${acceptedObservations.length}，model=${mergedResult.resolvedModel}）`,
          );
          return;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Memory 維護失敗";

          logger.warn(
            "Memory",
            "Warn",
            `${scopeLabel} 維護失敗，準備重試（attempt=${attempt}）：${errorMessage}`,
          );

          if (attempt >= MAX_MEMORY_RETRY_COUNT) {
            memoryStateService.updateJob(job.id, {
              status: "abandoned",
              attemptCount: attempt,
              errorMessage,
              metadata: {
                runId: task.runContext.runId,
                abandoned: true,
              },
            });
            memoryStateService.clearScopeMaintenanceRecords(
              task.scopeType,
              task.scopeId,
            );
            logger.warn(
              "Memory",
              "Warn",
              `${scopeLabel} 已放棄本輪維護，正式記憶保持不變`,
            );
            return;
          }

          memoryStateService.updateJob(job.id, {
            status: "retrying",
            attemptCount: attempt,
            errorMessage,
            metadata: {
              runId: task.runContext.runId,
              nextAttempt: attempt + 1,
            },
          });
        }
      }
    });
  }

  async scheduleForCompletedPod(
    runContext: RunContext,
    podId: string,
    snapshotPod?: Pod,
  ): Promise<void> {
    const pod =
      snapshotPod ?? runWorkflowSnapshotStore.getPod(runContext.runId, podId);
    if (!pod) {
      return;
    }

    const tasks = this.createPodMemoryTasks({
      runContext,
      pod,
    });

    if (tasks.length === 0) {
      logger.log("Memory", "Update", `略過 Pod「${pod.name}」記憶維護：memory 未啟用`);
      return;
    }

    await Promise.all(tasks.map((task) => this.executeTask(task)));
  }

  async scheduleRepositoriesForCompletedRun(
    runContext: RunContext,
    snapshotPods?: readonly Pod[],
  ): Promise<void> {
    try {
      const repoGroups = new Map<
        string,
        { representativePod: Pod; scopePods: Pod[]; workspacePath: string | null }
      >();

      const podsById = new Map(
        (snapshotPods ?? []).map((pod) => [pod.id, pod]),
      );
      for (const instance of runStore.getPodInstancesByRunId(runContext.runId)) {
        const pod =
          podsById.get(instance.podId) ?? podStore.getByIdGlobal(instance.podId)?.pod;
        const repositoryId = pod?.repositoryId ?? null;
        if (!pod || !repositoryId) {
          continue;
        }

        if (pod.repoMemoryEnabled !== true) {
          continue;
        }

        const existingGroup = repoGroups.get(repositoryId);
        if (existingGroup) {
          existingGroup.scopePods.push(pod);
          if (!existingGroup.workspacePath) {
            existingGroup.workspacePath =
              instance.runRepoPath ?? instance.workspacePath ?? null;
          }
          continue;
        }

        repoGroups.set(repositoryId, {
          representativePod: pod,
          scopePods: [pod],
          workspacePath: instance.runRepoPath ?? instance.workspacePath ?? null,
        });
      }

      for (const [repositoryId, group] of repoGroups) {
        await runRepoActivitySnapshotService.awaitCapture(
          runContext.runId,
          group.representativePod.id,
        );

        const snapshot = runRepoActivitySnapshotService.consumeSnapshot(
          runContext.runId,
          group.representativePod.id,
        );
        if (!snapshot) {
          logger.warn(
            "Memory",
            "Warn",
            `找不到 Repo Memory git status 快照（runId=${runContext.runId}, repositoryId=${repositoryId}）`,
          );
          continue;
        }

        if (!snapshot.hasActivity) {
          logger.log(
            "Memory",
            "Update",
            `略過 Repo Memory（${repositoryId}）：本輪未偵測到檔案讀寫`,
          );
          continue;
        }

        await this.executeTask({
          scopeType: "repository",
          scopeId: repositoryId,
          pod: group.representativePod,
          runContext,
          scopePods: group.scopePods,
          workspacePath: group.workspacePath,
        });
      }
    } finally {
      runRepoActivitySnapshotService.clearRun(runContext.runId);
    }
  }
}

export const memoryMaintainerService = new MemoryMaintainerService();
