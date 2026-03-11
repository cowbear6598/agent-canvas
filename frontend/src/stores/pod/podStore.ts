import {defineStore} from 'pinia'
import type {ModelType, Pod, PodStatus, Position, Schedule, TypeMenuState} from '@/types'
import {initialPods} from '@/data/initialPods'
import {generateRequestId} from '@/services/utils'
import {
    createWebSocketRequest,
    websocketClient,
    WebSocketRequestEvents,
    WebSocketResponseEvents
} from '@/services/websocket'
import type {
    PodAutoClearSetPayload,
    PodCreatedPayload,
    PodCreatePayload,
    PodDeletedPayload,
    PodDeletePayload,
    PodListPayload,
    PodListResultPayload,
    PodMovePayload,
    PodRenamedPayload,
    PodRenamePayload,
    PodScheduleSetPayload,
    PodSetAutoClearPayload,
    PodSetSchedulePayload
} from '@/types/websocket'
import {useConnectionStore} from '@/stores/connectionStore'
import {useToast} from '@/composables/useToast'
import {useCanvasWebSocketAction} from '@/composables/useCanvasWebSocketAction'
import {isValidPod as isValidPodFn, enrichPod as enrichPodFn} from '@/lib/podValidation'
import {getActiveCanvasIdOrWarn} from '@/utils/canvasGuard'

const MAX_COORD = 100000

/** 防止滑鼠 mouseup 事件在關閉選單後立即觸發 click 而重新打開選單 */
const TYPE_MENU_COOLDOWN_MS = 300

const POD_FALLBACK_INITIAL_X = 100
const POD_FALLBACK_X_SPACING = 300
const POD_FALLBACK_INITIAL_Y = 150
const POD_FALLBACK_Y_STAGGER = 100

interface PodStoreState {
    pods: Pod[]
    selectedPodId: string | null
    activePodId: string | null
    typeMenu: TypeMenuState
    typeMenuClosedAt: number
    scheduleFiredPodIds: Set<string>
}

export const usePodStore = defineStore('pod', {
    state: (): PodStoreState => ({
        pods: initialPods,
        selectedPodId: null,
        activePodId: null,
        typeMenu: {
            visible: false,
            position: null,
        },
        typeMenuClosedAt: 0,
        scheduleFiredPodIds: new Set(),
    }),

    getters: {
        selectedPod: (state): Pod | null =>
            state.pods.find((pod) => pod.id === state.selectedPodId) || null,

        podCount: (state): number => state.pods.length,

        getPodById: (state) => (id: string): Pod | undefined => {
            return state.pods.find((pod) => pod.id === id)
        },

        getNextPodName: (state) => (): string => {
            const existingNames = new Set(state.pods.map(pod => pod.name))
            let i = 1
            while (existingNames.has(`Pod ${i}`)) {
                i++
            }
            return `Pod ${i}`
        },

        isScheduleFiredAnimating: (state) => (podId: string): boolean => {
            return state.scheduleFiredPodIds.has(podId)
        },
    },

    actions: {
        findPodById(podId: string): Pod | undefined {
            return this.pods.find((pod) => pod.id === podId)
        },

        enrichPod(pod: Pod, existingOutput?: string[]): Pod {
            return enrichPodFn(pod, existingOutput)
        },

        isValidPod(pod: Pod): boolean {
            return isValidPodFn(pod)
        },

        addPod(pod: Pod): void {
            if (this.isValidPod(pod)) {
                this.pods.push(pod)
            }
        },

        updatePod(pod: Pod): void {
            const index = this.pods.findIndex((existingPod) => existingPod.id === pod.id)
            if (index === -1) return

            const existing = this.pods[index]
            const mergedPod = {
                ...pod,
                output: pod.output !== undefined ? pod.output : (existing?.output ?? []),
            }

            if (!this.isValidPod(mergedPod)) {
                console.warn('[PodStore] updatePod 驗證失敗，已忽略更新', { podId: pod.id })
                return
            }
            this.pods.splice(index, 1, mergedPod)
        },

        async createPodWithBackend(pod: Omit<Pod, 'id'>): Promise<Pod | null> {
            const { executeAction } = useCanvasWebSocketAction()
            const { showSuccessToast, showErrorToast } = useToast()

            const result = await executeAction<PodCreatePayload, PodCreatedPayload>(
                {
                    requestEvent: WebSocketRequestEvents.POD_CREATE,
                    responseEvent: WebSocketResponseEvents.POD_CREATED,
                    payload: {
                        name: pod.name,
                        x: pod.x,
                        y: pod.y,
                        rotation: pod.rotation
                    }
                },
                { errorCategory: 'Pod', errorAction: '建立失敗', errorMessage: 'Pod 建立失敗' }
            )

            if (!result.success) return null

            if (!result.data.pod) {
                const errorMessage = 'Pod 建立失敗：後端未回傳 Pod 資料'
                showErrorToast('Pod', '建立失敗', errorMessage)
                return null
            }

            showSuccessToast('Pod', '建立成功', pod.name)

            return {
                ...result.data.pod,
                x: pod.x,
                y: pod.y,
                rotation: pod.rotation,
                output: pod.output ?? [],
            }
        },

        async deletePodWithBackend(id: string): Promise<void> {
            const { executeAction } = useCanvasWebSocketAction()
            const { showSuccessToast } = useToast()

            const pod = this.findPodById(id)
            const podName = pod?.name ?? 'Pod'

            const result = await executeAction<PodDeletePayload, PodDeletedPayload>(
                {
                    requestEvent: WebSocketRequestEvents.POD_DELETE,
                    responseEvent: WebSocketResponseEvents.POD_DELETED,
                    payload: { podId: id }
                },
                { errorCategory: 'Pod', errorAction: '刪除失敗', errorMessage: 'Pod 刪除失敗' }
            )

            if (!result.success) return

            showSuccessToast('Pod', '刪除成功', podName)
        },

        syncPodsFromBackend(pods: Pod[]): void {
            const enrichedPods = pods.map((pod, index) => {
                const enriched = this.enrichPod(pod)
                return {
                    ...enriched,
                    x: pod.x ?? POD_FALLBACK_INITIAL_X + (index * POD_FALLBACK_X_SPACING),
                    y: pod.y ?? POD_FALLBACK_INITIAL_Y + (index % 2) * POD_FALLBACK_Y_STAGGER,
                }
            })
            this.pods = enrichedPods.filter(pod => this.isValidPod(pod))
        },

        async loadPodsFromBackend(): Promise<void> {
            const canvasId = getActiveCanvasIdOrWarn('PodStore')
            if (!canvasId) return

            const response = await createWebSocketRequest<PodListPayload, PodListResultPayload>({
                requestEvent: WebSocketRequestEvents.POD_LIST,
                responseEvent: WebSocketResponseEvents.POD_LIST_RESULT,
                payload: {
                    canvasId
                }
            })

            if (response.pods) {
                this.syncPodsFromBackend(response.pods)
            }
        },

        updatePodStatus(id: string, status: PodStatus): void {
            const pod = this.findPodById(id)
            if (pod) {
                pod.status = status
            }
        },

        movePod(id: string, x: number, y: number): void {
            const pod = this.findPodById(id)
            if (!pod) return

            const safeX = Number.isFinite(x) ? Math.max(-MAX_COORD, Math.min(MAX_COORD, x)) : pod.x
            const safeY = Number.isFinite(y) ? Math.max(-MAX_COORD, Math.min(MAX_COORD, y)) : pod.y

            pod.x = safeX
            pod.y = safeY
        },

        syncPodPosition(id: string): void {
            const pod = this.findPodById(id)
            if (!pod) return

            const canvasId = getActiveCanvasIdOrWarn('PodStore')
            if (!canvasId) return

            websocketClient.emit<PodMovePayload>(WebSocketRequestEvents.POD_MOVE, {
                requestId: generateRequestId(),
                canvasId,
                podId: id,
                x: pod.x,
                y: pod.y
            })
        },

        async renamePodWithBackend(podId: string, name: string): Promise<boolean> {
            const { executeAction } = useCanvasWebSocketAction()
            const { showSuccessToast } = useToast()

            const result = await executeAction<PodRenamePayload, PodRenamedPayload>(
                {
                    requestEvent: WebSocketRequestEvents.POD_RENAME,
                    responseEvent: WebSocketResponseEvents.POD_RENAMED,
                    payload: { podId, name }
                },
                { errorCategory: 'Pod', errorAction: '重新命名失敗', errorMessage: 'Pod 重新命名失敗' }
            )

            if (!result.success) return false

            showSuccessToast('Pod', '重新命名成功', name)
            return true
        },

        async setScheduleWithBackend(podId: string, schedule: Schedule | null): Promise<Pod | null> {
            const { executeAction } = useCanvasWebSocketAction()
            const { showSuccessToast } = useToast()

            const result = await executeAction<PodSetSchedulePayload, PodScheduleSetPayload>(
                {
                    requestEvent: WebSocketRequestEvents.POD_SET_SCHEDULE,
                    responseEvent: WebSocketResponseEvents.POD_SCHEDULE_SET,
                    payload: { podId, schedule }
                },
                { errorCategory: 'Schedule', errorAction: '設定失敗', errorMessage: 'Schedule 設定失敗' }
            )

            if (!result.success || !result.data.success || !result.data.pod) return null

            const action = schedule === null ? '清除成功' : '更新成功'
            showSuccessToast('Schedule', action)
            return result.data.pod
        },

        selectPod(podId: string | null): void {
            this.selectedPodId = podId
        },

        setActivePod(podId: string | null): void {
            this.activePodId = podId
        },

        showTypeMenu(position: Position): void {
            if (Date.now() - this.typeMenuClosedAt < TYPE_MENU_COOLDOWN_MS) return

            this.typeMenu = {
                visible: true,
                position,
            }
        },

        hideTypeMenu(): void {
            this.typeMenu = {
                visible: false,
                position: null,
            }
            this.typeMenuClosedAt = Date.now()
        },

        updatePodField<K extends keyof Pod>(podId: string, field: K, value: Pod[K]): void {
            const pod = this.findPodById(podId)
            if (!pod) return
            pod[field] = value
        },

        updatePodOutputStyle(podId: string, outputStyleId: string | null): void {
            this.updatePodField(podId, 'outputStyleId', outputStyleId)
        },

        clearPodOutputsByIds(podIds: string[]): void {
            for (const podId of podIds) {
                this.updatePodField(podId, 'output', [])
            }
        },

        updatePodModel(podId: string, model: ModelType): void {
            this.updatePodField(podId, 'model', model)
        },

        updatePodRepository(podId: string, repositoryId: string | null): void {
            this.updatePodField(podId, 'repositoryId', repositoryId)
        },

        updatePodCommand(podId: string, commandId: string | null): void {
            this.updatePodField(podId, 'commandId', commandId)
        },

        async setAutoClearWithBackend(podId: string, autoClear: boolean): Promise<Pod | null> {
            const { executeAction } = useCanvasWebSocketAction()
            const { showSuccessToast } = useToast()

            const result = await executeAction<PodSetAutoClearPayload, PodAutoClearSetPayload>(
                {
                    requestEvent: WebSocketRequestEvents.POD_SET_AUTO_CLEAR,
                    responseEvent: WebSocketResponseEvents.POD_AUTO_CLEAR_SET,
                    payload: { podId, autoClear }
                },
                { errorCategory: 'Pod', errorAction: '設定失敗', errorMessage: 'Pod 設定失敗' }
            )

            if (!result.success || !result.data.success || !result.data.pod) return null

            showSuccessToast('Pod', '設定成功')
            return result.data.pod
        },

        addPodFromEvent(pod: Pod): void {
            const enrichedPod = this.enrichPod(pod)

            if (!this.isValidPod(enrichedPod)) return

            this.pods.push(enrichedPod)
        },

        removePod(podId: string): void {
            this.pods = this.pods.filter((pod) => pod.id !== podId)

            if (this.selectedPodId === podId) {
                this.selectedPodId = null
            }

            if (this.activePodId === podId) {
                this.activePodId = null
            }

            const connectionStore = useConnectionStore()
            connectionStore.deleteConnectionsByPodId(podId)
        },

        updatePodPosition(podId: string, x: number, y: number): void {
            const pod = this.findPodById(podId)
            if (pod) {
                pod.x = x
                pod.y = y
            }
        },

        updatePodName(podId: string, name: string): void {
            this.updatePodField(podId, 'name', name)
        },

        triggerScheduleFiredAnimation(podId: string): void {
            this.scheduleFiredPodIds.delete(podId)
            this.scheduleFiredPodIds = new Set([...this.scheduleFiredPodIds, podId])
        },

        clearScheduleFiredAnimation(podId: string): void {
            this.scheduleFiredPodIds.delete(podId)
            this.scheduleFiredPodIds = new Set(this.scheduleFiredPodIds)
        },
    },
})
