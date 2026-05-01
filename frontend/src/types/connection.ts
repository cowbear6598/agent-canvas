import type { ModelType, PodProvider } from "@/types/pod";

export type AnchorPosition = "top" | "bottom" | "left" | "right";

export type TriggerMode = "auto" | "ai-decide" | "direct";

export type WorkflowRole = "head" | "tail" | "middle" | "independent";

export type ConnectionStatus =
  | "idle"
  | "active"
  | "queued"
  | "waiting"
  | "ai-deciding"
  | "ai-approved"
  | "ai-rejected"
  | "ai-error";

export interface Connection {
  id: string;
  sourcePodId?: string;
  sourceAnchor: AnchorPosition;
  targetPodId: string;
  targetAnchor: AnchorPosition;
  status?: ConnectionStatus;
  triggerMode: TriggerMode;
  decideReason?: string;
  /** summaryModel 接受任意 provider 的模型名稱字串，不限於 Claude ModelType */
  summaryModel?: string;
  /**
   * Summary 功能獨立選用的 Provider。
   * 升級前 Connection 為 null/undefined，UI 渲染時會 fallback 至來源 Pod provider。
   */
  summaryProvider?: PodProvider | null;
  aiDecideModel?: ModelType;
}

export interface DraggingConnection {
  sourcePodId?: string;
  sourceAnchor: AnchorPosition;
  startPoint: { x: number; y: number };
  currentPoint: { x: number; y: number };
}

export interface AnchorPoint {
  podId: string;
  anchor: AnchorPosition;
  x: number;
  y: number;
}
