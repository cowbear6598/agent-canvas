/** 各 provider 共用的 thinking level 型別 alias，供 pod 設定與型別引用 */
export type ThinkingLevel = "low" | "medium" | "high" | "xhigh" | "max";

type ModelThinkingConfig = Readonly<{
  levels: readonly ThinkingLevel[];
  default: ThinkingLevel | null;
}>;

type ModelMetadata = Readonly<{
  label: string;
  thinking: ModelThinkingConfig;
}>;

const FIVE_THINKING_LEVELS = Object.freeze([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly ThinkingLevel[]);

const FOUR_THINKING_LEVELS = Object.freeze([
  "low",
  "medium",
  "high",
  "xhigh",
] as const satisfies readonly ThinkingLevel[]);

const CLAUDE_OPUS_THINKING = Object.freeze({
  levels: FIVE_THINKING_LEVELS,
  default: "high",
} as const satisfies ModelThinkingConfig);

const CLAUDE_SONNET_THINKING = Object.freeze({
  levels: Object.freeze([
    "low",
    "medium",
    "high",
    "max",
  ] as const satisfies readonly ThinkingLevel[]),
  default: "high",
} as const satisfies ModelThinkingConfig);

const NO_THINKING = Object.freeze({
  levels: Object.freeze([] as const satisfies readonly ThinkingLevel[]),
  default: null,
} as const satisfies ModelThinkingConfig);

const CODEX_STANDARD_THINKING = Object.freeze({
  levels: FOUR_THINKING_LEVELS,
  default: "medium",
} as const satisfies ModelThinkingConfig);

const CODEX_5_6_THINKING = Object.freeze({
  levels: FIVE_THINKING_LEVELS,
  default: "medium",
} as const satisfies ModelThinkingConfig);

const CLAUDE_MODEL_METADATA = Object.freeze({
  sonnet: Object.freeze({ label: "Sonnet", thinking: CLAUDE_SONNET_THINKING }),
  opus: Object.freeze({ label: "Opus", thinking: CLAUDE_OPUS_THINKING }),
  haiku: Object.freeze({ label: "Haiku", thinking: NO_THINKING }),
  "claude-fable-5": Object.freeze({
    label: "Fable 5",
    thinking: CLAUDE_OPUS_THINKING,
  }),
} as const satisfies Record<string, ModelMetadata>);

const CODEX_MODEL_METADATA = Object.freeze({
  "gpt-5.5": Object.freeze({
    label: "GPT-5.5",
    thinking: CODEX_STANDARD_THINKING,
  }),
  "gpt-5.6-sol": Object.freeze({
    label: "GPT-5.6 Sol",
    thinking: CODEX_5_6_THINKING,
  }),
  "gpt-5.6-terra": Object.freeze({
    label: "GPT-5.6 Terra",
    thinking: CODEX_5_6_THINKING,
  }),
  "gpt-5.6-luna": Object.freeze({
    label: "GPT-5.6 Luna",
    thinking: CODEX_5_6_THINKING,
  }),
} as const satisfies Record<string, ModelMetadata>);

function createAvailableModels<T extends Record<string, ModelMetadata>>(
  metadata: T,
): ReadonlyArray<Readonly<{ label: string; value: keyof T & string }>> {
  return Object.freeze(
    Object.entries(metadata).map(([value, config]) =>
      Object.freeze({ label: config.label, value: value as keyof T & string }),
    ),
  );
}

function createThinkingLevelTable<T extends Record<string, ModelMetadata>>(
  metadata: T,
): Readonly<Record<keyof T & string, ModelThinkingConfig>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(metadata).map(([model, config]) => [model, config.thinking]),
    ),
  ) as Readonly<Record<keyof T & string, ModelThinkingConfig>>;
}

/** Claude Provider 支援的模型清單，供前端選擇器動態渲染 */
export const CLAUDE_AVAILABLE_MODELS = createAvailableModels(
  CLAUDE_MODEL_METADATA,
);

/** Claude 合法 model value 的 Set，供 podStore 驗證 */
export const CLAUDE_AVAILABLE_MODEL_VALUES: ReadonlySet<string> = new Set(
  CLAUDE_AVAILABLE_MODELS.map((model) => model.value),
);

/** Claude 各模型支援的 thinking levels 與預設值 */
export const CLAUDE_MODEL_THINKING_LEVELS = createThinkingLevelTable(
  CLAUDE_MODEL_METADATA,
);

/** Codex Provider 支援的模型清單，供前端選擇器動態渲染 */
export const CODEX_AVAILABLE_MODELS = createAvailableModels(CODEX_MODEL_METADATA);

/** Codex 合法 model value 的 Set，供 podStore 驗證 */
export const CODEX_AVAILABLE_MODEL_VALUES: ReadonlySet<string> = new Set(
  CODEX_AVAILABLE_MODELS.map((model) => model.value),
);

/** Codex 各模型支援的 thinking levels 與預設值 */
export const CODEX_MODEL_THINKING_LEVELS = createThinkingLevelTable(
  CODEX_MODEL_METADATA,
);
