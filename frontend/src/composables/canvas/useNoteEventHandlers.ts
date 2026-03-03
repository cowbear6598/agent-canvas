import type { Ref } from 'vue'

const NOTE_SNAP_BACK_ANIMATION_MS = 300

interface Note {
  x: number
  y: number
  boundToPodId: string | null
}

interface NoteStore {
  updateNotePositionLocal: (noteId: string, x: number, y: number) => void
  updateNotePosition: (noteId: string, x: number, y: number) => Promise<void>
  setIsOverTrash: (isOver: boolean) => void
  setNoteAnimating: (noteId: string, isAnimating: boolean) => void
  deleteNote: (noteId: string) => Promise<void>
  getNoteById: (noteId: string) => Note | undefined
}

interface TrashZone {
  isPointInZone: (x: number, y: number) => boolean
}

interface NoteEventHandlerOptions {
  store: NoteStore
  trashZoneRef: Ref<TrashZone | null>
}

export function useNoteEventHandlers(options: NoteEventHandlerOptions): {
  handleDragEnd: (data: { noteId: string; x: number; y: number }) => void
  handleDragMove: (data: { noteId: string; screenX: number; screenY: number }) => void
  handleDragComplete: (data: { noteId: string; isOverTrash: boolean; startX: number; startY: number }) => Promise<void>
} {
  const { store, trashZoneRef } = options

  const handleDragEnd = (data: { noteId: string; x: number; y: number }): void => {
    store.updateNotePositionLocal(data.noteId, data.x, data.y)
  }

  const handleDragMove = (data: { noteId: string; screenX: number; screenY: number }): void => {
    if (!trashZoneRef.value) return

    const isOver = trashZoneRef.value.isPointInZone(data.screenX, data.screenY)
    store.setIsOverTrash(isOver)
  }

  const handleDropOnTrash = async (noteId: string, note: Note, startX: number, startY: number): Promise<void> => {
    if (note.boundToPodId === null) {
      await store.deleteNote(noteId)
      return
    }

    store.setNoteAnimating(noteId, true)
    await store.updateNotePosition(noteId, startX, startY)
    setTimeout(() => {
      store.setNoteAnimating(noteId, false)
    }, NOTE_SNAP_BACK_ANIMATION_MS)
  }

  const handleDragComplete = async (data: { noteId: string; isOverTrash: boolean; startX: number; startY: number }): Promise<void> => {
    const note = store.getNoteById(data.noteId)
    if (!note) return

    if (data.isOverTrash) {
      await handleDropOnTrash(data.noteId, note, data.startX, data.startY)
    } else {
      await store.updateNotePosition(data.noteId, note.x, note.y)
    }

    store.setIsOverTrash(false)
  }

  return { handleDragEnd, handleDragMove, handleDragComplete }
}
