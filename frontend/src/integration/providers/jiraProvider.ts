import type { IntegrationApp, IntegrationProviderConfig } from '@/types/integration'
import JiraIcon from '@/components/icons/JiraIcon.vue'

const CONNECTION_STATUS_CONFIG: IntegrationProviderConfig['connectionStatusConfig'] = {
  connected: { dotClass: 'bg-green-500', bg: 'bg-white', label: '已連接' },
  disconnected: { dotClass: 'bg-red-500', bg: 'bg-red-100', label: '已斷線' },
  error: { dotClass: 'bg-red-500', bg: 'bg-red-100', label: '錯誤' },
}

function transformApp(rawApp: Record<string, unknown>): IntegrationApp {
  return {
    id: String(rawApp.id ?? ''),
    name: String(rawApp.name ?? ''),
    connectionStatus: (rawApp.connectionStatus as IntegrationApp['connectionStatus']) ?? 'disconnected',
    provider: 'jira',
    resources: [],
    raw: rawApp,
  }
}

export const jiraProviderConfig: IntegrationProviderConfig = {
  name: 'jira',
  label: 'Jira',
  icon: JiraIcon,
  description: '管理 Jira App 連線與設定',

  createFormFields: [
    {
      key: 'name',
      label: '名稱',
      placeholder: '例如：dcm',
      type: 'text',
      validate: (v): string => {
        if (v === '') return '名稱不可為空'
        if (!/^[a-zA-Z0-9_-]+$/.test(v)) return '名稱只允許英文字母、數字、底線與連字號'
        return ''
      },
    },
    {
      key: 'siteUrl',
      label: 'Site URL',
      placeholder: 'https://your-domain.atlassian.net',
      type: 'text',
      validate: (v): string => {
        if (v === '') return 'Site URL 不可為空'
        if (!v.startsWith('https://')) return 'Site URL 必須以 https:// 開頭'
        return ''
      },
    },
    {
      key: 'webhookSecret',
      label: 'Webhook Secret',
      placeholder: '用於驗證 Webhook 請求的密鑰',
      type: 'password',
      validate: (v): string => {
        if (v === '') return 'Webhook Secret 不可為空'
        if (v.length < 16) return 'Webhook Secret 至少需要 16 個字元'
        return ''
      },
    },
  ],

  resourceLabel: '',
  emptyResourceHint: '',
  emptyAppHint: '尚未註冊任何 Jira App',
  bindingExtraFields: undefined,

  connectionStatusConfig: CONNECTION_STATUS_CONFIG,

  hasNoResource: true,

  getWebhookUrl: (app) => window.location.origin + '/jira/events/' + app.name,

  transformApp,

  getResources: () => [],

  buildCreatePayload: (formValues) => ({
    name: formValues.name,
    config: {
      siteUrl: formValues.siteUrl,
      webhookSecret: formValues.webhookSecret,
    },
  }),

  buildDeletePayload: (appId) => ({ appId }),

  buildBindPayload: (appId) => ({ appId, resourceId: '*' }),
}
