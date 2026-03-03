<script setup lang="ts">
import { watch } from 'vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { McpServerConfig } from '@/types'
import { useModalForm } from '@/composables/useModalForm'
import { RESOURCE_NAME_PATTERN } from '@/lib/validators'

interface Props {
  open: boolean
  mode: 'create' | 'edit'
  initialName?: string
  initialConfig?: McpServerConfig
}

const props = withDefaults(defineProps<Props>(), {
  initialName: undefined,
  initialConfig: undefined,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  'submit': [payload: { name: string; config: McpServerConfig }]
}>()

const jsonPlaceholder = '{"my-mcp-server": {"command": "npx", "args": ["-y", "my-mcp"]}}'

const validateMcpServerName = (parsed: Record<string, unknown>): string | null => {
  const keys = Object.keys(parsed)
  if (keys.length === 0) return '請輸入至少一個 MCP Server 設定'

  const name = keys[0] as string
  if (!RESOURCE_NAME_PATTERN.test(name)) return '名稱只能包含英數字、底線和連字號'

  return null
}

const validateMcpServerMode = (config: Record<string, unknown>): string | null => {
  const isStdioMode = typeof config.command === 'string'
  const isHttpMode = typeof config.type === 'string' && typeof config.url === 'string'

  if (!isStdioMode && !isHttpMode) {
    return '設定必須包含 command 欄位（stdio 模式）或 type + url 欄位（http/sse 模式）'
  }

  return null
}

const validateStdioConfig = (config: Record<string, unknown>): string | null => {
  if (typeof config.command !== 'string') return null
  if (config.command.trim() === '') return 'command 欄位不能為空'

  return null
}

const validateHttpConfig = (config: Record<string, unknown>): string | null => {
  const isHttpMode = typeof config.type === 'string' && typeof config.url === 'string'
  if (!isHttpMode) return null

  if (!URL.canParse(config.url as string)) {
    return 'url 欄位格式不正確'
  }

  return null
}

const validateArgs = (config: Record<string, unknown>): string | null => {
  if (config.args === undefined) return null

  const isValidArgs =
    Array.isArray(config.args) && config.args.every((arg) => typeof arg === 'string')
  if (!isValidArgs) return 'args 欄位必須是字串陣列'

  return null
}

const parseAndValidateJson = (jsonText: string): string | null => {
  let parsed: Record<string, unknown>

  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>
  } catch {
    return 'JSON 格式錯誤，請檢查語法'
  }

  const nameError = validateMcpServerName(parsed)
  if (nameError) return nameError

  const name = Object.keys(parsed)[0] as string
  const config = parsed[name] as Record<string, unknown>

  return (
    validateMcpServerMode(config) ??
    validateStdioConfig(config) ??
    validateHttpConfig(config) ??
    validateArgs(config)
  )
}

const { inputValue: jsonText, errorMessage, handleSubmit, handleClose, resetForm } = useModalForm<string>({
  validator: parseAndValidateJson,
  onSubmit: async (text) => {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const name = Object.keys(parsed)[0] as string
    const config = parsed[name] as McpServerConfig
    emit('submit', { name, config })
    return null
  },
  onClose: () => emit('update:open', false),
})

watch(
  () => props.open,
  (newOpen) => {
    if (newOpen) {
      if (props.mode === 'edit' && props.initialName && props.initialConfig) {
        jsonText.value = JSON.stringify({ [props.initialName]: props.initialConfig }, null, 2)
      } else {
        resetForm()
      }
    }
  }
)
</script>

<template>
  <Dialog
    :open="open"
    @update:open="handleClose"
  >
    <DialogContent class="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{{ mode === 'create' ? '新增 MCP Server' : '編輯 MCP Server' }}</DialogTitle>
        <DialogDescription>
          請貼入 JSON 格式的 MCP Server 設定，第一個 key 為名稱，value 為設定內容
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4">
        <textarea
          v-model="jsonText"
          :placeholder="jsonPlaceholder"
          class="w-full h-[300px] p-3 bg-card border-2 border-doodle-ink rounded text-base font-mono resize-none focus:outline-none focus:ring-2 focus:ring-doodle-ink/50 doodle-textarea"
        />

        <p
          v-if="errorMessage"
          class="text-sm text-red-500 font-mono"
        >
          {{ errorMessage }}
        </p>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          @click="handleClose"
        >
          取消
        </Button>
        <Button
          variant="default"
          @click="handleSubmit"
        >
          {{ mode === 'create' ? '建立' : '儲存' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
