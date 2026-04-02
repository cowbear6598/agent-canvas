import { ref, type Ref } from 'vue'
import { useSkillStore } from '@/stores/note/skillStore'
import { useToast } from '@/composables/useToast'
import { useWebSocketErrorHandler } from '@/composables/useWebSocketErrorHandler'
import { t } from '@/i18n'

const MAX_FILE_SIZE = 5 * 1024 * 1024
const ALLOWED_EXTENSIONS = ['.zip']

// 使用 t() 動態取得錯誤訊息



interface ValidationResult {
  valid: boolean
  error?: string
}

const validateFile = (file: File): ValidationResult => {
  const fileName = file.name.toLowerCase()
  const hasValidExtension = ALLOWED_EXTENSIONS.some(ext => fileName.endsWith(ext))

  if (!hasValidExtension) {
    return { valid: false, error: t('composable.skillImport.invalidFormat') }
  }

  if (file.type && !['application/zip', 'application/x-zip-compressed', ''].includes(file.type)) {
    return { valid: false, error: t('composable.skillImport.invalidFormat') }
  }

  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: t('composable.skillImport.fileTooLarge') }
  }

  return { valid: true }
}

const convertToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (): void => {
      const result = reader.result as string
      const parts = result.split(',')
      const base64Data = parts.length > 1 ? parts[1] : result
      if (!base64Data) {
        reject(new Error(t('composable.skillImport.base64Failed')))
        return
      }
      resolve(base64Data)
    }

    reader.onerror = (): void => {
      reject(new Error(t('composable.skillImport.networkFailed')))
    }

    reader.readAsDataURL(file)
  })
}

const openFilePicker = (): Promise<File | null> => {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.zip,application/zip'

    input.onchange = (changeEvent: Event): void => {
      const target = changeEvent.target as HTMLInputElement
      const file = target.files?.[0]
      resolve(file || null)
    }

    input.oncancel = (): void => {
      resolve(null)
    }

    input.click()
  })
}

interface UseSkillImportReturn {
  importSkill: () => Promise<void>
  isImporting: Ref<boolean>
}

export function useSkillImport(): UseSkillImportReturn {
  const skillStore = useSkillStore()
  const { showSuccessToast, showErrorToast } = useToast()
  const { withErrorToast } = useWebSocketErrorHandler()
  const isImporting = ref(false)

  const importSkill = async (): Promise<void> => {
    if (isImporting.value) return

    const file = await openFilePicker()
    if (!file) return

    const validation = validateFile(file)
    if (!validation.valid) {
      showErrorToast('Skill', t('composable.skillImport.importFailed'), validation.error)
      return
    }

    isImporting.value = true

    const runImport = async (): Promise<void> => {
      const fileData = await convertToBase64(file)
      const result = await skillStore.importSkill(file.name, fileData, file.size)

      if (!result.success) {
        throw new Error(result.error ?? t('common.error.unknown'))
      }

      const skillName = result.skill?.name ?? file.name
      const toastMsg = result.isOverwrite ? t('composable.skillImport.importSuccessOverwrite') : t('composable.skillImport.importSuccess')
      showSuccessToast('Skill', toastMsg, skillName)
    }

    await withErrorToast(runImport(), 'Skill', t('composable.skillImport.importFailed'))

    isImporting.value = false
  }

  return {
    importSkill,
    isImporting
  }
}
