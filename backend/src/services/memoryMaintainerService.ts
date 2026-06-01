import { z } from "zod";

import {
  executeStructuredDisposableTask,
  type StructuredDisposableTaskOutput,
} from "./disposableChatService.js";
import { configStore } from "./configStore.js";
import { memoryStateService, type MemoryScopeType } from "./memoryStateService.js";
import { podStore } from "./podStore.js";
import { repositoryService } from "./repositoryService.js";
import { runStore } from "./runStore.js";
import { resolvePodCwd } from "./shared/podPathResolver.js";
import { logger } from "../utils/logger.js";
import type { PersistedMessage, PersistedToolUseInfo } from "../types/persistence.js";
import type { Pod } from "../types/pod.js";
import type { RunContext } from "../types/run.js";

const MAX_MEMORY_RETRY_COUNT = 3;
const MAX_EVIDENCE_MESSAGES = 8;
const MAX_MESSAGE_CONTENT_LENGTH = 600;
const MAX_TOOL_OUTPUT_LENGTH = 400;
const REPO_ACTIVITY_TOOL_NAMES = new Set([
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "Grep",
  "Glob",
  "Bash",
]);

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
}

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

function buildEvidenceMessages(messages: PersistedMessage[]): MemoryEvidenceMessage[] {
  return messages.map((message) => ({
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

function hasRepositoryActivity(messages: PersistedMessage[]): boolean {
  return messages.some((message) =>
    collectToolTraces(message).some((tool) =>
      REPO_ACTIVITY_TOOL_NAMES.has(tool.toolName),
    ),
  );
}

function buildCandidateSystemPrompt(scopeType: MemoryScopeType): string {
  const scopeLabel = scopeType === "pod" ? "Pod" : "Repository";
  return [
    `你是 ${scopeLabel} Memory Maintainer。`,
    "你的任務是從本輪證據中挑出適合長期保留的穩定記憶。",
    "只保留未來新 session 真的有幫助的資訊，例如工作背景、限制、偏好、架構慣例、重要命令與檔案脈絡。",
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
  return [
    `你是 ${scopeLabel} Memory Summary Merger。`,
    "請把既有 summary 與本輪 accepted observations 合併成一份可供未來 session 注入的精簡記憶。",
    "輸出 summary 時使用 zh-TW，避免冗長贅述，保留具體可行的重點。",
    "若沒有可保留的新資訊且既有 summary 也為空，請回傳 null。",
  ].join("\n");
}

function buildMergerUserPrompt(params: {
  scopeType: MemoryScopeType;
  existingSummary: string | null;
  acceptedObservations: MemoryCandidateResult["observations"];
}): string {
  return JSON.stringify(
    {
      task: "請輸出合併後的正式記憶。",
      scopeType: params.scopeType,
      existingSummary: params.existingSummary,
      acceptedObservations: params.acceptedObservations,
    },
    null,
    2,
  );
}

class MemoryMaintainerService {
  private readonly scopeLocks = new Map<string, Promise<void>>();

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

  private createMemoryScopeTasks(input: RunScopeInput): MemoryScopeTask[] {
    const tasks: MemoryScopeTask[] = [];
    const podState = memoryStateService.getPodState(input.pod.id);
    if (podState?.memoryEnabled) {
      tasks.push({
        scopeType: "pod",
        scopeId: input.pod.id,
        pod: input.pod,
        runContext: input.runContext,
      });
    }

    if (
      input.pod.repositoryId &&
      memoryStateService.getRepoState(input.pod.repositoryId)?.memoryEnabled &&
      hasRepositoryActivity(
        runStore
          .getRunMessages(input.runContext.runId, input.pod.id)
          .slice(-MAX_EVIDENCE_MESSAGES),
      )
    ) {
      tasks.push({
        scopeType: "repository",
        scopeId: input.pod.repositoryId,
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
    const recentMessages = runStore
      .getRunMessages(task.runContext.runId, task.pod.id)
      .slice(-MAX_EVIDENCE_MESSAGES);
    const evidenceMessages = buildEvidenceMessages(recentMessages);
    const instance = runStore.getPodInstance(task.runContext.runId, task.pod.id);
    const repoMetadata = task.pod.repositoryId
      ? repositoryService.getMetadata(task.pod.repositoryId)
      : undefined;

    if (
      evidenceMessages.length === 0 &&
      (instance?.lastResponseSummary?.trim().length ?? 0) === 0
    ) {
      return null;
    }

    return {
      scopeType: task.scopeType,
      scopeId: task.scopeId,
      podId: task.pod.id,
      podName: task.pod.name,
      repositoryId: task.pod.repositoryId,
      repositoryName: task.pod.repositoryId,
      repositoryCurrentBranch: repoMetadata?.currentBranch ?? null,
      existingSummary: this.getExistingSummary(task.scopeType, task.scopeId),
      lastResponseSummary: instance?.lastResponseSummary ?? null,
      recentMessages: evidenceMessages,
      recentToolTraces: flattenToolTraces(evidenceMessages),
    };
  }

  private getWorkspacePath(pod: Pod): string {
    return resolvePodCwd(pod);
  }

  private async runCandidateBuilder(
    task: MemoryScopeTask,
    evidencePack: MemoryEvidencePack,
  ): Promise<StructuredDisposableTaskOutput<typeof memoryCandidateSchema>> {
    const memoryConfig = configStore.getMemoryConfig();
    return executeStructuredDisposableTask({
      provider: memoryConfig.memoryProvider,
      model: memoryConfig.memoryModel,
      thinkingLevel: null,
      systemPrompt: buildCandidateSystemPrompt(task.scopeType),
      userMessage: buildCandidateUserPrompt(evidencePack),
      workspacePath: this.getWorkspacePath(task.pod),
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
  ): Promise<StructuredDisposableTaskOutput<typeof memoryMergedSummarySchema>> {
    const memoryConfig = configStore.getMemoryConfig();
    return executeStructuredDisposableTask({
      provider: memoryConfig.memoryProvider,
      model: memoryConfig.memoryModel,
      thinkingLevel: null,
      systemPrompt: buildMergerSystemPrompt(task.scopeType),
      userMessage: buildMergerUserPrompt({
        scopeType: task.scopeType,
        existingSummary,
        acceptedObservations,
      }),
      workspacePath: this.getWorkspacePath(task.pod),
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

  private writeSummary(
    scopeType: MemoryScopeType,
    scopeId: string,
    summary: string | null,
  ): void {
    if (scopeType === "pod") {
      memoryStateService.writePodSummary(scopeId, summary);
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

          for (const observation of candidateResult.data.observations) {
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

          const acceptedObservations = candidateResult.data.observations.filter(
            (observation) => observation.accepted,
          );

          logger.log(
            "Memory",
            "Init",
            `${scopeLabel} 開始正式記憶合併（accepted=${acceptedObservations.length}）`,
          );
          const mergedResult = await this.runSummaryMerger(
            task,
            evidencePack.existingSummary,
            acceptedObservations,
          );

          if (!mergedResult.success) {
            throw new Error(mergedResult.error);
          }

          this.writeSummary(task.scopeType, task.scopeId, mergedResult.data.summary);
          memoryStateService.recordObservation({
            jobId: job.id,
            scopeType: task.scopeType,
            scopeId: task.scopeId,
            kind: "summary_merge",
            status: "applied",
            summary: mergedResult.data.summary,
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

  async scheduleForCompletedPod(runContext: RunContext, podId: string): Promise<void> {
    const podResult = podStore.getByIdGlobal(podId);
    if (!podResult) {
      return;
    }

    const podMemoryEnabled =
      memoryStateService.getPodState(podResult.pod.id)?.memoryEnabled ?? false;
    const repoMemoryEnabled = podResult.pod.repositoryId
      ? memoryStateService.getRepoState(podResult.pod.repositoryId)
          ?.memoryEnabled ?? false
      : false;
    const hasRepoActivity = podResult.pod.repositoryId
      ? hasRepositoryActivity(
          runStore
            .getRunMessages(runContext.runId, podResult.pod.id)
            .slice(-MAX_EVIDENCE_MESSAGES),
        )
      : false;

    const tasks = this.createMemoryScopeTasks({
      runContext,
      pod: podResult.pod,
    });

    if (tasks.length === 0) {
      const reason =
        podResult.pod.repositoryId && repoMemoryEnabled
          ? "未偵測到可維護的 Memory 範圍"
          : "memory 未啟用";
      logger.log("Memory", "Update", `略過 Pod「${podResult.pod.name}」記憶維護：${reason}`);
      if (
        podResult.pod.repositoryId &&
        ((!repoMemoryEnabled && !podMemoryEnabled) ||
          (repoMemoryEnabled && !hasRepoActivity))
      ) {
        logger.log(
          "Memory",
          "Update",
          repoMemoryEnabled
            ? `略過 Repo Memory（${podResult.pod.repositoryId}）：本輪未偵測到檔案讀寫`
            : `略過 Repo Memory（${podResult.pod.repositoryId}）：memory 未啟用`,
        );
      }
      return;
    }

    if (
      podResult.pod.repositoryId &&
      !tasks.some((task) => task.scopeType === "repository")
    ) {
      logger.log(
        "Memory",
        "Update",
        repoMemoryEnabled
          ? `略過 Repo Memory（${podResult.pod.repositoryId}）：本輪未偵測到檔案讀寫`
          : `略過 Repo Memory（${podResult.pod.repositoryId}）：memory 未啟用`,
      );
    }

    await Promise.all(tasks.map((task) => this.executeTask(task)));
  }
}

export const memoryMaintainerService = new MemoryMaintainerService();
