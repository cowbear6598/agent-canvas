import type { PodProvider } from "@/types/pod";

export type AnchorPosition = "top" | "bottom" | "left" | "right";

export type TriggerMode = "auto" | "branch" | "direct";

export type WorkflowRole = "head" | "tail" | "middle" | "independent";

export type ConnectionStatus = "idle" | "active" | "queued" | "waiting";

export type DecideStatus =
  | "none"
  | "pending"
  | "approved"
  | "rejected"
  | "error";

export interface Connection {
  id: string;
  sourcePodId?: string;
  sourceAnchor: AnchorPosition;
  targetPodId: string;
  targetAnchor: AnchorPosition;
  status?: ConnectionStatus;
  decideStatus: DecideStatus;
  triggerMode: TriggerMode;
  decideReason?: string;
  /** summaryModel 接受任意 provider 的模型名稱字串，不限於 Claude ModelType */
  summaryModel?: string;
  /**
   * Summary 功能獨立選用的 Provider。
   * 升級後前端會將舊資料收斂為具體 provider，不再 fallback 至來源 Pod provider。
   */
  summaryProvider?: PodProvider | null;
  /** Branch 模式下的連線標籤，最多 32 字元，不可為保留字 "None" */
  label?: string;
  /** Branch 模式下的連線描述，最多 200 字元 */
  description?: string;
  /** Branch 模式使用的 AI Provider */
  branchProvider?: PodProvider;
  /** Branch 模式使用的模型字串 */
  branchModel?: string;
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

/** Branch 連線 label 最大字元數 */
export const BRANCH_LABEL_MAX_LENGTH = 32;

/** Branch 連線 description 最大字元數 */
export const BRANCH_DESCRIPTION_MAX_LENGTH = 200;

/** Branch label 保留字，store 驗證時禁止使用 */
export const BRANCH_RESERVED_LABEL = "None";
