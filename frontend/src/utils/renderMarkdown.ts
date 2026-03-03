import { marked } from 'marked'
import type { MarkedOptions } from 'marked'
import DOMPurify from 'dompurify'
import type { Config as DOMPurifyConfig } from 'dompurify'

// marked 解析選項（每次呼叫傳入，避免全域副作用）
const MARKED_OPTIONS: MarkedOptions = {
  breaks: true,
  gfm: true,
}

const ALLOWED_URI_REGEXP = /^(?:(?:(?:f|ht)tps?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i

const DOMPURIFY_CONFIG: DOMPurifyConfig = {
  ALLOWED_TAGS: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr',
    'strong', 'em', 'del', 'code', 'pre', 'span', 'sub', 'sup',
    'ul', 'ol', 'li',
    'blockquote',
    'a',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  ALLOWED_ATTR: ['href', 'title'],
  FORCE_BODY: true,
  ALLOWED_URI_REGEXP,
}

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

/**
 * 將 Markdown 字串轉為安全的 HTML
 * 使用 marked 解析 + DOMPurify 消毒，防止 XSS 攻擊
 */
export function renderMarkdown(raw: string | undefined): string {
  if (!raw || raw.trim().length === 0) return ''

  const html = marked.parse(raw, MARKED_OPTIONS) as unknown as string
  return DOMPurify.sanitize(html, DOMPURIFY_CONFIG) as unknown as string
}
