import {defineStore} from 'pinia'
import type {BaseNote, Pod, Group, BasePayload, BaseResponse} from '@/types'
import {createWebSocketRequest} from '@/services/websocket'
import {useWebSocketErrorHandler} from '@/composables/useWebSocketErrorHandler'
import {useDeleteItem} from '@/composables/useDeleteItem'
import {useToast} from '@/composables/useToast'
import {requireActiveCanvas, getActiveCanvasIdOrWarn} from '@/utils/canvasGuard'
import {createNoteBindingActions} from './noteBindingActions'
import {createNotePositionActions} from './notePositionActions'
import {createResourceCRUDActions} from './createResourceCRUDActions'
import type {CRUDEventsConfig, CRUDPayloadConfig} from './createResourceCRUDActions'
import type {ToastCategory} from '@/composables/useToast'

const STORE_TO_CATEGORY_MAP: Record<string, string> = {
    'skill': 'Skill',
    'repository': 'Repository',
    'subAgent': 'SubAgent',
    'command': 'Command',
    'outputStyle': 'OutputStyle',
    'mcpServer': 'McpServer'
}

function extractErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '未知錯誤'
}

function findItemById(items: unknown[], itemId: string): Record<string, unknown> | undefined {
    return items.find(candidate => (candidate as Record<string, unknown>).id === itemId) as Record<string, unknown> | undefined
}

function getItemName(item: unknown): string | undefined {
    return (item as Record<string, unknown>)?.name as string | undefined
}

interface NoteItem extends BaseNote {
    [key: string]: unknown
}

export interface NoteCRUDConfig<TItem extends { id: string; name: string }, TReadResult extends { id: string; name: string } = { id: string; name: string; content: string }> {
    resourceType: string
    methodPrefix: string
    toastCategory: ToastCategory
    events: CRUDEventsConfig
    payloadConfig: CRUDPayloadConfig<TItem, string, string, TReadResult>
}

export interface NoteStoreConfig<TItem, TCustomActions extends object = object> {
    storeName: string
    relationship: 'one-to-one' | 'one-to-many'
    responseItemsKey: string
    itemIdField: string
    events: {
        listItems: { request: string; response: string }
        listNotes: { request: string; response: string }
        createNote: { request: string; response: string }
        updateNote: { request: string; response: string }
        deleteNote: { request: string; response: string }
    }
    bindEvents?: {
        request: string
        response: string
    }
    unbindEvents?: {
        request: string
        response: string
    }
    deleteItemEvents?: {
        request: string
        response: string
    }
    groupEvents?: {
        listGroups?: { request: string; response: string }
        createGroup?: { request: string; response: string }
        deleteGroup?: { request: string; response: string }
        moveItemToGroup: { request: string; response: string }
    }
    createNotePayload: (item: TItem, x: number, y: number) => object
    getItemId?: (item: TItem) => string
    getItemName?: (item: TItem) => string
    crudConfig?: NoteCRUDConfig<{ id: string; name: string }>
    customActions?: TCustomActions
}

export interface RebuildNotesConfig {
    storeName: string
    podIdField: keyof Pod
    itemIdField: string
    yOffset: number
    requestEvent: string
    responseEvent: string
}

type RebuildNotesStoreContext = Pick<NoteStoreContext, 'notes' | 'availableItems' | 'getNotesByPodId'>

function shouldCreateNote(pod: Pod, itemId: string | null | undefined, existingNotes: NoteItem[]): boolean {
    return !!itemId && existingNotes.length === 0
}

function buildNoteRequest(
    pod: Pod,
    itemId: string,
    config: RebuildNotesConfig,
    canvasId: string,
    context: RebuildNotesStoreContext
): Promise<void> {
    const item = findItemById(context.availableItems, itemId)
    const itemName = getItemName(item) ?? itemId

    return createWebSocketRequest<BasePayload, Record<string, unknown>>({
        requestEvent: config.requestEvent,
        responseEvent: config.responseEvent,
        payload: {
            canvasId,
            [config.itemIdField]: itemId,
            name: itemName,
            x: pod.x,
            y: pod.y + config.yOffset,
            boundToPodId: pod.id,
            originalPosition: { x: pod.x, y: pod.y + config.yOffset },
        }
    }).then(response => {
        if (response.note) {
            context.notes.push(response.note as NoteItem)
        }
    })
}

export async function rebuildNotesFromPods(
    context: RebuildNotesStoreContext,
    pods: Pod[],
    config: RebuildNotesConfig
): Promise<void> {
    const canvasId = getActiveCanvasIdOrWarn(config.storeName)
    if (!canvasId) return

    const promises = pods
        .filter(pod => shouldCreateNote(pod, pod[config.podIdField] as string | null | undefined, context.getNotesByPodId(pod.id)))
        .map(pod => buildNoteRequest(pod, pod[config.podIdField] as string, config, canvasId, context))

    if (promises.length > 0) {
        await Promise.all(promises)
    }
}

interface BaseNoteState {
    // Pinia state 不支援泛型參數，使用 unknown[] 作為型別擦除邊界。
    // 型別安全由 getter typedAvailableItems（回傳 TItem[]）保障。
    availableItems: unknown[]
    notes: NoteItem[]
    isLoading: boolean
    error: string | null
    draggedNoteId: string | null
    animatingNoteIds: Set<string>
    isDraggingNote: boolean
    isOverTrash: boolean
    groups: Group[]
    expandedGroupIds: Set<string>
}

export interface NoteStoreContext<TItem = unknown> extends BaseNoteState {
    availableItems: TItem[]
    loadItems(): Promise<void>
    loadNotesFromBackend(): Promise<void>
    createNote(itemId: string, x: number, y: number): Promise<void>
    deleteItem(itemId: string): Promise<void>
    deleteNote(noteId: string): Promise<void>
    bindToPod(noteId: string, podId: string): Promise<void>
    unbindFromPod(podId: string, returnToOriginal?: boolean): Promise<void>
    getNotesByPodId(podId: string): NoteItem[]
}

// 此函數的回傳型別由 TypeScript 自動推斷，手動標註會抹除泛型資訊（見 Pinia defineStore 重載限制）
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function createNoteStore<TItem, TNote extends BaseNote, TCustomActions extends object = object>(
    config: NoteStoreConfig<TItem, TCustomActions>
) {
    const getItemId = config.getItemId ?? ((item: TItem): string => (item as { id: string }).id)
    const getItemName = config.getItemName ?? ((item: TItem): string => (item as { name: string }).name)

    return defineStore(config.storeName, {
        state: (): BaseNoteState => ({
            availableItems: [],
            notes: [],
            isLoading: false,
            error: null,
            draggedNoteId: null,
            animatingNoteIds: new Set<string>(),
            isDraggingNote: false,
            isOverTrash: false,
            groups: [],
            expandedGroupIds: new Set<string>(),
        }),

        getters: {
            typedAvailableItems: (state): TItem[] => state.availableItems as TItem[],
            typedNotes: (state): TNote[] => state.notes as TNote[],

            getUnboundNotes: (state) =>
                state.notes.filter(note => note.boundToPodId === null),

            getNotesByPodId: (state) => (podId: string): TNote[] => {
                if (config.relationship === 'one-to-one') {
                    const note = state.notes.find(note => note.boundToPodId === podId)
                    return note ? [note as TNote] : []
                }
                return state.notes.filter(note => note.boundToPodId === podId) as TNote[]
            },

            getNoteById: (state) => (noteId: string): TNote | undefined =>
                state.notes.find(note => note.id === noteId) as TNote | undefined,

            isNoteAnimating: (state) => (noteId: string): boolean =>
                state.animatingNoteIds.has(noteId),

            canDeleteDraggedNote: (state) => {
                if (state.draggedNoteId === null) return false
                const note = state.notes.find(note => note.id === state.draggedNoteId)
                return note?.boundToPodId === null
            },

            isItemInUse: (state) => (itemId: string): boolean =>
                state.notes.some(note => (note as Record<string, unknown>)[config.itemIdField] === itemId && note.boundToPodId !== null),

            isItemBoundToPod: (state) => (itemId: string, podId: string): boolean =>
                state.notes.some(note => (note as Record<string, unknown>)[config.itemIdField] === itemId && note.boundToPodId === podId),

            getGroupById: (state) => (groupId: string): Group | undefined =>
                state.groups.find(group => group.id === groupId),

            getItemsByGroupId: (state) => (groupId: string | null): TItem[] =>
                state.availableItems.filter(item => (item as Record<string, unknown>).groupId === groupId) as TItem[],

            getRootItems: (state): TItem[] =>
                state.availableItems.filter(item => !(item as Record<string, unknown>).groupId) as TItem[],

            getSortedItemsWithGroups: (state): { groups: Group[]; rootItems: TItem[] } => {
                const groups = [...state.groups].sort((a, b) => a.name.localeCompare(b.name))
                const rootItems = state.availableItems
                    .filter(item => !(item as Record<string, unknown>).groupId)
                    .sort((a, b) => getItemName(a as TItem).localeCompare(getItemName(b as TItem)))
                return {groups, rootItems: rootItems as TItem[]}
            },

            isGroupExpanded: (state) => (groupId: string): boolean =>
                state.expandedGroupIds.has(groupId),

            canDeleteGroup: (state) => (groupId: string): boolean =>
                !state.availableItems.some(item => (item as Record<string, unknown>).groupId === groupId),
        },

        actions: {
            async fetchWithCanvasIdInternal(
                requestEvent: string,
                responseEvent: string
            ): Promise<BaseResponse | null> {
                this.isLoading = true
                this.error = null

                const {wrapWebSocketRequest} = useWebSocketErrorHandler()
                const canvasId = getActiveCanvasIdOrWarn(config.storeName)

                if (!canvasId) {
                    this.isLoading = false
                    return null
                }

                const response = await wrapWebSocketRequest(
                    createWebSocketRequest<BasePayload, BaseResponse>({
                        requestEvent,
                        responseEvent,
                        payload: {canvasId}
                    })
                )

                this.isLoading = false

                if (!response) {
                    this.error = '載入失敗'
                }

                return response ?? null
            },

            async loadItems(): Promise<void> {
                const response = await this.fetchWithCanvasIdInternal(
                    config.events.listItems.request,
                    config.events.listItems.response
                )

                if (!response) return

                if (response[config.responseItemsKey]) {
                    this.availableItems = response[config.responseItemsKey] as unknown[]
                }
            },

            async loadNotesFromBackend(): Promise<void> {
                const response = await this.fetchWithCanvasIdInternal(
                    config.events.listNotes.request,
                    config.events.listNotes.response
                )

                if (!response) return

                if (response.notes) {
                    this.notes = response.notes as NoteItem[]
                }
            },

            async createNote(itemId: string, x: number, y: number): Promise<void> {
                const item = this.availableItems.find(candidate => getItemId(candidate as TItem) === itemId)
                if (!item) return

                const itemName = getItemName(item as TItem)
                const canvasId = requireActiveCanvas()

                const payload = {
                    canvasId,
                    ...config.createNotePayload(item as TItem, x, y),
                    name: itemName,
                    x,
                    y,
                    boundToPodId: null,
                    originalPosition: null,
                }

                await createWebSocketRequest<BasePayload, BaseResponse>({
                    requestEvent: config.events.createNote.request,
                    responseEvent: config.events.createNote.response,
                    payload
                })
            },

            ...createNotePositionActions(config),

            setDraggedNote(noteId: string | null): void {
                this.draggedNoteId = noteId
            },

            setNoteAnimating(noteId: string, isAnimating: boolean): void {
                if (isAnimating) {
                    this.animatingNoteIds.add(noteId)
                } else {
                    this.animatingNoteIds.delete(noteId)
                }
            },

            setIsDraggingNote(isDragging: boolean): void {
                this.isDraggingNote = isDragging
            },

            setIsOverTrash(isOver: boolean): void {
                this.isOverTrash = isOver
            },

            ...createNoteBindingActions(config),

            async deleteNote(noteId: string): Promise<void> {
                const {wrapWebSocketRequest} = useWebSocketErrorHandler()
                const canvasId = requireActiveCanvas()

                await wrapWebSocketRequest(
                    createWebSocketRequest<BasePayload, BaseResponse>({
                        requestEvent: config.events.deleteNote.request,
                        responseEvent: config.events.deleteNote.response,
                        payload: {
                            canvasId,
                            noteId,
                        }
                    })
                )
            },

            async deleteItem(itemId: string): Promise<void> {
                if (!config.deleteItemEvents) return

                const {deleteItem} = useDeleteItem()
                const canvasId = requireActiveCanvas()
                const {showSuccessToast, showErrorToast} = useToast()

                const item = this.availableItems.find(candidate => getItemId(candidate as TItem) === itemId)
                const itemName = item ? getItemName(item as TItem) : undefined
                const category = (STORE_TO_CATEGORY_MAP[config.storeName] || 'Note') as 'Skill' | 'Repository' | 'SubAgent' | 'Command' | 'OutputStyle' | 'Note'

                const removeItemFromState = (res: BaseResponse): void => {
                    const index = this.availableItems.findIndex(i => getItemId(i as TItem) === itemId)
                    if (index !== -1) {
                        this.availableItems.splice(index, 1)
                    }
                    if (res.deletedNoteIds) {
                        const deletedIds = res.deletedNoteIds as string[]
                        this.notes.splice(0, this.notes.length, ...this.notes.filter(note => !deletedIds.includes(note.id)))
                    }
                    showSuccessToast(category, '刪除成功', itemName)
                }

                try {
                    await deleteItem<Record<string, unknown>, BaseResponse>({
                        requestEvent: config.deleteItemEvents.request,
                        responseEvent: config.deleteItemEvents.response,
                        payload: {
                            canvasId,
                            [config.itemIdField]: itemId
                        },
                        errorMessage: '刪除項目失敗',
                        onSuccess: removeItemFromState
                    })
                } catch (error) {
                    showErrorToast(category, '刪除失敗', extractErrorMessage(error))
                    throw error
                }
            },

            addNoteFromEvent(note: TNote): void {
                const exists = this.notes.some(existingNote => existingNote.id === note.id)
                if (!exists) {
                    this.notes.push(note as unknown as NoteItem)
                }
            },

            updateNoteFromEvent(note: TNote): void {
                const index = this.notes.findIndex(existingNote => existingNote.id === note.id)
                if (index !== -1) {
                    this.notes.splice(index, 1, note as unknown as NoteItem)
                }
            },

            removeNoteFromEvent(noteId: string): void {
                this.notes = this.notes.filter(note => note.id !== noteId)
            },

            addItemFromEvent(item: TItem): void {
                const exists = this.availableItems.some(i => getItemId(i as TItem) === getItemId(item))
                if (!exists) {
                    this.availableItems.push(item)
                }
            },

            updateItemFromEvent(item: TItem): void {
                const index = this.availableItems.findIndex(i => getItemId(i as TItem) === getItemId(item))
                if (index !== -1) {
                    this.availableItems.splice(index, 1, item)
                }
            },

            removeItemFromEvent(itemId: string, deletedNoteIds?: string[]): void {
                this.availableItems = this.availableItems.filter(item => getItemId(item as TItem) !== itemId)

                if (deletedNoteIds) {
                    this.notes = this.notes.filter(note => !deletedNoteIds.includes(note.id))
                }
            },

            toggleGroupExpand(groupId: string): void {
                if (this.expandedGroupIds.has(groupId)) {
                    this.expandedGroupIds.delete(groupId)
                } else {
                    this.expandedGroupIds.add(groupId)
                }
            },

            addGroupFromEvent(group: Group): void {
                const exists = this.groups.some(g => g.id === group.id)
                if (!exists) {
                    this.groups.push(group)
                }
            },

            removeGroupFromEvent(groupId: string): void {
                this.groups = this.groups.filter(existingGroup => existingGroup.id !== groupId)
            },

            updateItemGroupId(itemId: string, groupId: string | null): void {
                const item = this.availableItems.find(candidate => getItemId(candidate as TItem) === itemId)
                if (item) {
                    (item as Record<string, unknown>).groupId = groupId
                }
            },

            ...(config.customActions ?? {} as TCustomActions),
            ...buildCRUDActions(config),
        },
    })
}

function capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1)
}

type CRUDStoreContext = {
    availableItems: { id: string; name: string }[]
    deleteItem: (id: string) => Promise<void>
    loadItems: () => Promise<void>
}

function buildCRUDActions<TItem>(config: NoteStoreConfig<TItem>): Record<string, unknown> {
    if (!config.crudConfig) return {}

    const crudConfig = config.crudConfig as NoteCRUDConfig<{ id: string; name: string }>
    const methodPrefix = crudConfig.methodPrefix
    const capitalizedMethodPrefix = capitalize(methodPrefix)

    const crud = createResourceCRUDActions(
        crudConfig.resourceType,
        crudConfig.events,
        crudConfig.payloadConfig,
        crudConfig.toastCategory
    )

    const actions: Record<string, unknown> = {}

    actions[`create${capitalizedMethodPrefix}`] = async function(
        this: CRUDStoreContext,
        name: string,
        content: string
    ): Promise<{ success: boolean; [key: string]: unknown }> {
        const result = await crud.create(this.availableItems, name, content)
        return result.success
            ? { success: true, [methodPrefix]: result.item }
            : { success: false, error: result.error }
    }

    actions[`update${capitalizedMethodPrefix}`] = async function(
        this: CRUDStoreContext,
        itemId: string,
        content: string
    ): Promise<{ success: boolean; [key: string]: unknown }> {
        const result = await crud.update(this.availableItems, itemId, content)
        return result.success
            ? { success: true, [methodPrefix]: result.item }
            : { success: false, error: result.error }
    }

    actions[`read${capitalizedMethodPrefix}`] = async function(
        this: CRUDStoreContext,
        itemId: string
    ): Promise<{ id: string; name: string; content: string } | null> {
        return crud.read(itemId) as Promise<{ id: string; name: string; content: string } | null>
    }

    actions[`delete${capitalizedMethodPrefix}`] = async function(
        this: CRUDStoreContext,
        itemId: string
    ): Promise<void> {
        return this.deleteItem(itemId)
    }

    actions[`load${capitalizedMethodPrefix}s`] = async function(
        this: CRUDStoreContext
    ): Promise<void> {
        return this.loadItems()
    }

    return actions
}
