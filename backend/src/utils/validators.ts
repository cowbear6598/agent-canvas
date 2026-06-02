import { Result, ok, err } from "../types";
import { repositoryService } from "../services/repositoryService.js";
import { gitService } from "../services/workspace/gitService.js";
import { repositoryNoteStore } from "../services/noteStores.js";
import { podStore } from "../services/podStore.js";
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

export async function validateRepositoryAccessibleInCanvas(
  canvasId: string,
  repositoryId: string,
): Promise<Result<string>> {
  const validateResult = await validateRepositoryExists(repositoryId);
  if (!validateResult.success) {
    return err(validateResult.error);
  }

  const hasBoundPods = podStore.findByRepositoryId(canvasId, repositoryId).length > 0;
  const hasRepositoryNotes =
    repositoryNoteStore.findByForeignKey(canvasId, repositoryId).length > 0;

  if (!hasBoundPods && !hasRepositoryNotes) {
    return err(createI18nError("errors.repoNotFound", { id: repositoryId }));
  }

  return ok(validateResult.data);
}
