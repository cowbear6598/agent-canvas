import type { Pod } from '@/types'
import { validatePodName } from '@/lib/sanitize'

function hasValidIdentity(pod: Pod): boolean {
  return validatePodName(pod.name) && pod.id.trim() !== ''
}

function hasValidPosition(pod: Pod): boolean {
  return isFinite(pod.x) && isFinite(pod.y) && isFinite(pod.rotation)
}

function hasValidOutput(pod: Pod): boolean {
  return Array.isArray(pod.output) && pod.output.every(item => typeof item === 'string')
}

export function isValidPod(pod: Pod): boolean {
  return hasValidIdentity(pod) && hasValidPosition(pod) && hasValidOutput(pod)
}

/**
 * 補全 Pod 缺少的欄位
 * @param pod Pod 物件
 * @param existingOutput 現有的 output（用於保留）
 * @returns 補全後的 Pod
 */
export function enrichPod(pod: Pod, existingOutput?: string[]): Pod {
  return {
    ...pod,
    x: pod.x ?? 100,
    y: pod.y ?? 150,
    rotation: pod.rotation ?? (Math.random() * 2 - 1),
    output: Array.isArray(existingOutput) ? existingOutput : (Array.isArray(pod.output) ? pod.output : []),
    outputStyleId: pod.outputStyleId ?? null,
    model: pod.model ?? 'opus',
    autoClear: pod.autoClear ?? false,
    commandId: pod.commandId ?? null,
    schedule: pod.schedule ?? null,
  }
}
