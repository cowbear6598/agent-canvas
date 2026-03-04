import type { Skill, SkillNote } from '@/types'
import { createNoteStore } from './createNoteStore'
import type { NoteStoreContext, TypedNoteStore } from './createNoteStore'
import { WebSocketRequestEvents, WebSocketResponseEvents } from '@/services/websocket'
import { createWebSocketRequest } from '@/services/websocket/createWebSocketRequest'
import type { SkillImportPayload, SkillImportedPayload } from '@/types/websocket'
import { useWebSocketErrorHandler } from '@/composables/useWebSocketErrorHandler'
import { requireActiveCanvas } from '@/utils/canvasGuard'

interface SkillStoreCustomActions {
  deleteSkill(skillId: string): Promise<void>
  loadSkills(): Promise<void>
  importSkill(fileName: string, fileData: string, fileSize: number): Promise<{ success: boolean; isOverwrite?: boolean; error?: string; skill?: Skill }>
}

const store = createNoteStore<Skill, SkillNote>({
  storeName: 'skill',
  relationship: 'one-to-many',
  responseItemsKey: 'skills',
  itemIdField: 'skillId',
  events: {
    listItems: {
      request: WebSocketRequestEvents.SKILL_LIST,
      response: WebSocketResponseEvents.SKILL_LIST_RESULT,
    },
    listNotes: {
      request: WebSocketRequestEvents.SKILL_NOTE_LIST,
      response: WebSocketResponseEvents.SKILL_NOTE_LIST_RESULT,
    },
    createNote: {
      request: WebSocketRequestEvents.SKILL_NOTE_CREATE,
      response: WebSocketResponseEvents.SKILL_NOTE_CREATED,
    },
    updateNote: {
      request: WebSocketRequestEvents.SKILL_NOTE_UPDATE,
      response: WebSocketResponseEvents.SKILL_NOTE_UPDATED,
    },
    deleteNote: {
      request: WebSocketRequestEvents.SKILL_NOTE_DELETE,
      response: WebSocketResponseEvents.SKILL_NOTE_DELETED,
    },
  },
  bindEvents: {
    request: WebSocketRequestEvents.POD_BIND_SKILL,
    response: WebSocketResponseEvents.POD_SKILL_BOUND,
  },
  deleteItemEvents: {
    request: WebSocketRequestEvents.SKILL_DELETE,
    response: WebSocketResponseEvents.SKILL_DELETED,
  },
  createNotePayload: (item: Skill) => ({
    skillId: item.id,
  }),
  customActions: {
    async deleteSkill(this: NoteStoreContext<Skill>, skillId: string): Promise<void> {
      return this.deleteItem(skillId)
    },

    async loadSkills(this: NoteStoreContext<Skill>): Promise<void> {
      return this.loadItems()
    },

    async importSkill(this: NoteStoreContext<Skill> & SkillStoreCustomActions, fileName: string, fileData: string, fileSize: number): Promise<{ success: boolean; isOverwrite?: boolean; error?: string; skill?: Skill }> {
      const { wrapWebSocketRequest } = useWebSocketErrorHandler()
      const canvasId = requireActiveCanvas()

      const result = await wrapWebSocketRequest(
        createWebSocketRequest<SkillImportPayload, SkillImportedPayload>({
          requestEvent: WebSocketRequestEvents.SKILL_IMPORT,
          responseEvent: WebSocketResponseEvents.SKILL_IMPORTED,
          payload: {
            canvasId,
            fileName,
            fileData,
            fileSize
          }
        })
      )

      if (result?.success) {
        await this.loadSkills()
        return {
          success: true,
          isOverwrite: result.isOverwrite,
          skill: result.skill as Skill
        }
      }

      return {
        success: false,
        error: result?.error ?? '匯入失敗'
      }
    },
  }
})

export const useSkillStore = store as TypedNoteStore<typeof store, SkillStoreCustomActions>
