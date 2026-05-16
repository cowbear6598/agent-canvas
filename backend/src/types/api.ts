import { Pod, type PodGoal } from "./pod.js";
import type { ProviderName } from "../services/provider/types.js";

export interface CreatePodRequest {
  name: string;
  x: number;
  y: number;
  rotation: number;
  mcpServerNames?: string[];
  pluginIds?: string[];
  provider?: ProviderName;
  providerConfig?: Record<string, unknown>;
  repositoryId?: string | null;
  goal?: PodGoal | null;
}

export interface CreatePodResponse {
  pod: Pod;
}

export interface ChatRequest {
  message: string;
}

export interface ChatResponse {
  messageId: string;
}

export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}
