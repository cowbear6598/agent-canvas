export function isAutoTriggerable(triggerMode: string | undefined): boolean {
    return triggerMode === 'auto' || triggerMode === 'ai-decide'
}
