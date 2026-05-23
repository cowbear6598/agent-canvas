const BRANCH_NAME_PATTERN = /^[a-zA-Z0-9_.\-/]+$/;
const INVALID_BRANCH_SEQUENCES = ["..", "//", "@{"] as const;
const INVALID_BRANCH_CHARS = /[\s~^:?*[\]\\]/;

function hasControlCharacter(value: string): boolean {
  return [...value].some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

export function isValidGitBranchName(branchName: string): boolean {
  if (!branchName || branchName.length > 200) {
    return false;
  }

  if (!BRANCH_NAME_PATTERN.test(branchName)) {
    return false;
  }

  if (branchName.startsWith("-") || branchName.startsWith("/")) {
    return false;
  }

  if (branchName.endsWith("/") || branchName.endsWith(".")) {
    return false;
  }

  if (branchName === "." || branchName.endsWith(".lock")) {
    return false;
  }

  if (
    INVALID_BRANCH_CHARS.test(branchName) ||
    hasControlCharacter(branchName)
  ) {
    return false;
  }

  return !INVALID_BRANCH_SEQUENCES.some((sequence) =>
    branchName.includes(sequence),
  );
}
