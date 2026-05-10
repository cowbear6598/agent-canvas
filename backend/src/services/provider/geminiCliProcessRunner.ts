import { buildGeminiEnv } from "../gemini/geminiHelpers.js";

export interface GeminiCliProcess {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(signal?: number | NodeJS.Signals): void;
}

const GEMINI_ENV = buildGeminiEnv();

export function spawnGeminiCliProcess(
  args: string[],
  cwd: string,
): GeminiCliProcess {
  const proc = Bun.spawn(["gemini", ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: GEMINI_ENV,
  });

  return {
    stdout: proc.stdout as ReadableStream<Uint8Array>,
    stderr: proc.stderr as ReadableStream<Uint8Array>,
    exited: proc.exited,
    kill(signal?: number | NodeJS.Signals): void {
      proc.kill(signal);
    },
  };
}
