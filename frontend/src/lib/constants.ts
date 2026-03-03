export const POD_MENU_X_OFFSET = 112
export const POD_MENU_Y_OFFSET = 50
export const HEADER_HEIGHT = 64

export const MAX_MESSAGE_LENGTH = 1000
export const CONTENT_PREVIEW_LENGTH = 30
export const RESPONSE_PREVIEW_LENGTH = 40

export const TEXTAREA_MAX_LINES = 5
export const TEXTAREA_LINE_HEIGHT = 20
export const TEXTAREA_PADDING = 24
export const TEXTAREA_MAX_HEIGHT = TEXTAREA_MAX_LINES * TEXTAREA_LINE_HEIGHT + TEXTAREA_PADDING

export const OUTPUT_LINES_PREVIEW_COUNT = 4
export const DEFAULT_POD_ROTATION_RANGE = 2
export const MAX_POD_NAME_LENGTH = 50

export const MOUSE_BUTTON = { LEFT: 0, MIDDLE: 1, RIGHT: 2 } as const

export const GRID_SIZE = 20

export const POD_WIDTH = 224
export const POD_HEIGHT = 168

export const NOTE_WIDTH = 80
export const NOTE_HEIGHT = 30

export const PASTE_TIMEOUT_MS = 10000

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024
export const SUPPORTED_IMAGE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
export const MAX_IMAGES_PER_DROP = 1
