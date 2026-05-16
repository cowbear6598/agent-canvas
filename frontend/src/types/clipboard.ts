import type { PodProvider, ProviderConfig, PodGoal } from "./pod";
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
  mcpServerNames?: string[];
  pluginIds?: string[];
  repositoryId?: string | null;
  goal?: PodGoal | null;
}

export interface CopiedRepositoryNote {
  repositoryId: string;
  name: string;
  x: number;
  y: number;
  boundToOriginalPodId: string | null;
  originalPosition: { x: number; y: number } | null;
}

export interface CopiedConnection {
  sourcePodId: string;
  sourceAnchor: AnchorPosition;
  targetPodId: string;
  targetAnchor: AnchorPosition;
  triggerMode?: TriggerMode;
  /** Branch 模式下的連線標籤 */
  label?: string;
  /** Branch 模式下的連線描述 */
  description?: string;
  /** Branch 模式使用的 AI Provider */
  branchProvider?: PodProvider;
  /** Branch 模式使用的模型字串 */
  branchModel?: string;
}
