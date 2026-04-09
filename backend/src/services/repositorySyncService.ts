import { repositoryService } from "./repositoryService.js";
import { podStore } from "./podStore.js";
import { commandService } from "./commandService.js";
import { skillService } from "./skillService.js";
import { subAgentService } from "./subAgentService.js";
import { podManifestService } from "./podManifestService.js";
import { logger } from "../utils/logger.js";
import { fsOperation } from "../utils/operationHelpers.js";
import { validatePodId } from "../utils/pathValidator.js";
import { getDb } from "../database/index.js";
import { getStatements } from "../database/statements.js";

interface PodResources {
  commandIds: string[];
  skillIds: string[];
  subAgentIds: string[];
}

class RepositorySyncService {
  private locks: Map<string, Promise<void>> = new Map();

  async syncRepositoryResources(repositoryId: string): Promise<void> {
    const existingLock = this.locks.get(repositoryId);
    if (existingLock) {
      await this.waitForExistingLock(repositoryId, existingLock);
      return;
    }

    const syncPromise = this.performSync(repositoryId).catch((error) => {
      logger.error(
        "Repository",
        "Error",
        `同步 repository ${repositoryId} 資源失敗`,
        error,
      );
    });
    this.locks.set(repositoryId, syncPromise);

    await syncPromise;
    if (this.locks.get(repositoryId) === syncPromise) {
      this.locks.delete(repositoryId);
    }
  }

  private async waitForExistingLock(
    repositoryId: string,
    existingLock: Promise<void>,
  ): Promise<void> {
    await existingLock;
    const newLock = this.locks.get(repositoryId);
    if (newLock && newLock !== existingLock) {
      await newLock;
    }
  }

  private collectPodResources(repositoryId: string): Map<string, PodResources> {
    const allPods = podStore.findAllByRepositoryId(repositoryId);

    return new Map(
      allPods.map(({ pod }) => [
        pod.id,
        {
          commandIds: pod.commandId ? [pod.commandId] : [],
          skillIds: [...pod.skillIds],
          subAgentIds: [...pod.subAgentIds],
        },
      ]),
    );
  }

  private async writePodManifests(
    podResourcesMap: Map<string, PodResources>,
    repositoryPath: string,
    repositoryId: string,
  ): Promise<void> {
    // 串行執行，避免多個 Pod 共用同一 repo 時，
    // 某 Pod 的 cleanEmptyDirectories 刪除目錄後
    // 導致其他 Pod 的 copyCommand 寫入失敗的 race condition
    for (const [podId, resources] of podResourcesMap) {
      await this.writeSinglePodManifest(
        podId,
        resources,
        repositoryPath,
        repositoryId,
      );
    }
  }

  private async writeSinglePodManifest(
    podId: string,
    resources: PodResources,
    repositoryPath: string,
    repositoryId: string,
  ): Promise<void> {
    await podManifestService.deleteManagedFiles(repositoryId, podId);

    const copyCommands = resources.commandIds.map((commandId) =>
      fsOperation(
        () => commandService.copyCommandToRepository(commandId, repositoryPath),
        `複製 command ${commandId} 到 repository ${repositoryId} 失敗`,
      ),
    );
    const copySkills = resources.skillIds.map((skillId) =>
      fsOperation(
        () => skillService.copySkillToRepository(skillId, repositoryPath),
        `複製 skill ${skillId} 到 repository ${repositoryId} 失敗`,
      ),
    );
    const copySubAgents = resources.subAgentIds.map((subAgentId) =>
      fsOperation(
        () =>
          subAgentService.copySubAgentToRepository(subAgentId, repositoryPath),
        `複製 subagent ${subAgentId} 到 repository ${repositoryId} 失敗`,
      ),
    );

    await Promise.all([...copyCommands, ...copySkills, ...copySubAgents]);

    const managedFiles = await this.collectPodManagedFiles(resources);
    podManifestService.writeManifest(repositoryId, podId, managedFiles);
  }

  private async performSync(repositoryId: string): Promise<void> {
    const repositoryPath = repositoryService.getRepositoryPath(repositoryId);
    const podResourcesMap = this.collectPodResources(repositoryId);

    await this.cleanOrphanManifests(repositoryId, podResourcesMap);
    await this.writePodManifests(podResourcesMap, repositoryPath, repositoryId);

    const totals = [...podResourcesMap.values()].reduce(
      (acc, podResources) => ({
        commands: acc.commands + podResources.commandIds.length,
        skills: acc.skills + podResources.skillIds.length,
        subAgents: acc.subAgents + podResources.subAgentIds.length,
      }),
      { commands: 0, skills: 0, subAgents: 0 },
    );

    logger.log(
      "Repository",
      "Update",
      `已同步 Repository ${repositoryId}：${totals.commands} 個 Command、${totals.skills} 個 Skill、${totals.subAgents} 個 SubAgent`,
    );
  }

  private async cleanOrphanManifests(
    repositoryId: string,
    activePodResourcesMap: Map<string, PodResources>,
  ): Promise<void> {
    const db = getDb();
    const stmts = getStatements(db);

    interface ManifestRow {
      pod_id: string;
    }
    const rows = stmts.podManifest.selectByRepositoryId.all(
      repositoryId,
    ) as ManifestRow[];

    for (const row of rows) {
      const podId = row.pod_id;

      if (activePodResourcesMap.has(podId)) continue;

      if (!validatePodId(podId)) {
        logger.warn(
          "Repository",
          "Warn",
          `孤兒 manifest 的 podId 格式無效，跳過：${podId}`,
        );
        continue;
      }

      await podManifestService.deleteManagedFiles(repositoryId, podId);
    }
  }

  private async collectPodManagedFiles(
    resources: PodResources,
  ): Promise<string[]> {
    const files: string[] = [];

    for (const commandId of resources.commandIds) {
      files.push(...podManifestService.collectCommandFiles(commandId));
    }

    for (const skillId of resources.skillIds) {
      const skillSourcePath = skillService.getSkillDirectoryPath(skillId);
      const skillFiles = await podManifestService.collectSkillFiles(
        skillId,
        skillSourcePath,
      );
      files.push(...skillFiles);
    }

    for (const subAgentId of resources.subAgentIds) {
      files.push(...podManifestService.collectSubAgentFiles(subAgentId));
    }

    return files;
  }
}

export const repositorySyncService = new RepositorySyncService();
