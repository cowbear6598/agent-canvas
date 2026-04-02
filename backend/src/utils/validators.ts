import { Result, ok, err } from "../types";
import { repositoryService } from "../services/repositoryService.js";
import { gitService } from "../services/workspace/gitService.js";
import { createI18nError } from "./i18nError.js";

export async function validateRepositoryExists(
  repositoryId: string,
): Promise<Result<string>> {
  const exists = await repositoryService.exists(repositoryId);
  if (!exists) {
    return err(createI18nError("errors.repoNotFound", { id: repositoryId }));
  }

  const repositoryPath = repositoryService.getRepositoryPath(repositoryId);
  return ok(repositoryPath);
}

export async function getValidatedGitRepository(
  repositoryId: string,
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
    return err(createI18nError("errors.notGitRepo"));
  }

  return ok({ repositoryPath, isGit: true });
}
