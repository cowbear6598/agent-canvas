import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { Result, ok, err } from '../../types';
import { logger } from '../../utils/logger.js';
import { fsOperation } from '../../utils/operationHelpers.js';
import { fileExists } from '../shared/fileResourceHelpers.js';

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

    try {
      const data = JSON.parse(readResult.data as string);
      return ok(data as T);
    } catch (error) {
      if (error instanceof SyntaxError) {
        logger.error('Startup', 'Error', `[Persistence] 無效的 JSON 檔案 ${filePath}: ${error.message}`);
        const backupPath = `${filePath}.corrupted.${Date.now()}`;
        const backupResult = await fsOperation(
          () => fs.copyFile(filePath, backupPath),
          `[Persistence] 備份損壞檔案失敗`
        );
        if (backupResult.success) {
          logger.log('Startup', 'Save', `[Persistence] 已備份損壞的檔案至 ${backupPath}`);
        }
        return err(`JSON 檔案格式錯誤: ${filePath}`);
      }
      return err(`讀取檔案失敗: ${filePath}`);
    }
  }

  async writeJson<T>(filePath: string, data: T): Promise<Result<void>> {
    const directory = path.dirname(filePath);
    const dirResult = await this.ensureDirectory(directory);

    if (!dirResult.success) {
      return err(dirResult.error);
    }

    return fsOperation(async () => {
      const tempPath = `${filePath}.tmp.${randomUUID()}`;
      const jsonContent = JSON.stringify(data, null, 2);

      try {
        await fs.writeFile(tempPath, jsonContent, 'utf-8');
        await fs.rename(tempPath, filePath);
      } catch (error) {
        await fs.unlink(tempPath).catch(() => {});
        throw error;
      }
    }, `寫入檔案失敗: ${filePath}`);
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
