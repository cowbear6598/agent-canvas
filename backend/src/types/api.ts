import { Pod } from "./pod.js";
import type { ProviderName } from "../services/provider/types.js";

export interface CreatePodRequest {
  name: string;
  x: number;
  y: number;
  rotation: number;
  skillIds?: string[];
  subAgentIds?: string[];
  mcpServerIds?: string[];
  pluginIds?: string[];
  provider?: ProviderName;
  providerConfig?: Record<string, unknown>;
  repositoryId?: string | null;
  commandId?: string | null;
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
