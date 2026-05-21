import type {
  AgentProvider,
  ChatRequestContext,
  NormalizedEvent,
  ProviderMetadata,
  ProviderName,
} from "../../src/services/provider/types.js";

export type ProviderFakeScenario =
  | "success"
  | "stream"
  | "error"
  | "cancelled";

export interface ProviderFakeHarnessOptions {
  provider: ProviderName;
  scenario?: ProviderFakeScenario;
  sessionId?: string;
  chunks?: string[];
  errorMessage?: string;
  fatal?: boolean;
  delayMs?: number;
}

export interface ProviderFakeHarness {
  provider: AgentProvider<Record<string, unknown>>;
  calls: ChatRequestContext<Record<string, unknown>>[];
  collect(
    ctx?: Partial<ChatRequestContext<Record<string, unknown>>>,
  ): Promise<NormalizedEvent[]>;
  abortController: AbortController;
}

const DEFAULT_MODEL_BY_PROVIDER: Record<ProviderName, string> = {
  claude: "sonnet",
  codex: "gpt-5.4",
  opencode: "anthropic/claude-sonnet-4-5",
};

function createProviderMetadata(
  provider: ProviderName,
): ProviderMetadata<Record<string, unknown>> {
  const model = DEFAULT_MODEL_BY_PROVIDER[provider];
  return {
    name: provider,
    defaultOptions: { model },
    availableModels: [{ label: model, value: model }],
    availableModelValues: new Set([model]),
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDefaultContext(
  abortSignal: AbortSignal,
  overrides: Partial<ChatRequestContext<Record<string, unknown>>> = {},
): ChatRequestContext<Record<string, unknown>> {
  return {
    podId: "pod-provider-fake",
    podName: "Provider Fake",
    message: "hello",
    workspacePath: "/tmp/provider-fake-workspace",
    resumeSessionId: null,
    abortSignal,
    options: {},
    ...overrides,
  };
}

async function* emitProviderScenario(
  options: Required<
    Pick<
      ProviderFakeHarnessOptions,
      "provider" | "scenario" | "sessionId" | "chunks" | "errorMessage"
    >
  > &
    Pick<ProviderFakeHarnessOptions, "fatal" | "delayMs">,
  ctx: ChatRequestContext<Record<string, unknown>>,
): AsyncIterable<NormalizedEvent> {
  const delayMs = options.delayMs ?? 0;
  const ensureNotCancelled = (): boolean => !ctx.abortSignal.aborted;

  if (options.scenario === "cancelled") {
    yield {
      type: "error",
      message: "Provider request cancelled",
      fatal: false,
      code: "PROVIDER_CANCELLED",
      systemMessage: {
        role: "system",
        content: "Provider request cancelled",
        metadata: {
          provider: options.provider,
          code: "PROVIDER_CANCELLED",
          severity: "error",
          rawContent: "Provider request cancelled",
        },
      },
    };
    return;
  }

  yield { type: "session_started", sessionId: options.sessionId };

  if (options.scenario === "error") {
    yield {
      type: "error",
      message: options.errorMessage,
      fatal: options.fatal ?? true,
      code: "PROVIDER_FAKE_ERROR",
      systemMessage: {
        role: "system",
        content: options.errorMessage,
        metadata: {
          provider: options.provider,
          code: "PROVIDER_FAKE_ERROR",
          severity: options.fatal === false ? "error" : "fatal",
          rawContent: options.errorMessage,
        },
      },
    };
    return;
  }

  const chunks =
    options.scenario === "stream" ? options.chunks : [options.chunks.join("")];

  for (const chunk of chunks) {
    if (!ensureNotCancelled()) {
      yield {
        type: "error",
        message: "Provider request cancelled",
        fatal: false,
        code: "PROVIDER_CANCELLED",
      };
      return;
    }
    if (delayMs > 0) await wait(delayMs);
    yield { type: "text", content: chunk };
  }

  yield { type: "turn_complete" };
}

export function createProviderFakeHarness(
  options: ProviderFakeHarnessOptions,
): ProviderFakeHarness {
  const scenario = options.scenario ?? "success";
  const sessionId = options.sessionId ?? `${options.provider}-fake-session`;
  const chunks = options.chunks ?? ["fake response"];
  const errorMessage =
    options.errorMessage ?? `${options.provider} fake provider failed`;
  const calls: ChatRequestContext<Record<string, unknown>>[] = [];
  const abortController = new AbortController();

  const provider: AgentProvider<Record<string, unknown>> = {
    metadata: createProviderMetadata(options.provider),
    async buildOptions() {
      return { model: DEFAULT_MODEL_BY_PROVIDER[options.provider] };
    },
    async *chat(ctx) {
      calls.push(ctx);
      yield* emitProviderScenario(
        {
          provider: options.provider,
          scenario,
          sessionId,
          chunks,
          errorMessage,
          fatal: options.fatal,
          delayMs: options.delayMs,
        },
        ctx,
      );
    },
  };

  return {
    provider,
    calls,
    abortController,
    collect: async (ctxOverrides = {}) =>
      collectProviderEvents(
        provider.chat(
          createDefaultContext(abortController.signal, ctxOverrides),
        ),
      ),
  };
}

export async function collectProviderEvents(
  events: AsyncIterable<NormalizedEvent>,
): Promise<NormalizedEvent[]> {
  const collected: NormalizedEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

export function createFakeProviderSet(
  scenarioByProvider: Partial<Record<ProviderName, ProviderFakeScenario>> = {},
): Record<ProviderName, ProviderFakeHarness> {
  return {
    claude: createProviderFakeHarness({
      provider: "claude",
      scenario: scenarioByProvider.claude ?? "success",
    }),
    codex: createProviderFakeHarness({
      provider: "codex",
      scenario: scenarioByProvider.codex ?? "success",
    }),
    opencode: createProviderFakeHarness({
      provider: "opencode",
      scenario: scenarioByProvider.opencode ?? "success",
    }),
  };
}

export interface FakeSubprocess {
  stdin: {
    writes: string[];
    write(text: string): void;
    end(): Promise<void>;
  };
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(signal?: string): void;
  killed: boolean;
  killSignal?: string;
}

function linesToReadableStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const payload = lines.length > 0 ? `${lines.join("\n")}\n` : "";
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (payload.length > 0) {
        controller.enqueue(encoder.encode(payload));
      }
      controller.close();
    },
  });
}

export function createFakeSubprocess(options: {
  stdoutLines?: string[];
  stderrLines?: string[];
  exitCode?: number;
}): FakeSubprocess {
  const proc: FakeSubprocess = {
    stdin: {
      writes: [],
      write(text: string) {
        this.writes.push(text);
      },
      async end() {},
    },
    stdout: linesToReadableStream(options.stdoutLines ?? []),
    stderr: linesToReadableStream(options.stderrLines ?? []),
    exited: Promise.resolve(options.exitCode ?? 0),
    killed: false,
    kill(signal?: string) {
      this.killed = true;
      this.killSignal = signal;
    },
  };

  return proc;
}
