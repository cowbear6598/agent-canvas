import {defineStore} from 'pinia'
import type {BaseNote, SelectableElement, SelectionState} from '@/types'
import {POD_WIDTH, POD_HEIGHT, NOTE_WIDTH, NOTE_HEIGHT} from '@/lib/constants'

type NoteType =
    | 'outputStyleNote'
    | 'skillNote'
    | 'repositoryNote'
    | 'subAgentNote'
    | 'commandNote'
    | 'mcpServerNote'

type SelectionBox = {minX: number; maxX: number; minY: number; maxY: number}

function selectIdsByType(elements: {type: string; id: string}[], type: string): string[] {
    return elements
        .filter(el => el.type === type)
        .map(el => el.id)
}

function findPodsInSelectionBox(
    pods: Array<{id: string; x: number; y: number}>,
    box: SelectionBox
): SelectableElement[] {
    return pods
        .filter(pod => {
            const podMaxX = pod.x + POD_WIDTH
            const podMaxY = pod.y + POD_HEIGHT
            return !(podMaxX < box.minX || pod.x > box.maxX || podMaxY < box.minY || pod.y > box.maxY)
        })
        .map(pod => ({type: 'pod' as const, id: pod.id}))
}

function isNoteInBox(note: BaseNote, box: SelectionBox): boolean {
    const noteMaxX = note.x + NOTE_WIDTH
    const noteMaxY = note.y + NOTE_HEIGHT
    return noteMaxX >= box.minX && note.x <= box.maxX && noteMaxY >= box.minY && note.y <= box.maxY
}

function findNotesInSelectionBox(
    noteGroups: Array<{notes: BaseNote[]; type: NoteType}>,
    box: SelectionBox
): SelectableElement[] {
    return noteGroups.flatMap(({notes, type}) =>
        notes
            .filter(note => !note.boundToPodId && isNoteInBox(note, box))
            .map(note => ({type, id: note.id}))
    )
}

function applyCtrlModeToggle(
    initialElements: SelectableElement[],
    newElements: SelectableElement[]
): SelectableElement[] {
    const result = [...initialElements]

    for (const element of newElements) {
        const index = result.findIndex(el => el.type === element.type && el.id === element.id)
        if (index !== -1) {
            result.splice(index, 1)
        } else {
            result.push(element)
        }
    }

    return result
}

export const useSelectionStore = defineStore('selection', {
    state: (): SelectionState => ({
        isSelecting: false,
        box: null,
        selectedElements: [],
        boxSelectJustEnded: false,
        isCtrlMode: false,
        initialSelectedElements: [],
    }),

    getters: {
        /**
         * 取得選中的 Pod ID 列表
         */
        selectedPodIds: (state): string[] => selectIdsByType(state.selectedElements, 'pod'),

        /**
         * 取得選中的 OutputStyleNote ID 列表
         */
        selectedOutputStyleNoteIds: (state): string[] => selectIdsByType(state.selectedElements, 'outputStyleNote'),

        /**
         * 取得選中的 SkillNote ID 列表
         */
        selectedSkillNoteIds: (state): string[] => selectIdsByType(state.selectedElements, 'skillNote'),

        /**
         * 取得選中的 RepositoryNote ID 列表
         */
        selectedRepositoryNoteIds: (state): string[] => selectIdsByType(state.selectedElements, 'repositoryNote'),

        /**
         * 取得選中的 SubAgentNote ID 列表
         */
        selectedSubAgentNoteIds: (state): string[] => selectIdsByType(state.selectedElements, 'subAgentNote'),

        /**
         * 取得選中的 CommandNote ID 列表
         */
        selectedCommandNoteIds: (state): string[] => selectIdsByType(state.selectedElements, 'commandNote'),

        /**
         * 取得選中的 McpServerNote ID 列表
         */
        selectedMcpServerNoteIds: (state): string[] => selectIdsByType(state.selectedElements, 'mcpServerNote'),

        /**
         * 是否有選中的元素
         */
        hasSelection: (state): boolean => state.selectedElements.length > 0,

        /**
         * 檢查元素是否已選取
         */
        isElementSelected: (state) => (type: string, id: string): boolean => {
            return state.selectedElements.some(el => el.type === type && el.id === id)
        },
    },

    actions: {
        /**
         * 開始框選
         */
        startSelection(startX: number, startY: number, isCtrlPressed: boolean = false): void {
            this.isSelecting = true
            this.box = {startX, startY, endX: startX, endY: startY}
            this.isCtrlMode = isCtrlPressed

            if (isCtrlPressed) {
                this.initialSelectedElements = [...this.selectedElements]
            } else {
                this.selectedElements = []
                this.initialSelectedElements = []
            }
        },

        /**
         * 更新框選範圍
         */
        updateSelection(endX: number, endY: number): void {
            if (!this.box) return
            this.box.endX = endX
            this.box.endY = endY
        },

        /**
         * 結束框選
         */
        endSelection(): void {
            this.isSelecting = false
            this.box = null
            this.boxSelectJustEnded = true
            this.isCtrlMode = false
            this.initialSelectedElements = []
            requestAnimationFrame(() => {
                this.boxSelectJustEnded = false
            })
        },

        /**
         * 取消框選（純點擊情況）
         * 不設定 boxSelectJustEnded，讓 click 事件可以正常傳遞
         */
        cancelSelection(): void {
            this.isSelecting = false
            this.box = null
            this.isCtrlMode = false
            this.initialSelectedElements = []
        },

        /**
         * 清除選取狀態
         */
        clearSelection(): void {
            this.isSelecting = false
            this.box = null
            this.selectedElements = []
        },

        /**
         * 設定選中的元素
         */
        setSelectedElements(elements: SelectableElement[]): void {
            this.selectedElements = elements
        },

        /**
         * Toggle 元素選取狀態
         */
        toggleElement(element: SelectableElement): void {
            const index = this.selectedElements.findIndex(
                el => el.type === element.type && el.id === element.id
            )

            if (index !== -1) {
                this.selectedElements.splice(index, 1)
            } else {
                this.selectedElements.push(element)
            }
        },
        calculateSelectedElements(
            pods: Array<{id: string; x: number; y: number}>,
            outputStyleNotes: BaseNote[],
            skillNotes: BaseNote[],
            repositoryNotes: BaseNote[] = [],
            subAgentNotes: BaseNote[] = [],
            commandNotes: BaseNote[] = [],
            mcpServerNotes: BaseNote[] = []
        ): void {
            if (!this.box) return

            const box: SelectionBox = {
                minX: Math.min(this.box.startX, this.box.endX),
                maxX: Math.max(this.box.startX, this.box.endX),
                minY: Math.min(this.box.startY, this.box.endY),
                maxY: Math.max(this.box.startY, this.box.endY),
            }

            const noteGroups: Array<{notes: BaseNote[]; type: NoteType}> = [
                {notes: outputStyleNotes, type: 'outputStyleNote'},
                {notes: skillNotes, type: 'skillNote'},
                {notes: repositoryNotes, type: 'repositoryNote'},
                {notes: subAgentNotes, type: 'subAgentNote'},
                {notes: commandNotes, type: 'commandNote'},
                {notes: mcpServerNotes, type: 'mcpServerNote'},
            ]

            const selected = [
                ...findPodsInSelectionBox(pods, box),
                ...findNotesInSelectionBox(noteGroups, box),
            ]

            this.selectedElements = this.isCtrlMode
                ? applyCtrlModeToggle(this.initialSelectedElements, selected)
                : selected
        },
    },
})
