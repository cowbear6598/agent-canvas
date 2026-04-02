import {ref, onMounted, onUnmounted} from 'vue'
import type {Ref} from 'vue'
import {MAX_MESSAGE_LENGTH} from '@/lib/constants'
import {useToast} from '@/composables/useToast'
import {t} from '@/i18n'

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

export function useSpeechRecognition(options: {
  disabled: Ref<boolean>
  currentText: Ref<string>
  updateText: (text: string) => void
}): {
  isListening: Ref<boolean>
  toggleListening: () => void
} {
  const {disabled, currentText, updateText} = options
  const {toast} = useToast()

  const isListening = ref(false)
  const recognition = ref<ISpeechRecognition | null>(null)

  const createOnResultHandler = () => (event: SpeechRecognitionEventMap['result']): void => {
    const lastResult = event.results[event.results.length - 1]
    if (!lastResult) return
    const transcript = lastResult[0]?.transcript
    if (!transcript) return

    if (currentText.value.length + transcript.length > MAX_MESSAGE_LENGTH) {
      updateText((currentText.value + transcript).slice(0, MAX_MESSAGE_LENGTH))
      recognition.value?.stop()
      toast({title: t('composable.chat.speechMaxLength')})
      return
    }

    updateText(currentText.value + transcript)
  }

  const createOnErrorHandler = () => (event: SpeechRecognitionEventMap['error']): void => {
    isListening.value = false
    if (import.meta.env.DEV) {
      console.warn('語音辨識錯誤：', event.error)
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

    recognition.value.onresult = createOnResultHandler()
    recognition.value.onend = (): void => { isListening.value = false }
    recognition.value.onerror = createOnErrorHandler()
  }

  const cleanupSpeechRecognition = (): void => {
    if (!recognition.value) return

    recognition.value.stop()
    recognition.value.onresult = null
    recognition.value.onend = null
    recognition.value.onerror = null
  }

  const toggleListening = (): void => {
    if (disabled.value) return
    if (!recognition.value) {
      toast({title: t('composable.chat.speechUnsupported')})
      return
    }

    if (isListening.value) {
      recognition.value.stop()
      isListening.value = false
    } else {
      recognition.value.start()
      isListening.value = true
    }
  }

  onMounted(() => {
    initializeSpeechRecognition()
  })

  onUnmounted(() => {
    cleanupSpeechRecognition()
  })

  return {isListening, toggleListening}
}
