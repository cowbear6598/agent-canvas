import type { ModelType } from "./pod";

export interface GlobalConfig {
  summaryModel: ModelType;
  aiDecideModel: ModelType;
  timezoneOffset: number;
  backupGitRemoteUrl: string;
  backupTime: string;
  backupEnabled: boolean;
}

export const MODEL_OPTIONS: { value: ModelType; label: string }[] = [
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
];

export const TIMEZONE_OPTIONS: { value: number; label: string }[] = [
  { value: -12, label: "UTC-12" },
  { value: -11, label: "UTC-11" },
  { value: -10, label: "UTC-10" },
  { value: -9, label: "UTC-9" },
  { value: -8, label: "UTC-8" },
  { value: -7, label: "UTC-7" },
  { value: -6, label: "UTC-6" },
  { value: -5, label: "UTC-5" },
  { value: -4, label: "UTC-4" },
  { value: -3, label: "UTC-3" },
  { value: -2, label: "UTC-2" },
  { value: -1, label: "UTC-1" },
  { value: 0, label: "UTC" },
  { value: 1, label: "UTC+1" },
  { value: 2, label: "UTC+2" },
  { value: 3, label: "UTC+3" },
  { value: 4, label: "UTC+4" },
  { value: 5, label: "UTC+5" },
  { value: 6, label: "UTC+6" },
  { value: 7, label: "UTC+7" },
  { value: 8, label: "UTC+8" },
  { value: 9, label: "UTC+9" },
  { value: 10, label: "UTC+10" },
  { value: 11, label: "UTC+11" },
  { value: 12, label: "UTC+12" },
  { value: 13, label: "UTC+13" },
  { value: 14, label: "UTC+14" },
];
