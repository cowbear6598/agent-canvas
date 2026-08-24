import { logger } from "../../utils/logger.js";

export type CodexSkillScope = "user" | "repo" | "system" | "admin";
export type CodexSkillOrigin = "official" | "custom";

interface CodexSkillMetadata {
  name: string;
  description: string;
  shortDescription?: string;
  path: string;
  scope: CodexSkillScope;
  enabled: boolean;
}

interface SkillsListResult {
  data?: Array<{
    cwd: string;
    skills: CodexSkillMetadata[];
    errors?: Array<{ path: string; message: string }>;
  }>;
}

interface JsonRpcMessage {
  id?: number;
  result?: unknown;
  error?: unknown;
}

export interface CodexSkillAvailabilityItem {
  key: string;
  name: string;
  description: string;
  shortDescription?: string;
  scope: CodexSkillScope;
  origin: CodexSkillOrigin;
  globallyEnabled: boolean;
}

export interface CodexSkillRuntimeEntry {
  key: string;
  path: string;
  globallyEnabled: boolean;
}

type SkillLoader = (
  cwd: string,
  forceReload: boolean,
) => Promise<CodexSkillMetadata[]>;

const APP_SERVER_TIMEOUT_MS = 10_000;

export function buildCodexSkillKey(
  skill: Pick<CodexSkillMetadata, "scope" | "name">,
): string {
  return `${skill.scope}:${skill.name}`;
}

export function resolveCodexSkillOrigin(path: string): CodexSkillOrigin {
  const normalizedPath = path.replaceAll("\\", "/");
  if (normalizedPath.includes("/skills/.system/")) return "official";
  if (
    /\/plugins\/cache\/openai-(bundled|primary-runtime|curated-remote)\//.test(
      normalizedPath,
    )
  ) {
    return "official";
  }
  return "custom";
}

function createJsonLineReader(stream: ReadableStream<Uint8Array>): {
  next: () => Promise<JsonRpcMessage | null>;
  cancel: () => Promise<void>;
} {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const queue: JsonRpcMessage[] = [];
  let buffer = "";

  const parseBufferedLines = (): void => {
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        queue.push(JSON.parse(line) as JsonRpcMessage);
      } catch {
        // App Server stdout 理論上只會輸出 JSONL；非 JSON 訊息不應阻斷後續回應。
      }
    }
  };

  return {
    async next(): Promise<JsonRpcMessage | null> {
      while (queue.length === 0) {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer.trim()) {
            try {
              queue.push(JSON.parse(buffer) as JsonRpcMessage);
            } catch {
              return null;
            }
            buffer = "";
          }
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        parseBufferedLines();
      }
      return queue.shift() ?? null;
    },
    async cancel(): Promise<void> {
      await reader.cancel();
    },
  };
}

async function waitForResponse(
  next: () => Promise<JsonRpcMessage | null>,
  requestId: number,
): Promise<unknown> {
  while (true) {
    const message = await next();
    if (!message) {
      throw new Error("Codex App Server 已在回應前結束");
    }
    if (message.id !== requestId) continue;
    if (message.error !== undefined) {
      throw new Error("Codex App Server 回傳錯誤");
    }
    return message.result;
  }
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("載入 Codex Skills 逾時")),
      APP_SERVER_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function loadSkillsWithAppServer(
  cwd: string,
  forceReload: boolean,
): Promise<CodexSkillMetadata[]> {
  const proc = Bun.spawn(["codex", "app-server", "--stdio"], {
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const stdout = createJsonLineReader(
    proc.stdout as ReadableStream<Uint8Array>,
  );
  const stderrPromise = new Response(proc.stderr).text();

  const send = async (message: unknown): Promise<void> => {
    proc.stdin.write(`${JSON.stringify(message)}\n`);
    await proc.stdin.flush();
  };

  try {
    await send({
      method: "initialize",
      id: 1,
      params: {
        clientInfo: {
          name: "agent-canvas",
          title: "Agent Canvas",
          version: "1",
        },
        capabilities: null,
      },
    });
    await withTimeout(waitForResponse(stdout.next, 1));
    await send({ method: "initialized" });
    await send({
      method: "skills/list",
      id: 2,
      params: { cwds: [cwd], forceReload },
    });

    const result = (await withTimeout(
      waitForResponse(stdout.next, 2),
    )) as SkillsListResult;
    return result.data?.find((entry) => entry.cwd === cwd)?.skills ?? [];
  } finally {
    try {
      proc.kill();
    } catch {
      // 子程序可能已自行結束，不需要再回報錯誤。
    }
    await stdout.cancel().catch(() => undefined);
    const stderr = await stderrPromise.catch(() => "");
    if (stderr.trim()) {
      logger.warn("Chat", "Warn", "Codex App Server 載入 Skills 時有診斷輸出");
    }
  }
}

export class CodexSkillService {
  constructor(private readonly loadSkills: SkillLoader = loadSkillsWithAppServer) {}

  async list(
    cwd: string,
    forceReload = false,
  ): Promise<{
    items: CodexSkillAvailabilityItem[];
    runtimeEntries: CodexSkillRuntimeEntry[];
  }> {
    const skills = await this.loadSkills(cwd, forceReload);
    const seen = new Set<string>();
    const items: CodexSkillAvailabilityItem[] = [];
    const runtimeEntries: CodexSkillRuntimeEntry[] = [];

    for (const skill of skills) {
      const key = buildCodexSkillKey(skill);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        key,
        name: skill.name,
        description: skill.description,
        ...(skill.shortDescription
          ? { shortDescription: skill.shortDescription }
          : {}),
        scope: skill.scope,
        origin: resolveCodexSkillOrigin(skill.path),
        globallyEnabled: skill.enabled,
      });
      runtimeEntries.push({
        key,
        path: skill.path,
        globallyEnabled: skill.enabled,
      });
    }

    return { items, runtimeEntries };
  }

  resolveSelectedKeys(
    currentKeys: readonly string[],
    initialized: boolean,
    entries: readonly CodexSkillRuntimeEntry[],
  ): string[] {
    if (!initialized) {
      return [];
    }
    const selectableKeys = new Set(
      entries
        .filter((entry) => entry.globallyEnabled)
        .map((entry) => entry.key),
    );
    return [...new Set(currentKeys)].filter((key) => selectableKeys.has(key));
  }

  buildRuntimeConfigArgs(
    selectedKeys: readonly string[],
    entries: readonly CodexSkillRuntimeEntry[],
  ): string[] {
    if (entries.length === 0) return [];
    const selected = new Set(selectedKeys);
    const config = entries.map(
      (entry) =>
        `{path=${JSON.stringify(entry.path)},enabled=${
          entry.globallyEnabled && selected.has(entry.key)
        }}`,
    );
    return ["-c", `skills.config=[${config.join(",")}]`];
  }
}

export const codexSkillService = new CodexSkillService();
