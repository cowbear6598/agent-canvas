import type { PodProvider, ProviderConfig } from "./pod";
import type { AnchorPosition, TriggerMode } from "./connection";

export interface CopiedPod {
  id: string;
  name: string;
  x: number;
  y: number;
  rotation: number;
  /** Pod 使用的 AI Provider（複製時保留，貼上時還原） */
  provider: PodProvider;
  /** Provider 對應的設定（複製時保留，貼上時還原） */
  providerConfig: ProviderConfig;
  subAgentIds?: string[];
  repositoryId?: string | null;
  commandId?: string | null;
}

export interface CopiedRepositoryNote {
  repositoryId: string;
  name: string;
  x: number;
  y: number;
  boundToOriginalPodId: string | null;
  originalPosition: { x: number; y: number } | null;
}

export interface CopiedSubAgentNote {
  id: string;
  subAgentId: string;
  name: string;
  x: number;
  y: number;
  boundToPodId: string | null;
  originalPosition: { x: number; y: number } | null;
}

export interface CopiedCommandNote {
  commandId: string;
  name: string;
  x: number;
  y: number;
  boundToOriginalPodId: string | null;
  originalPosition: { x: number; y: number } | null;
}

export interface CopiedMcpServerNote {
  id: string;
  mcpServerId: string;
  name: string;
  x: number;
  y: number;
  boundToPodId: string | null;
  originalPosition: { x: number; y: number } | null;
}

export interface CopiedConnection {
  sourcePodId: string;
  sourceAnchor: AnchorPosition;
  targetPodId: string;
  targetAnchor: AnchorPosition;
  triggerMode?: TriggerMode;
}
