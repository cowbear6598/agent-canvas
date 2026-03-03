const MAX_ERROR_LENGTH = 200

const SENSITIVE_PATTERNS = [
  /[A-Za-z]:\\[\w\\.-]+/g,
  /\/[\w/.-]+/g,
  /[\w.-]+@[\w.-]+\.\w+/g,
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
  /[a-zA-Z0-9_-]{20,}/g,
  /at\s+[\w.]+\s+\([^)]+\)/g,
]

const ERROR_MAPPING: Record<string, string> = {
  'ECONNREFUSED': '無法連線到伺服器',
  'ENOTFOUND': '找不到伺服器',
  'ETIMEDOUT': '連線逾時',
  'ECONNRESET': '連線中斷',
  'ALREADY_EXISTS': '資源已存在',
  'NOT_FOUND': '找不到資源',
  'UNAUTHORIZED': '權限不足',
  'FORBIDDEN': '禁止存取',
  'INVALID_REQUEST': '請求格式錯誤',
  'INTERNAL_ERROR': '伺服器內部錯誤',
}

function removeSensitiveInfo(message: string): string {
  let sanitized = message

  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[已隱藏]')
  }

  return sanitized
}

function mapErrorCode(message: string): string {
  for (const [code, friendlyMessage] of Object.entries(ERROR_MAPPING)) {
    if (message.includes(code)) {
      return friendlyMessage
    }
  }

  return message
}

function limitLength(message: string, maxLength: number = MAX_ERROR_LENGTH): string {
  if (message.length <= maxLength) {
    return message
  }

  return message.substring(0, maxLength) + '...'
}

export function sanitizeErrorForUser(error: unknown): string {
  let message: string

  if (error instanceof Error) {
    message = error.message
  } else if (typeof error === 'string') {
    message = error
  } else if (error && typeof error === 'object' && 'message' in error) {
    message = String(error.message)
  } else {
    message = '未知錯誤'
  }

  message = mapErrorCode(message)
  message = removeSensitiveInfo(message)
  message = limitLength(message)

  return message
}
