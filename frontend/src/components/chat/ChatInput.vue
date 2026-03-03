<script setup lang="ts">
import {ref, onMounted, onUnmounted, watch} from 'vue'
import {Send, Mic, Square} from 'lucide-vue-next'
import {
  MAX_MESSAGE_LENGTH,
  TEXTAREA_MAX_HEIGHT,
  MAX_IMAGE_SIZE_BYTES,
  SUPPORTED_IMAGE_MEDIA_TYPES,
  MAX_IMAGES_PER_DROP
} from '@/lib/constants'
import ScrollArea from '@/components/ui/scroll-area/ScrollArea.vue'
import {useToast} from '@/composables/useToast'
import type {ContentBlock, ImageMediaType} from '@/types/websocket/requests'
import {walkDOM} from '@/utils/chatInputDOM'
import type {DOMNodeHandlers} from '@/utils/chatInputDOM'

interface SpeechRecognitionResult {
  readonly [index: number]: { transcript: string }
}

interface SpeechRecognitionResultList {
  readonly length: number

  readonly [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionEventMap {
  result: { results: SpeechRecognitionResultList }
  end: Event
  error: { error: string }
}

interface ISpeechRecognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: SpeechRecognitionEventMap['result']) => void) | null
  onend: (() => void) | null
  onerror: ((event: SpeechRecognitionEventMap['error']) => void) | null

  start(): void

  stop(): void
}

declare global {
  interface Window {
    SpeechRecognition: new () => ISpeechRecognition
    webkitSpeechRecognition: new () => ISpeechRecognition
  }
}

interface ImageAttachment {
  mediaType: ImageMediaType
  base64Data: string
}

const props = defineProps<{
  isTyping?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  send: [message: string, contentBlocks?: ContentBlock[]]
  abort: []
}>()

const input = ref('')
const editableRef = ref<HTMLDivElement | null>(null)
const isListening = ref(false)
const recognition = ref<ISpeechRecognition | null>(null)
const isAborting = ref(false)
const {toast} = useToast()

const imageDataMap = new WeakMap<HTMLElement, ImageAttachment>()

const moveCursorToEnd = (): void => {
  const element = editableRef.value
  if (!element) return

  const range = document.createRange()
  const selection = window.getSelection()
  if (!selection) return

  range.selectNodeContents(element)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

const updateText = (text: string): void => {
  const element = editableRef.value
  if (!element) return

  const truncated = text.slice(0, MAX_MESSAGE_LENGTH)
  input.value = truncated
  element.innerText = truncated
  moveCursorToEnd()
}

const textLengthHandlers: DOMNodeHandlers<number> = {
  onText: (text) => text.length,
  onBreak: () => 1,
  onImage: () => 0,
  combine: (results) => results.reduce((sum, n) => sum + n, 0),
}

const countTextLength = (node: Node): number => walkDOM(node, textLengthHandlers)

const handleInput = (e: Event): void => {
  const target = e.target as HTMLDivElement
  const innerText = target.innerText

  let textLength = 0
  for (const child of Array.from(target.childNodes)) {
    textLength += countTextLength(child)
  }

  if (textLength > MAX_MESSAGE_LENGTH) {
    updateText(innerText)
  } else {
    input.value = innerText
  }
}

const isValidImageType = (fileType: string): fileType is ImageMediaType => {
  return SUPPORTED_IMAGE_MEDIA_TYPES.includes(fileType as ImageMediaType)
}

const createImageAtom = (mediaType: ImageMediaType, base64Data: string): HTMLSpanElement => {
  const imageAtom = document.createElement('span')
  imageAtom.contentEditable = 'false'
  imageAtom.dataset.type = 'image'
  imageAtom.className = 'image-atom'
  imageAtom.textContent = '[image]'

  imageDataMap.set(imageAtom, {mediaType, base64Data})

  return imageAtom
}

const insertNodeAtCursor = (node: Node): void => {
  const element = editableRef.value
  if (!element) return

  const selection = window.getSelection()
  if (!selection) return

  const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null

  if (range && element.contains(range.commonAncestorContainer)) {
    range.deleteContents()
    range.insertNode(node)

    range.setStartAfter(node)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  } else {
    element.appendChild(node)
    moveCursorToEnd()
  }

  element.dispatchEvent(new Event('input', {bubbles: true}))
}

const readFileAsDataURL = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e): void => {
      const result = e.target?.result
      if (typeof result === 'string') {
        resolve(result)
      } else {
        reject(new Error('讀取檔案失敗'))
      }
    }
    reader.onerror = (): void => reject(new Error('FileReader 錯誤'))
    reader.readAsDataURL(file)
  })
}

const insertImageAtCursor = async (file: File): Promise<void> => {
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    toast({title: '圖片大小超過 5MB 限制'})
    return
  }

  if (!isValidImageType(file.type)) {
    toast({
      title: '不支援的圖片格式',
      description: '僅支援 JPEG/PNG/GIF/WebP',
    })
    return
  }

  let result: string
  try {
    result = await readFileAsDataURL(file)
  } catch {
    toast({title: '圖片讀取失敗'})
    return
  }

  if (!/^data:image\/(jpeg|png|gif|webp);base64,/.test(result)) {
    toast({title: '圖片格式無效'})
    return
  }

  const base64Data = result.split(',')[1]
  if (!base64Data) {
    toast({title: '圖片資料無效'})
    return
  }

  const imageAtom = createImageAtom(file.type as ImageMediaType, base64Data)
  insertNodeAtCursor(imageAtom)
}

const findImageFile = (files: FileList | null): File | undefined => {
  if (!files || files.length === 0) return undefined
  return Array.from(files).find(file => file.type.startsWith('image/'))
}

const handlePaste = async (e: ClipboardEvent): Promise<void> => {
  const imageFile = findImageFile(e.clipboardData?.files ?? null)

  if (imageFile) {
    e.preventDefault()
    await insertImageAtCursor(imageFile)
    return
  }

  e.preventDefault()
  const text = e.clipboardData?.getData('text/plain')
  if (text) {
    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0)
      range.deleteContents()
      const textNode = document.createTextNode(text)
      range.insertNode(textNode)
      range.setStartAfter(textNode)
      range.setEndAfter(textNode)
      selection.removeAllRanges()
      selection.addRange(range)
      // 同步更新 input.value，避免貼上後送出時檢查失敗
      input.value = editableRef.value?.innerText ?? ''
    }
  }
}

const handleDrop = async (e: DragEvent): Promise<void> => {
  e.preventDefault()

  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return

  const imageFiles = Array.from(files).filter(file => isValidImageType(file.type))
  if (imageFiles.length > MAX_IMAGES_PER_DROP) {
    toast({
      title: '一次最多只能上傳 1 張圖片',
    })
  }

  const fileToInsert = imageFiles[0]
  if (!fileToInsert) return

  await insertImageAtCursor(fileToInsert)
}

const flushTextToBlocks = (blocks: ContentBlock[], currentText: string[]): void => {
  if (currentText.length === 0) return

  const text = currentText.join('')
  if (text.trim()) {
    blocks.push({type: 'text', text})
  }
  currentText.length = 0
}

const makeContentBlockHandlers = (
    blocks: ContentBlock[],
    currentText: string[]
): DOMNodeHandlers<void> => ({
  onText: (text): void => { if (text) currentText.push(text) },
  onBreak: (): void => { currentText.push('\n') },
  onImage: (element): void => {
    const imageData = imageDataMap.get(element)
    if (imageData) {
      flushTextToBlocks(blocks, currentText)
      blocks.push({
        type: 'image',
        mediaType: imageData.mediaType,
        base64Data: imageData.base64Data
      })
    }
  },
  combine: (): void => undefined,
})

const parseContentBlocks = (
    node: Node,
    blocks: ContentBlock[],
    currentText: string[]
): void => { walkDOM(node, makeContentBlockHandlers(blocks, currentText)) }

const buildContentBlocks = (): ContentBlock[] => {
  const element = editableRef.value
  if (!element) return []

  const blocks: ContentBlock[] = []
  const currentText: string[] = []

  for (const child of Array.from(element.childNodes)) {
    parseContentBlocks(child, blocks, currentText)
  }

  flushTextToBlocks(blocks, currentText)

  return blocks
}

const extractTextFromBlocks = (blocks: ContentBlock[]): string => {
  return blocks
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('')
}

const clearInput = (): void => {
  input.value = ''
  if (editableRef.value) {
    editableRef.value.querySelectorAll<HTMLElement>('[data-type="image"]').forEach(el => {
      imageDataMap.delete(el)
    })
    editableRef.value.textContent = ''
  }
}

const handleAbort = (): void => {
  if (isAborting.value) return
  isAborting.value = true
  emit('abort')
}

const handleSend = (): void => {
  if (props.disabled) return
  const blocks = buildContentBlocks()
  if (blocks.length === 0) return

  const textContent = extractTextFromBlocks(blocks)
  if (textContent.length > MAX_MESSAGE_LENGTH) return

  const hasImages = blocks.some(block => block.type === 'image')
  if (hasImages) {
    emit('send', textContent, blocks)
  } else {
    emit('send', input.value)
  }

  clearInput()
}

const isImageAtom = (node: Node | null): node is HTMLElement => {
  return node !== null &&
      node.nodeType === Node.ELEMENT_NODE &&
      (node as HTMLElement).dataset.type === 'image'
}

const deleteImageAtom = (element: HTMLElement): void => {
  imageDataMap.delete(element)
  element.remove()
  editableRef.value?.dispatchEvent(new Event('input', {bubbles: true}))
}

const handleEnterKey = (e: KeyboardEvent): void => {
  if (e.ctrlKey || e.shiftKey) {
    e.preventDefault()
    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0)
      range.deleteContents()
      const br = document.createElement('br')
      range.insertNode(br)
      range.setStartAfter(br)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
      editableRef.value?.dispatchEvent(new Event('input', {bubbles: true}))
    }
    return
  }
  e.preventDefault()
  if (props.isTyping) return
  if (props.disabled) return
  handleSend()
}

const findImageAtomBefore = (range: Range): HTMLElement | null => {
  const {startContainer, startOffset} = range

  if (startContainer.nodeType === Node.ELEMENT_NODE && startOffset > 0) {
    const node = startContainer.childNodes[startOffset - 1] ?? null
    return isImageAtom(node) ? node : null
  }

  if (startContainer.nodeType === Node.TEXT_NODE && startOffset === 0) {
    const prev = startContainer.previousSibling
    return isImageAtom(prev) ? prev : null
  }

  return null
}

const handleBackspaceKey = (e: KeyboardEvent): void => {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return

  const range = selection.getRangeAt(0)
  if (!range.collapsed) return

  const imageAtom = findImageAtomBefore(range)
  if (imageAtom) {
    e.preventDefault()
    deleteImageAtom(imageAtom)
  }
}

const handleKeyDown = (e: KeyboardEvent): void => {
  if (e.isComposing || e.keyCode === 229) return
  if (e.key === 'Enter') return handleEnterKey(e)
  if (e.key === 'Backspace') return handleBackspaceKey(e)
}

const toggleListening = (): void => {
  if (props.disabled) return
  if (!recognition.value) {
    toast({
      title: '此瀏覽器不支援語音輸入功能',
    })
    return
  }

  if (isListening.value) {
    recognition.value.stop()
    isListening.value = false
  } else {
    recognition.value.start()
    isListening.value = true
    editableRef.value?.focus()
  }
}

const initializeSpeechRecognition = (): void => {
  const SpeechRecognitionConstructor = window.SpeechRecognition || window.webkitSpeechRecognition

  if (!SpeechRecognitionConstructor) {
    recognition.value = null
    return
  }

  recognition.value = new SpeechRecognitionConstructor()
  recognition.value.lang = 'zh-TW'
  recognition.value.interimResults = false
  recognition.value.continuous = true

  recognition.value.onresult = (event): void => {
    const lastResult = event.results[event.results.length - 1]
    if (!lastResult) return
    const transcript = lastResult[0]?.transcript
    if (!transcript) return

    if (input.value.length + transcript.length > MAX_MESSAGE_LENGTH) {
      updateText((input.value + transcript).slice(0, MAX_MESSAGE_LENGTH))
      recognition.value?.stop()
      toast({
        title: '已達到最大文字長度限制',
      })
      return
    }

    updateText(input.value + transcript)
  }

  recognition.value.onend = (): void => {
    isListening.value = false
  }

  recognition.value.onerror = (event): void => {
    isListening.value = false
    if (import.meta.env.DEV) {
      console.warn('語音辨識錯誤：', event.error)
    }
  }
}

const cleanupSpeechRecognition = (): void => {
  if (!recognition.value) return

  recognition.value.stop()
  recognition.value.onresult = null
  recognition.value.onend = null
  recognition.value.onerror = null
}

watch(() => props.isTyping, (newValue, oldValue) => {
  if (oldValue === true && newValue === false) {
    isAborting.value = false
  }
})

onMounted(() => {
  initializeSpeechRecognition()
})

onUnmounted(() => {
  cleanupSpeechRecognition()
})
</script>

<template>
  <div class="p-4 border-t-2 border-doodle-ink">
    <div class="flex gap-2">
      <ScrollArea
        class="flex-1 border-2 border-doodle-ink rounded-lg bg-card focus-within:ring-2 focus-within:ring-primary"
        :style="{ boxShadow: '2px 2px 0 var(--doodle-ink)', maxHeight: TEXTAREA_MAX_HEIGHT + 'px' }"
      >
        <div
          ref="editableRef"
          :contenteditable="!disabled"
          class="px-4 py-3 font-mono text-sm outline-none leading-5 chat-input-editable"
          :class="{ 'opacity-50': disabled }"
          @input="handleInput"
          @keydown="handleKeyDown"
          @paste="handlePaste"
          @dragover.prevent
          @drop="handleDrop"
        />
      </ScrollArea>
      <button
        v-if="isTyping"
        :disabled="isAborting"
        class="doodle-action-btn bg-doodle-coral disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-x-0 disabled:hover:translate-y-0"
        @click="handleAbort"
      >
        <Square
          :size="16"
          class="text-card"
        />
      </button>
      <button
        v-else
        :disabled="disabled"
        class="doodle-action-btn bg-doodle-green disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-x-0 disabled:hover:translate-y-0"
        @click="handleSend"
      >
        <Send
          :size="20"
          class="text-card"
        />
      </button>
      <button
        :disabled="disabled"
        class="doodle-action-btn disabled:opacity-50 disabled:cursor-not-allowed"
        :class="isListening ? 'bg-red-500' : 'bg-doodle-coral'"
        @click="toggleListening"
      >
        <Mic
          :size="20"
          class="text-card"
          :class="{ 'animate-pulse': isListening }"
        />
      </button>
    </div>
  </div>
</template>

<style scoped>
.doodle-action-btn {
  padding: 0.75rem 1rem;
  border: 2px solid var(--doodle-ink);
  border-radius: 0.5rem;
  box-shadow: 2px 2px 0 var(--doodle-ink);
  transition-property: transform;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 150ms;
}

.doodle-action-btn:hover {
  transform: translate(-1px, -1px);
}

.chat-input-editable:empty::before {
  content: '輸入訊息...';
  color: oklch(0.55 0.02 50);
  pointer-events: none;
}

:deep(.image-atom) {
  display: inline-block;
  background-color: oklch(0.85 0.05 200);
  border: 1px solid var(--doodle-ink);
  border-radius: 4px;
  padding: 0 4px;
  font-size: 12px;
  font-family: monospace;
  user-select: none;
  cursor: default;
}
</style>
