import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { useSkillImport } from '@/composables/useSkillImport'
import { useSkillStore } from '@/stores/note/skillStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { setupTestPinia } from '../helpers/mockStoreFactory'

// Mock useToast
const mockShowSuccessToast = vi.fn()
const mockShowErrorToast = vi.fn()

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    showSuccessToast: mockShowSuccessToast,
    showErrorToast: mockShowErrorToast,
  }),
}))

describe('useSkillImport', () => {
  let mockFileInput: HTMLInputElement
  let mockFileReader: FileReader

  beforeEach(() => {
    const pinia = setupTestPinia({ stubActions: false })
    setActivePinia(pinia)

    vi.clearAllMocks()

    // Mock FileReader
    mockFileReader = {
      readAsDataURL: vi.fn(),
      result: '',
      onload: null,
      onerror: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      abort: vi.fn(),
      readyState: 0,
      error: null,
      onabort: null,
      onloadend: null,
      onloadstart: null,
      onprogress: null,
      readAsArrayBuffer: vi.fn(),
      readAsBinaryString: vi.fn(),
      readAsText: vi.fn(),
      dispatchEvent: vi.fn(),
      DONE: 2,
      EMPTY: 0,
      LOADING: 1,
    } as unknown as FileReader

    global.FileReader = vi.fn().mockImplementation(() => mockFileReader) as unknown as typeof FileReader

    // Mock document.createElement
    mockFileInput = {
      type: '',
      accept: '',
      click: vi.fn(),
      onchange: null,
      oncancel: null,
      files: null,
    } as unknown as HTMLInputElement

    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'input') {
        return mockFileInput
      }
      return document.createElement(tagName)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('完整匯入流程', () => {
    it('使用者取消選擇檔案時應不執行任何操作', async () => {
      const { importSkill } = useSkillImport()
      const skillStore = useSkillStore()
      const importSkillSpy = vi.spyOn(skillStore, 'importSkill')

      const importPromise = importSkill()

      mockFileInput.oncancel?.(new Event('cancel'))

      await importPromise

      expect(importSkillSpy).not.toHaveBeenCalled()
      expect(mockShowSuccessToast).not.toHaveBeenCalled()
      expect(mockShowErrorToast).not.toHaveBeenCalled()
    })
  })

  describe('檔案驗證', () => {
    const triggerFileSelection = (file: File): void => {
      Object.defineProperty(mockFileInput, 'files', {
        value: [file],
        writable: true,
        configurable: true,
      })
      const changeEvent = new Event('change')
      Object.defineProperty(changeEvent, 'target', { value: mockFileInput, writable: false })
      mockFileInput.onchange?.(changeEvent)
    }

    it('非 ZIP 副檔名應顯示錯誤', async () => {
      const { importSkill } = useSkillImport()

      const testFile = new File(['test'], 'test.txt', { type: 'text/plain' })
      const importPromise = importSkill()
      triggerFileSelection(testFile)
      await importPromise

      expect(mockShowErrorToast).toHaveBeenCalledWith(
        'Skill',
        '匯入失敗',
        '檔案格式錯誤，僅支援 ZIP 檔案'
      )
    })

    it('MIME type 不匹配應顯示錯誤', async () => {
      const { importSkill } = useSkillImport()

      const testFile = new File(['test'], 'test.zip', { type: 'text/plain' })
      const importPromise = importSkill()
      triggerFileSelection(testFile)
      await importPromise

      expect(mockShowErrorToast).toHaveBeenCalledWith(
        'Skill',
        '匯入失敗',
        '檔案格式錯誤，僅支援 ZIP 檔案'
      )
    })

    it('超過 5MB 應顯示錯誤', async () => {
      const { importSkill } = useSkillImport()

      const testFile = new File(['test'], 'test.zip', { type: 'application/zip' })
      Object.defineProperty(testFile, 'size', { value: 6 * 1024 * 1024 }) // 6MB

      const importPromise = importSkill()
      triggerFileSelection(testFile)
      await importPromise

      expect(mockShowErrorToast).toHaveBeenCalledWith(
        'Skill',
        '匯入失敗',
        '檔案大小超過 5MB 限制'
      )
    })

    it('應接受標準 ZIP 檔案', async () => {
      const { importSkill } = useSkillImport()

      const testFile = new File(['test content'], 'skill.zip', {
        type: 'application/zip',
      })
      Object.defineProperty(testFile, 'size', { value: 1024 })

      const importPromise = importSkill()
      triggerFileSelection(testFile)

      // 由於我們無法可靠地測試 FileReader 和後續流程
      // 我們只驗證檔案驗證通過（沒有立即顯示錯誤）
      await Promise.resolve()

      expect(mockShowErrorToast).not.toHaveBeenCalledWith(
        'Skill',
        '匯入失敗',
        expect.stringContaining('檔案格式錯誤')
      )
      expect(mockShowErrorToast).not.toHaveBeenCalledWith(
        'Skill',
        '匯入失敗',
        '檔案大小超過 5MB 限制'
      )
    })

    it('應接受 application/x-zip-compressed MIME type', async () => {
      const { importSkill } = useSkillImport()

      const testFile = new File(['test'], 'skill.zip', {
        type: 'application/x-zip-compressed',
      })
      Object.defineProperty(testFile, 'size', { value: 1024 })

      const importPromise = importSkill()
      triggerFileSelection(testFile)

      await Promise.resolve()

      expect(mockShowErrorToast).not.toHaveBeenCalledWith(
        'Skill',
        '匯入失敗',
        expect.stringContaining('檔案格式錯誤')
      )
    })

    it('應接受空的 MIME type', async () => {
      const { importSkill } = useSkillImport()

      const testFile = new File(['test'], 'skill.zip', { type: '' })
      Object.defineProperty(testFile, 'size', { value: 1024 })

      const importPromise = importSkill()
      triggerFileSelection(testFile)

      await Promise.resolve()

      expect(mockShowErrorToast).not.toHaveBeenCalledWith(
        'Skill',
        '匯入失敗',
        expect.stringContaining('檔案格式錯誤')
      )
    })
  })

  describe('isImporting 狀態管理', () => {
    it('初始值應為 false', () => {
      const { isImporting } = useSkillImport()
      expect(isImporting.value).toBe(false)
    })

    it('同一 composable 實例匯入完成後可再次匯入', async () => {
      const { importSkill, isImporting } = useSkillImport()

      const promise1 = importSkill()
      mockFileInput.oncancel?.(new Event('cancel'))
      await promise1

      expect(isImporting.value).toBe(false)

      const promise2 = importSkill()
      mockFileInput.oncancel?.(new Event('cancel'))
      await promise2

      expect(isImporting.value).toBe(false)
    })
  })
})
