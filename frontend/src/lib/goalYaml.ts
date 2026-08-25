import { parse, stringify } from "yaml";
import type { GoalTodoItem } from "@/types";

export const GOAL_YAML_VERSION = 1;
export const MAX_GOAL_YAML_FILE_BYTES = 1024 * 1024;

export type GoalYamlErrorCode =
  | "invalidFileType"
  | "tooLarge"
  | "invalidFormat"
  | "unsupportedVersion"
  | "invalidTodo";

export class GoalYamlError extends Error {
  readonly code: GoalYamlErrorCode;

  constructor(code: GoalYamlErrorCode, message: string) {
    super(message);
    this.name = "GoalYamlError";
    this.code = code;
  }
}

interface GoalYamlDocument {
  version: typeof GOAL_YAML_VERSION;
  todos: Array<{ text: string }>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function serializeGoalYaml(
  todos: ReadonlyArray<Pick<GoalTodoItem, "text">>,
): string {
  const document: GoalYamlDocument = {
    version: GOAL_YAML_VERSION,
    todos: todos.map((todo) => ({ text: todo.text })),
  };

  return stringify(document, { lineWidth: 0 });
}

export function parseGoalYaml(source: string): string[] {
  let document: unknown;

  try {
    document = parse(source, { maxAliasCount: 0 });
  } catch {
    throw new GoalYamlError("invalidFormat", "Goal YAML 格式無法解析");
  }

  if (!isPlainObject(document)) {
    throw new GoalYamlError("invalidFormat", "Goal YAML 必須是物件格式");
  }

  if (document.version !== GOAL_YAML_VERSION) {
    throw new GoalYamlError(
      "unsupportedVersion",
      "Goal YAML 版本不受支援",
    );
  }

  if (!Array.isArray(document.todos)) {
    throw new GoalYamlError("invalidFormat", "Goal YAML 缺少 todos 清單");
  }

  return document.todos.map((todo) => {
    if (
      !isPlainObject(todo) ||
      typeof todo.text !== "string" ||
      todo.text.trim().length === 0
    ) {
      throw new GoalYamlError("invalidTodo", "Goal YAML 含有無效的 Todo");
    }

    return todo.text;
  });
}

export async function parseGoalYamlFile(file: File): Promise<string[]> {
  if (!file.name.toLowerCase().endsWith(".yaml")) {
    throw new GoalYamlError(
      "invalidFileType",
      "Goal 匯入檔案必須使用 .yaml 副檔名",
    );
  }
  if (file.size > MAX_GOAL_YAML_FILE_BYTES) {
    throw new GoalYamlError("tooLarge", "Goal YAML 檔案大小超過限制");
  }

  return parseGoalYaml(await file.text());
}

export function createGoalYamlFilename(podName: string): string {
  const safeName = Array.from(podName.trim(), (character) =>
    character.charCodeAt(0) < 32 || /[\\/:*?"<>|]/.test(character)
      ? "-"
      : character,
  )
    .join("")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return `${safeName || "goal"}-goal.yaml`;
}
