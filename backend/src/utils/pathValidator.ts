import path from "path";

export function validateResourceId(id: string): boolean {
  if (!id) {
    return false;
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return false;
  }

  return id.length <= 100;
}

export const validateCommandId = validateResourceId;

export function validatePodId(podId: string): boolean {
  if (!podId) {
    return false;
  }

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    podId,
  );
}

export function isPathWithinDirectory(
  filePath: string,
  directory: string,
): boolean {
  const resolvedPath = path.resolve(filePath);
  const resolvedDir = path.resolve(directory);

  return (
    resolvedPath.startsWith(resolvedDir + path.sep) ||
    resolvedPath === resolvedDir
  );
}

function validatePathSegment(segment: string): boolean {
  return /^[a-zA-Z0-9-]+$/.test(segment) && segment.length <= 100;
}

export function sanitizePathSegment(segment: string): string {
  const sanitized = path.basename(segment);
  if (!validatePathSegment(sanitized)) {
    throw new Error("名稱格式不正確，只能包含英文、數字、dash");
  }
  return sanitized;
}
