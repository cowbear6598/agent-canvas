import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { Result, ok, err } from '../../types';
import { logger } from '../../utils/logger.js';
import { fsOperation } from '../../utils/operationHelpers.js';
import { fileExists } from '../shared/fileResourceHelpers.js';
import { safeJsonParse } from '../../utils/safeJsonParse.js';

class PersistenceService {
  async readJson<T>(filePath: string): Promise<Result<T | null>> {
    const exists = await fileExists(filePath);
    if (!exists) {
      return ok(null);
    }

    const readResult = await fsOperation(
      () => fs.readFile(filePath, 'utf-8'),
      `讀取檔案失敗: ${filePath}`
    );

    if (!readResult.success) {
      return err(readResult.error);
    }

    const data = safeJsonParse<T>(readResult.data as string);
    if (data === null) {
      logger.error('Startup', 'Error', `[Persistence] 無效的 JSON 檔案 ${path.basename(filePath)}`);
      const backupPath = `${filePath}.corrupted.${Date.now()}`;
      const backupResult = await fsOperation(
        () => fs.copyFile(filePath, backupPath),
        `[Persistence] 備份損壞檔案失敗`
      );
      if (backupResult.success) {
        logger.log('Startup', 'Save', `偵測到損壞的 JSON，已備份：${path.basename(filePath)}`);
      }
      return err(`JSON 檔案格式錯誤: ${path.basename(filePath)}`);
    }

    return ok(data);
  }

  async writeJson<T>(filePath: string, data: T): Promise<Result<void>> {
    const directory = path.dirname(filePath);
    const dirResult = await this.ensureDirectory(directory);

    if (!dirResult.success) {
      return err(dirResult.error);
    }

    const tempPath = `${filePath}.tmp.${randomUUID()}`;
    const jsonContent = JSON.stringify(data, null, 2);

    const writeResult = await fsOperation(
      () => fs.writeFile(tempPath, jsonContent, 'utf-8'),
      `寫入暫存檔失敗: ${filePath}`
    );
    if (!writeResult.success) {
      await fs.unlink(tempPath).catch(() => {});
      return err(writeResult.error);
    }

    const renameResult = await fsOperation(
      () => fs.rename(tempPath, filePath),
      `寫入檔案失敗: ${filePath}`
    );
    if (!renameResult.success) {
      await fs.unlink(tempPath).catch(() => {});
      return err(renameResult.error);
    }

    return ok();
  }

  async ensureDirectory(dirPath: string): Promise<Result<void>> {
    return fsOperation(
      () => fs.mkdir(dirPath, { recursive: true }).then(() => undefined),
      `建立目錄失敗: ${dirPath}`
    );
  }

  async deleteFile(filePath: string): Promise<Result<void>> {
    const exists = await fileExists(filePath);
    if (!exists) {
      return ok(undefined);
    }

    return fsOperation(
      () => fs.unlink(filePath),
      `刪除檔案失敗: ${filePath}`
    );
  }
}

export const persistenceService = new PersistenceService();
