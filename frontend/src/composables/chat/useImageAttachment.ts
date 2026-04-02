import type {Ref} from 'vue'
import {MAX_IMAGE_SIZE_BYTES, SUPPORTED_IMAGE_MEDIA_TYPES, MAX_IMAGES_PER_DROP} from '@/lib/constants'
import {useToast} from '@/composables/useToast'
import type {ImageMediaType} from '@/types/websocket/requests'
import {t} from '@/i18n'

export interface ImageAttachment {
  mediaType: ImageMediaType
  base64Data: string
}

export function useImageAttachment(options: {
  editableRef: Ref<HTMLDivElement | null>
  insertNodeAtCursor: (node: Node) => void
}): {
  imageDataMap: WeakMap<HTMLElement, ImageAttachment>
  isValidImageType: (fileType: string) => fileType is ImageMediaType
  insertImageAtCursor: (file: File) => Promise<void>
  findImageFile: (files: FileList | null) => File | undefined
  handleImagePaste: (imageFile: File) => Promise<void>
  handleDrop: (event: DragEvent) => Promise<void>
} {
  const {insertNodeAtCursor} = options
  const {toast} = useToast()

  const imageDataMap = new WeakMap<HTMLElement, ImageAttachment>()

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

  const readFileAsDataURL = (file: File): Promise<string | null> => {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = (event): void => {
        const result = event.target?.result
        resolve(typeof result === 'string' ? result : null)
      }
      reader.onerror = (): void => resolve(null)
      reader.readAsDataURL(file)
    })
  }

  const insertImageAtCursor = async (file: File): Promise<void> => {
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      toast({title: t('composable.chat.imageTooLarge')})
      return
    }

    if (!isValidImageType(file.type)) {
      toast({
        title: t('composable.chat.imageUnsupportedFormat'),
        description: t('composable.chat.imageUnsupportedFormatDesc'),
      })
      return
    }

    const result = await readFileAsDataURL(file)
    if (!result) {
      toast({title: t('composable.chat.imageReadFailed')})
      return
    }

    if (!/^data:image\/(jpeg|png|gif|webp);base64,/.test(result)) {
      toast({title: t('composable.chat.imageInvalidFormat')})
      return
    }

    const base64Data = result.split(',')[1]
    if (!base64Data) {
      toast({title: t('composable.chat.imageInvalidData')})
      return
    }

    const imageAtom = createImageAtom(file.type as ImageMediaType, base64Data)
    insertNodeAtCursor(imageAtom)
  }

  const findImageFile = (files: FileList | null): File | undefined => {
    if (!files || files.length === 0) return undefined
    return Array.from(files).find(file => file.type.startsWith('image/'))
  }

  const handleImagePaste = async (imageFile: File): Promise<void> => {
    await insertImageAtCursor(imageFile)
  }

  const handleDrop = async (event: DragEvent): Promise<void> => {
    event.preventDefault()

    const files = event.dataTransfer?.files
    if (!files || files.length === 0) return

    const imageFiles = Array.from(files).filter(file => isValidImageType(file.type))
    if (imageFiles.length > MAX_IMAGES_PER_DROP) {
      toast({title: t('composable.chat.uploadTooMany')})
    }

    const fileToInsert = imageFiles[0]
    if (!fileToInsert) return

    await insertImageAtCursor(fileToInsert)
  }

  return {
    imageDataMap,
    isValidImageType,
    insertImageAtCursor,
    findImageFile,
    handleImagePaste,
    handleDrop,
  }
}
