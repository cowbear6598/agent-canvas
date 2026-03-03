import { Result, ok, err } from '../types';
import { repositoryService } from '../services/repositoryService.js';
import { gitService } from '../services/workspace/gitService.js';

export async function validateRepositoryExists(repositoryId: string): Promise<Result<string>> {
  const exists = await repositoryService.exists(repositoryId);
  if (!exists) {
    return err(`找不到 Repository: ${repositoryId}`);
  }

  const repositoryPath = repositoryService.getRepositoryPath(repositoryId);
  return ok(repositoryPath);
}

export async function getValidatedGitRepository(
  repositoryId: string
): Promise<Result<{ repositoryPath: string; isGit: boolean }>> {
  const validateResult = await validateRepositoryExists(repositoryId);
  if (!validateResult.success) {
    return err(validateResult.error);
  }

  const repositoryPath = validateResult.data;
  const isGitResult = await gitService.isGitRepository(repositoryPath);

  if (!isGitResult.success) {
    return err(isGitResult.error);
  }

  if (!isGitResult.data) {
    return err('不是 Git Repository');
  }

  return ok({ repositoryPath, isGit: true });
}
