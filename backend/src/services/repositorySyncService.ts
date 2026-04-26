import { repositoryService } from "./repositoryService.js";
import { podStore } from "./podStore.js";
import { podManifestService } from "./podManifestService.js";
import { logger } from "../utils/logger.js";
import { validatePodId } from "../utils/pathValidator.js";
import { getStmts } from "../database/stmtsHelper.js";

interface PodResources {
  commandIds: string[];
}

class RepositorySyncService {
  private locks: Map<string, Promise<void>> = new Map();

  /**
   * 同步指定 Repository 的資源（Command / Skill manifest）。
   *
   * 此函式保證不拋出：即使 performSync 內部失敗，錯誤只會記入 log，
   * 不會向呼叫端傳播。呼叫端無需 try/catch。
   *
   * 同時對同一 repositoryId 的並發呼叫，後者會等待前者完成後才繼續，
   * 以 lock 機制防止 race condition。
   */
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

  /**
   * 等待指定 repositoryId 上的所有 pending lock 都 resolve。
   * 採用鏈式等待：每次等待完前一個 lock 後，再檢查是否又有新的 lock 排入，
   * 直到沒有更多 pending lock 為止，確保呼叫端在所有進行中的 sync 都完成後才返回。
   */
  private async waitForExistingLock(
    repositoryId: string,
    existingLock: Promise<void>,
  ): Promise<void> {
    let currentLock: Promise<void> = existingLock;
    let isLockReleased = false;

    do {
      await currentLock;
      const nextLock = this.locks.get(repositoryId);
      // 沒有新的 lock 排入時結束等待；有新的 lock 排入（在等待期間又有新的 sync 啟動）則繼續等待
      isLockReleased = !nextLock || nextLock === currentLock;
      if (!isLockReleased) {
        currentLock = nextLock!;
      }
    } while (!isLockReleased);
  }

  private collectPodResources(repositoryId: string): Map<string, PodResources> {
    const allPods = podStore.findAllByRepositoryId(repositoryId);

    return new Map(
      allPods.map(({ pod }) => {
        // 語意明確的中間變數：避免 pod.commandId ? [pod.commandId] : [] 三元運算式在閱讀時語意模糊
        const commandIds = pod.commandId ? [pod.commandId] : [];
        return [
          pod.id,
          {
            commandIds,
          },
        ];
      }),
    );
  }

  /**
   * 將所有 Pod 的資源 manifest 依序寫入 Repository 目錄。
   *
   * 此函式刻意採用串行（for...await）而非並行（Promise.all）執行：
   * 多個 Pod 共用同一 Repository 時，若並行執行，某 Pod 的 cleanEmptyDirectories
   * 可能刪除目錄後，導致其他 Pod 的 copyCommand 嘗試寫入該目錄時失敗（race condition）。
   * 請勿將此改為並行，除非底層的 cleanEmptyDirectories 與 copyCommand 已具備並發安全性。
   */
  private async writePodManifests(
    podResourcesMap: Map<string, PodResources>,
    repositoryPath: string,
    repositoryId: string,
  ): Promise<void> {
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
      }),
      { commands: 0 },
    );

    logger.log(
      "Repository",
      "Update",
      `已同步 Repository ${repositoryId}：${totals.commands} 個 Command`,
    );
  }

  private async cleanOrphanManifests(
    repositoryId: string,
    activePodResourcesMap: Map<string, PodResources>,
  ): Promise<void> {
    interface ManifestRow {
      pod_id: string;
    }
    const rows = getStmts().podManifest.selectByRepositoryId.all(
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

    return files;
  }
}

export const repositorySyncService = new RepositorySyncService();
