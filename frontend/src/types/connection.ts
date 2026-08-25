import type { PodProvider } from "@/types/pod";

export type AnchorPosition = "top" | "bottom" | "left" | "right";
export type ConnectionRoutingMode = "bezier" | "orthogonal";
export type OrthogonalRoutingControlRole =
  | "source-leg"
  | "lane"
  | "target-leg";
export interface ConnectionRoutingPoint {
  x: number;
  y: number;
  /** 直角模式下控制 ㄇ 形的哪一段；Bezier 與舊資料可省略。 */
  orthogonalRole?: OrthogonalRoutingControlRole;
}
export const MAX_CONNECTION_ROUTING_POINTS = 3;

/** Connection 資料契約的基底模式，只保留 Auto / Branch。 */
export type ConnectionBaseMode = "auto" | "branch";

/** 相容現有畫布顯示流程，direct 在 P2 前仍可能以顯示模式出現。 */
export type TriggerMode = ConnectionBaseMode | "direct";

export type WorkflowRole = "head" | "tail" | "middle" | "independent";

export interface Connection {
  id: string;
  sourcePodId?: string;
  sourceAnchor: AnchorPosition;
  targetPodId: string;
  targetAnchor: AnchorPosition;
  routingMode?: ConnectionRoutingMode;
  /** 舊版單一控制點相對於預設通道的位移量（canvas 座標）。 */
  routingOffset?: number;
  /** 可調整的連線控制點；直角模式對應 ㄇ 形三段，最多三個。 */
  routingPoints?: ConnectionRoutingPoint[];
  triggerMode: ConnectionBaseMode;
  /** Direct toggle 狀態；true 代表保留原基底模式但啟用 no-wait 行為。 */
  direct: boolean;
  /** summaryModel 接受任意 provider 的模型名稱字串，不限於 Claude ModelType */
  summaryModel?: string;
  /**
   * Summary 功能獨立選用的 Provider。
   * 升級後前端會將舊資料收斂為具體 provider，不再 fallback 至來源 Pod provider。
   */
  summaryProvider?: PodProvider | null;
  summaryThinkingLevel?: string | null;
  /** Branch 模式下的連線標籤，最多 32 字元，不可為保留字 "None" */
  label?: string;
  /** Branch 模式下的連線描述，最多 200 字元 */
  description?: string;
  branchProvider?: PodProvider | null;
  branchModel?: string | null;
  branchThinkingLevel?: string | null;
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
