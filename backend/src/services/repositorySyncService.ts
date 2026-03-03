import fs from 'node:fs/promises';
import path from 'node:path';
import { repositoryService } from './repositoryService.js';
import { podStore } from './podStore.js';
import { canvasStore } from './canvasStore.js';
import { commandService } from './commandService.js';
import { skillService } from './skillService.js';
import { subAgentService } from './subAgentService.js';
import { podManifestService } from './podManifestService.js';
import { logger } from '../utils/logger.js';
import { fsOperation } from '../utils/operationHelpers.js';
import { validatePodId } from '../utils/pathValidator.js';

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
      logger.error('Repository', 'Error', `同步 repository ${repositoryId} 資源失敗`, error);
    });
    this.locks.set(repositoryId, syncPromise);

    await syncPromise;
    if (this.locks.get(repositoryId) === syncPromise) {
      this.locks.delete(repositoryId);
    }
  }

  private async waitForExistingLock(repositoryId: string, existingLock: Promise<void>): Promise<void> {
    await existingLock;
    const newLock = this.locks.get(repositoryId);
    if (newLock && newLock !== existingLock) {
      await newLock;
    }
  }

  private collectPodResources(allCanvases: ReturnType<typeof canvasStore.list>, repositoryId: string): Map<string, PodResources> {
    const podResourcesMap = new Map<string, PodResources>();

    for (const canvas of allCanvases) {
      const pods = podStore.findByRepositoryId(canvas.id, repositoryId);

      for (const pod of pods) {
        const resources: PodResources = {
          commandIds: pod.commandId ? [pod.commandId] : [],
          skillIds: [...pod.skillIds],
          subAgentIds: [...pod.subAgentIds],
        };
        podResourcesMap.set(pod.id, resources);
      }
    }

    return podResourcesMap;
  }

  private async writePodManifests(podResourcesMap: Map<string, PodResources>, repositoryPath: string, repositoryId: string): Promise<void> {
    for (const [podId, resources] of podResourcesMap) {
      await this.writeSinglePodManifest(podId, resources, repositoryPath, repositoryId);
    }
  }

  private async writeSinglePodManifest(podId: string, resources: PodResources, repositoryPath: string, repositoryId: string): Promise<void> {
    await podManifestService.deleteManagedFiles(repositoryPath, podId);

    for (const commandId of resources.commandIds) {
      await fsOperation(
        () => commandService.copyCommandToRepository(commandId, repositoryPath),
        `複製 command ${commandId} 到 repository ${repositoryId} 失敗`
      );
    }

    for (const skillId of resources.skillIds) {
      await fsOperation(
        () => skillService.copySkillToRepository(skillId, repositoryPath),
        `複製 skill ${skillId} 到 repository ${repositoryId} 失敗`
      );
    }

    for (const subAgentId of resources.subAgentIds) {
      await fsOperation(
        () => subAgentService.copySubAgentToRepository(subAgentId, repositoryPath),
        `複製 subagent ${subAgentId} 到 repository ${repositoryId} 失敗`
      );
    }

    const managedFiles = await this.collectPodManagedFiles(resources);
    await podManifestService.writeManifest(repositoryPath, podId, managedFiles);
  }

  private async performSync(repositoryId: string): Promise<void> {
    const repositoryPath = repositoryService.getRepositoryPath(repositoryId);
    const allCanvases = canvasStore.list();
    const podResourcesMap = this.collectPodResources(allCanvases, repositoryId);

    await this.cleanOrphanManifests(repositoryPath, podResourcesMap);
    await this.writePodManifests(podResourcesMap, repositoryPath, repositoryId);

    const totalCommands = [...podResourcesMap.values()].reduce((sum, r) => sum + r.commandIds.length, 0);
    const totalSkills = [...podResourcesMap.values()].reduce((sum, r) => sum + r.skillIds.length, 0);
    const totalSubAgents = [...podResourcesMap.values()].reduce((sum, r) => sum + r.subAgentIds.length, 0);

    logger.log('Repository', 'Update', `已同步 Repository ${repositoryId}：${totalCommands} 個 Command、${totalSkills} 個 Skill、${totalSubAgents} 個 SubAgent`);
  }

  private isOrphanManifest(fileName: string, activePodResourcesMap: Map<string, PodResources>): { isOrphan: boolean; podId?: string } {
    const manifestPattern = /^\.pod-manifest-(.+)\.json$/;
    const match = fileName.match(manifestPattern);

    if (!match) return { isOrphan: false };

    const podId = match[1];

    if (activePodResourcesMap.has(podId)) return { isOrphan: false };

    if (!validatePodId(podId)) {
      logger.warn('Repository', 'Warn', `孤兒 manifest 的 podId 格式無效，跳過：${podId}`);
      return { isOrphan: false };
    }

    return { isOrphan: true, podId };
  }

  private async cleanOrphanManifests(repositoryPath: string, activePodResourcesMap: Map<string, PodResources>): Promise<void> {
    const claudeDir = path.join(repositoryPath, '.claude');

    const dirExists = await fs.access(claudeDir).then(() => true).catch(() => false);
    if (!dirExists) return;

    const fileNames = await fs.readdir(claudeDir);

    for (const fileName of fileNames) {
      const { isOrphan, podId } = this.isOrphanManifest(fileName, activePodResourcesMap);
      if (!isOrphan || !podId) continue;

      await podManifestService.deleteManagedFiles(repositoryPath, podId);
    }
  }

  private async collectPodManagedFiles(resources: PodResources): Promise<string[]> {
    const files: string[] = [];

    for (const commandId of resources.commandIds) {
      files.push(...podManifestService.collectCommandFiles(commandId));
    }

    for (const skillId of resources.skillIds) {
      const skillSourcePath = skillService.getSkillDirectoryPath(skillId);
      const skillFiles = await podManifestService.collectSkillFiles(skillId, skillSourcePath);
      files.push(...skillFiles);
    }

    for (const subAgentId of resources.subAgentIds) {
      files.push(...podManifestService.collectSubAgentFiles(subAgentId));
    }

    return files;
  }
}

export const repositorySyncService = new RepositorySyncService();
