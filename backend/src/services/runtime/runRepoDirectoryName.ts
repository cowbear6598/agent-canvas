export const RUN_REPO_DIRECTORY_SEPARATOR = "-agnet-canvas-";

export interface RunRepoDirectoryNameParts {
  repositoryId: string;
  runId: string;
}

export function parseRunRepoDirectoryName(
  directoryName: string,
): RunRepoDirectoryNameParts | null {
  const separatorIndex = directoryName.lastIndexOf(
    RUN_REPO_DIRECTORY_SEPARATOR,
  );
  if (separatorIndex <= 0) {
    return null;
  }

  const repositoryId = directoryName.slice(0, separatorIndex);
  const runId = directoryName.slice(
    separatorIndex + RUN_REPO_DIRECTORY_SEPARATOR.length,
  );
  if (!runId) {
    return null;
  }

  return {
    repositoryId,
    runId,
  };
}

export function buildRunRepoDirectoryName(
  repositoryId: string,
  runId: string,
): string {
  return `${repositoryId}${RUN_REPO_DIRECTORY_SEPARATOR}${runId}`;
}

export function isRunRepoDirectoryName(directoryName: string): boolean {
  return parseRunRepoDirectoryName(directoryName) !== null;
}
