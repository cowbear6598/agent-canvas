export type RunStatus = 'running' | 'completed' | 'error'

export type RunPodStatus = 'pending' | 'running' | 'summarizing' | 'completed' | 'error' | 'skipped'

export interface RunPodInstance {
  id: string
  runId: string
  podId: string
  podName: string
  status: RunPodStatus
  errorMessage?: string
  lastResponseSummary?: string
  triggeredAt?: string
  completedAt?: string
}

export interface WorkflowRun {
  id: string
  canvasId: string
  sourcePodId: string
  sourcePodName: string
  triggerMessage: string
  status: RunStatus
  podInstances: RunPodInstance[]
  createdAt: string
  completedAt?: string
}
