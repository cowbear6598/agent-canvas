import { describe, it, expect } from 'vitest'
import { getProvider, getAllProviders, registerProvider, findProvider } from '@/integration/providerRegistry'
import type { IntegrationProviderConfig } from '@/types/integration'
import { defineComponent } from 'vue'

const mockIcon = defineComponent({ template: '<svg />' })

function makeMockProvider(name: string): IntegrationProviderConfig {
  return {
    name,
    label: name,
    icon: mockIcon,
    description: `${name} 描述`,
    createFormFields: [],
    resourceLabel: '資源',
    emptyResourceHint: '無資源',
    emptyAppHint: '無 App',
    connectionStatusConfig: {
      connected: { dotClass: 'bg-green-500', bg: 'bg-white', label: '已連接' },
      disconnected: { dotClass: 'bg-red-500', bg: 'bg-red-100', label: '已斷線' },
      error: { dotClass: 'bg-red-500', bg: 'bg-red-100', label: '錯誤' },
    },
    transformApp: (raw) => ({
      id: String(raw.id ?? ''),
      name: String(raw.name ?? ''),
      connectionStatus: 'disconnected',
      provider: name,
      resources: [],
      raw,
    }),
    getResources: (app) => app.resources,
    buildCreatePayload: (formValues) => formValues,
    buildDeletePayload: (appId) => ({ appId }),
    buildBindPayload: (appId, resourceId) => ({ appId, resourceId }),
  }
}

describe('providerRegistry', () => {
  describe('getProvider', () => {
    it('內建三個 provider 都可以正確取得', () => {
      expect(getProvider('slack').name).toBe('slack')
      expect(getProvider('telegram').name).toBe('telegram')
      expect(getProvider('jira').name).toBe('jira')
    })

    it('取得不存在的 provider 時拋出錯誤', () => {
      expect(() => getProvider('unknown-provider')).toThrow('找不到 Provider：unknown-provider')
    })
  })

  describe('getAllProviders', () => {
    it('回傳所有已註冊的 provider', () => {
      const providers = getAllProviders()
      const names = providers.map((p) => p.name)
      expect(names).toContain('slack')
      expect(names).toContain('telegram')
      expect(names).toContain('jira')
    })
  })

  describe('findProvider', () => {
    it('傳入已存在的 provider name 時回傳 config（非 null）', () => {
      const result = findProvider('slack')
      expect(result).not.toBeNull()
      expect(result?.name).toBe('slack')
    })

    it('傳入不存在的 provider name 時回傳 null，不拋例外', () => {
      expect(() => findProvider('not-exist-provider')).not.toThrow()
      expect(findProvider('not-exist-provider')).toBeNull()
    })
  })

  describe('registerProvider', () => {
    it('註冊新 provider 後可以正確取得', () => {
      const mockProvider = makeMockProvider('test-provider-unique')
      registerProvider(mockProvider)

      const retrieved = getProvider('test-provider-unique')
      expect(retrieved.name).toBe('test-provider-unique')
      expect(retrieved.label).toBe('test-provider-unique')
    })

    it('重複註冊相同 name 會覆蓋舊的設定', () => {
      const original = makeMockProvider('overwrite-test')
      const updated = { ...makeMockProvider('overwrite-test'), label: '已更新' }

      registerProvider(original)
      registerProvider(updated)

      expect(getProvider('overwrite-test').label).toBe('已更新')
    })
  })

  describe('slackProvider config', () => {
    it('label 為 Slack', () => {
      expect(getProvider('slack').label).toBe('Slack')
    })

    it('createFormFields 有三個欄位', () => {
      expect(getProvider('slack').createFormFields).toHaveLength(3)
    })

    it('botToken 驗證：空值回傳錯誤', () => {
      const field = getProvider('slack').createFormFields.find((f) => f.key === 'botToken')!
      expect(field.validate('')).toBe('Bot Token 不可為空')
    })

    it('botToken 驗證：不以 xoxb- 開頭回傳錯誤', () => {
      const field = getProvider('slack').createFormFields.find((f) => f.key === 'botToken')!
      expect(field.validate('invalid-token')).toBe('Bot Token 必須以 xoxb- 開頭')
    })

    it('botToken 驗證：正確格式回傳空字串', () => {
      const field = getProvider('slack').createFormFields.find((f) => f.key === 'botToken')!
      expect(field.validate('xoxb-abc123')).toBe('')
    })

    it('transformApp 正確轉換 resources', () => {
      const config = getProvider('slack')
      const app = config.transformApp({
        id: 'app-1',
        name: 'My Slack',
        connectionStatus: 'connected',
        resources: [{ id: 'C001', name: 'general' }],
      })
      expect(app.provider).toBe('slack')
      expect(app.resources).toEqual([{ id: 'C001', label: '#general' }])
    })

    it('buildCreatePayload 組合正確的 payload，憑證放在 config 欄位內', () => {
      const config = getProvider('slack')
      const payload = config.buildCreatePayload({
        name: 'Test',
        botToken: 'xoxb-123',
        signingSecret: 'secret',
      })
      expect(payload).toEqual({
        name: 'Test',
        config: {
          botToken: 'xoxb-123',
          signingSecret: 'secret',
        },
      })
    })

    it('buildDeletePayload 使用 appId', () => {
      const payload = getProvider('slack').buildDeletePayload('app-123')
      expect(payload).toEqual({ appId: 'app-123' })
    })

    it('buildBindPayload 組合 appId 和 resourceId', () => {
      const payload = getProvider('slack').buildBindPayload('app-1', 'C001', {})
      expect(payload).toEqual({ appId: 'app-1', resourceId: 'C001' })
    })
  })

  describe('telegramProvider config', () => {
    it('label 為 Telegram', () => {
      expect(getProvider('telegram').label).toBe('Telegram')
    })

    it('createFormFields 有兩個欄位', () => {
      expect(getProvider('telegram').createFormFields).toHaveLength(2)
    })

    it('bindingExtraFields 為空陣列（不需要選擇模式）', () => {
      const config = getProvider('telegram')
      const fields = config.bindingExtraFields ?? []
      expect(fields).toHaveLength(0)
    })

    it('hasManualResourceInput 永遠回傳 true', () => {
      const config = getProvider('telegram')
      expect(config.hasManualResourceInput?.({})).toBe(true)
      expect(config.hasManualResourceInput?.({ chatType: 'private' })).toBe(true)
    })

    it('manualResourceInputConfig 的 validate：空字串回傳錯誤', () => {
      const config = getProvider('telegram')
      expect(config.manualResourceInputConfig!.validate('')).toBe('User ID 必須為正整數')
    })

    it('manualResourceInputConfig 的 validate：負數回傳錯誤', () => {
      const config = getProvider('telegram')
      expect(config.manualResourceInputConfig!.validate('-1')).toBe('User ID 必須為正整數')
    })

    it('manualResourceInputConfig 的 validate：正整數回傳空字串', () => {
      const config = getProvider('telegram')
      expect(config.manualResourceInputConfig!.validate('12345')).toBe('')
    })

    it('transformApp 回傳空的 resources（私聊模式不需要資源列表）', () => {
      const config = getProvider('telegram')
      const app = config.transformApp({
        id: 'bot-1',
        name: 'My Bot',
        connectionStatus: 'connected',
        botUsername: 'mybot',
      })
      expect(app.resources).toHaveLength(0)
    })

    it('buildCreatePayload 組合正確的 payload，憑證放在 config 欄位內', () => {
      const config = getProvider('telegram')
      const payload = config.buildCreatePayload({
        name: 'My Bot',
        botToken: '123456:ABC-DEF',
      })
      expect(payload).toEqual({
        name: 'My Bot',
        config: {
          botToken: '123456:ABC-DEF',
        },
      })
    })

    it('buildBindPayload 固定帶上 extra.chatType = private', () => {
      const payload = getProvider('telegram').buildBindPayload('bot-1', '12345', {})
      expect(payload).toEqual({ appId: 'bot-1', resourceId: '12345', extra: { chatType: 'private' } })
    })
  })

  describe('jiraProvider config', () => {
    it('label 為 Jira', () => {
      expect(getProvider('jira').label).toBe('Jira')
    })

    it('createFormFields 有三個欄位', () => {
      expect(getProvider('jira').createFormFields).toHaveLength(3)
    })

    it('createFormFields 包含 name、siteUrl、webhookSecret', () => {
      const keys = getProvider('jira').createFormFields.map((f) => f.key)
      expect(keys).toEqual(['name', 'siteUrl', 'webhookSecret'])
    })

    it('name 驗證：空值回傳錯誤', () => {
      const field = getProvider('jira').createFormFields.find((f) => f.key === 'name')!
      expect(field.validate('')).toBe('名稱不可為空')
    })

    it('name 驗證：含不合法字元回傳錯誤', () => {
      const field = getProvider('jira').createFormFields.find((f) => f.key === 'name')!
      expect(field.validate('my app!')).toBe('名稱只允許英文字母、數字、底線與連字號')
    })

    it('name 驗證：合法 URL 安全字元回傳空字串', () => {
      const field = getProvider('jira').createFormFields.find((f) => f.key === 'name')!
      expect(field.validate('dcm-app_01')).toBe('')
    })

    it('siteUrl 驗證：不以 https:// 開頭回傳錯誤', () => {
      const field = getProvider('jira').createFormFields.find((f) => f.key === 'siteUrl')!
      expect(field.validate('http://example.com')).toBe('Site URL 必須以 https:// 開頭')
    })

    it('siteUrl 驗證：正確格式回傳空字串', () => {
      const field = getProvider('jira').createFormFields.find((f) => f.key === 'siteUrl')!
      expect(field.validate('https://example.atlassian.net')).toBe('')
    })

    it('transformApp 回傳空 resources', () => {
      const config = getProvider('jira')
      const app = config.transformApp({
        id: 'app-1',
        name: 'My Jira',
        connectionStatus: 'connected',
        resources: [{ id: 'PROJ', name: 'Project Alpha' }],
      })
      expect(app.provider).toBe('jira')
      expect(app.resources).toEqual([])
    })

    it('buildCreatePayload 包含 name 和 config: { siteUrl, webhookSecret }', () => {
      const config = getProvider('jira')
      const payload = config.buildCreatePayload({
        name: 'Test',
        siteUrl: 'https://test.atlassian.net',
        webhookSecret: 'secret123',
      })
      expect(payload).toEqual({
        name: 'Test',
        config: {
          siteUrl: 'https://test.atlassian.net',
          webhookSecret: 'secret123',
        },
      })
    })

    it('buildDeletePayload 使用 appId', () => {
      const payload = getProvider('jira').buildDeletePayload('app-456')
      expect(payload).toEqual({ appId: 'app-456' })
    })

    it('buildBindPayload 固定回傳 resourceId: *', () => {
      const payload = getProvider('jira').buildBindPayload('app-1', 'PROJ', {})
      expect(payload).toEqual({ appId: 'app-1', resourceId: '*' })
    })

    it('hasNoResource 為 true', () => {
      expect(getProvider('jira').hasNoResource).toBe(true)
    })

    it('getWebhookUrl 組合 window.location.origin 和 app.name', () => {
      const config = getProvider('jira')
      const app = config.transformApp({ id: 'app-1', name: 'dcm', connectionStatus: 'connected' })
      const url = config.getWebhookUrl!(app)
      expect(url).toBe(window.location.origin + '/jira/events/dcm')
    })
  })
})
