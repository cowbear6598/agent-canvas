import {generateRequestId} from '@/services/utils'
import {usePodStore} from '../pod/podStore'
import type {Pod} from '@/types/pod'
import type {Message, SubMessage, ToolUseInfo} from '@/types/chat'
import {isValidToolUseStatus} from '@/types/chat'
import type {
    PersistedMessage,
    PodChatAbortedPayload,
    PodChatCompletePayload,
    PodChatMessagePayload,
    PodChatToolResultPayload,
    PodChatToolUsePayload,
    PodMessagesClearedPayload,
    WorkflowAutoClearedPayload
} from '@/types/websocket'
import {CONTENT_PREVIEW_LENGTH} from '@/lib/constants'
import {truncateContent} from './chatUtils'
import type {ChatStoreInstance} from './chatStore'
import {updateAssistantSubMessages} from './subMessageHelpers'
import {createToolTrackingActions} from './toolTrackingActions'
import {createMessageCompletionActions} from './messageCompletionActions'
import {getMessages, findMessageIndex, setTyping} from './chatStoreHelpers'

function collectToolUseFromSubMessages(subMessages: PersistedMessage['subMessages']): ToolUseInfo[] {
    if (!subMessages) return []
    return subMessages.flatMap(sub =>
        (sub.toolUse ?? []).map(tool => ({
            toolUseId: tool.toolUseId,
            toolName: tool.toolName,
            input: tool.input,
            output: tool.output,
            status: isValidToolUseStatus(tool.status) ? tool.status : 'completed',
        }))
    )
}

function appendUserOutputToPod(pod: Pod, content: string): void {
    const podStore = usePodStore()
    const truncatedContent = `> ${truncateContent(content, CONTENT_PREVIEW_LENGTH)}`
    const lastOutput = pod.output[pod.output.length - 1]
    if (lastOutput === truncatedContent) return

    podStore.updatePod({
        ...pod,
        output: [...pod.output, truncatedContent]
    })
}

export function createAssistantMessageShape(messageId: string, content: string, isPartial: boolean, delta?: string): Partial<Message> {
    const firstSubMessage: SubMessage = {
        id: `${messageId}-sub-0`,
        content: delta || content,
        isPartial
    }
    return {
        subMessages: [firstSubMessage],
        expectingNewBlock: true
    }
}

export interface ChatMessageActions {
    addUserMessage: (podId: string, content: string) => Promise<void>
    handleChatMessage: (payload: PodChatMessagePayload) => void
    addNewChatMessage: (podId: string, messageId: string, content: string, isPartial: boolean, role?: 'user' | 'assistant', delta?: string) => Promise<void>
    updateExistingChatMessage: (podId: string, messages: Message[], messageIndex: number, content: string, isPartial: boolean, delta: string) => void
    handleChatToolUse: (payload: PodChatToolUsePayload) => void
    createMessageWithToolUse: (podId: string, messageId: string, toolUseId: string, toolName: string, input: Record<string, unknown>) => void
    addToolUseToMessage: (podId: string, messages: Message[], messageIndex: number, toolUseId: string, toolName: string, input: Record<string, unknown>) => void
    handleChatToolResult: (payload: PodChatToolResultPayload) => void
    updateToolUseResult: (podId: string, messages: Message[], messageIndex: number, toolUseId: string, output: string) => void
    handleChatComplete: (payload: PodChatCompletePayload) => void
    handleChatAborted: (payload: PodChatAbortedPayload) => void
    finalizeStreaming: (podId: string, messageId: string) => void
    completeMessage: (podId: string, messages: Message[], messageIndex: number, fullContent: string, messageId: string) => void
    updatePodOutput: (podId: string) => Promise<void>
    convertPersistedToMessage: (persistedMessage: PersistedMessage) => Message
    setPodMessages: (podId: string, messages: Message[]) => void
    setTyping: (podId: string, isTyping: boolean) => void
    clearMessagesByPodIds: (podIds: string[]) => void
    handleMessagesClearedEvent: (payload: PodMessagesClearedPayload) => Promise<void>
    handleWorkflowAutoCleared: (payload: WorkflowAutoClearedPayload) => Promise<void>
}

export function createMessageActions(store: ChatStoreInstance): ChatMessageActions {
    const toolTrackingActions = createToolTrackingActions(store)
    const messageCompletionActions = createMessageCompletionActions(store, (podId, isTyping) => setTyping(store, podId, isTyping))

    const addUserMessage = async (podId: string, content: string): Promise<void> => {
        const podStore = usePodStore()
        const pod = podStore.pods.find(p => p.id === podId)
        if (!pod) return

        const userMessage: Message = {
            id: generateRequestId(),
            role: 'user',
            content,
            timestamp: new Date().toISOString()
        }

        const messages = getMessages(store, podId)
        store.messagesByPodId.set(podId, [...messages, userMessage])

        appendUserOutputToPod(pod, content)
    }

    const handleChatMessage = (payload: PodChatMessagePayload): void => {
        const {podId, messageId, content, isPartial, role} = payload
        const messages = getMessages(store, podId)
        const messageIndex = findMessageIndex(messages, messageId)

        const lastLength = store.accumulatedLengthByMessageId.get(messageId) || 0
        const delta = content.slice(lastLength)
        store.accumulatedLengthByMessageId.set(messageId, content.length)

        if (messageIndex === -1) {
            addNewChatMessage(podId, messageId, content, isPartial, role, delta)
            return
        }

        updateExistingChatMessage(podId, messages, messageIndex, content, isPartial, delta)
    }

    const addNewChatMessage = async (podId: string, messageId: string, content: string, isPartial: boolean, role?: 'user' | 'assistant', delta?: string): Promise<void> => {
        const messages = getMessages(store, podId)
        const effectiveRole = role ?? 'assistant'

        const baseMessage: Message = {
            id: messageId,
            role: effectiveRole,
            content,
            isPartial,
            timestamp: new Date().toISOString()
        }

        const shape = effectiveRole === 'assistant'
            ? createAssistantMessageShape(messageId, content, isPartial, delta)
            : {}

        const newMessage: Message = { ...baseMessage, ...shape }

        store.messagesByPodId.set(podId, [...messages, newMessage])
        store.currentStreamingMessageId = messageId

        if (isPartial) {
            setTyping(store, podId, true)
        }

        if (effectiveRole === 'user') {
            const podStore = usePodStore()
            const pod = podStore.pods.find(p => p.id === podId)
            if (pod) {
                appendUserOutputToPod(pod, content)
            }
        }
    }

    const updateExistingChatMessage = (podId: string, messages: Message[], messageIndex: number, content: string, isPartial: boolean, delta: string): void => {
        const updatedMessages = [...messages]
        const existingMessage = updatedMessages[messageIndex]

        if (!existingMessage) return

        updatedMessages[messageIndex] = {
            ...existingMessage,
            content,
            isPartial
        }

        if (existingMessage.role === 'assistant' && existingMessage.subMessages) {
            Object.assign(updatedMessages[messageIndex], updateAssistantSubMessages(existingMessage, delta, isPartial, content))
        }

        store.messagesByPodId.set(podId, updatedMessages)

        if (isPartial) {
            setTyping(store, podId, true)
        }
    }

    const convertSubMessages = (persistedMessage: PersistedMessage): Pick<Message, 'subMessages' | 'toolUse'> => {
        if (!persistedMessage.subMessages || persistedMessage.subMessages.length === 0) {
            return {
                subMessages: [{
                    id: `${persistedMessage.id}-sub-0`,
                    content: persistedMessage.content,
                    isPartial: false
                }]
            }
        }

        const allToolUse = collectToolUseFromSubMessages(persistedMessage.subMessages)

        // 確保歷史載入後 tool 標籤位置與即時串流一致
        return {
            subMessages: persistedMessage.subMessages.map((sub, index) => ({
                id: sub.id,
                content: sub.content,
                isPartial: false,
                toolUse: index === 0 && allToolUse.length > 0 ? allToolUse : undefined,
            })),
            ...(allToolUse.length > 0 && { toolUse: allToolUse })
        }
    }

    const convertPersistedToMessage = (persistedMessage: PersistedMessage): Message => {
        const message: Message = {
            id: persistedMessage.id,
            role: persistedMessage.role,
            content: persistedMessage.content,
            timestamp: persistedMessage.timestamp,
            isPartial: false
        }

        if (persistedMessage.role !== 'assistant') return message

        return { ...message, ...convertSubMessages(persistedMessage) }
    }

    const setPodMessages = (podId: string, messages: Message[]): void => {
        store.messagesByPodId.set(podId, messages)
    }

    const clearMessagesByPodIds = (podIds: string[]): void => {
        podIds.forEach(podId => {
            store.messagesByPodId.delete(podId)
            store.isTypingByPodId.delete(podId)
        })
    }

    const handleMessagesClearedEvent = async (payload: PodMessagesClearedPayload): Promise<void> => {
        clearMessagesByPodIds([payload.podId])

        const podStore = usePodStore()
        podStore.clearPodOutputsByIds([payload.podId])
    }

    const handleWorkflowAutoCleared = async (payload: WorkflowAutoClearedPayload): Promise<void> => {
        clearMessagesByPodIds(payload.clearedPodIds)

        const podStore = usePodStore()
        podStore.clearPodOutputsByIds(payload.clearedPodIds)

        store.autoClearAnimationPodId = payload.sourcePodId
    }

    const boundSetTyping = (podId: string, isTyping: boolean): void => setTyping(store, podId, isTyping)

    return {
        addUserMessage,
        handleChatMessage,
        addNewChatMessage,
        updateExistingChatMessage,
        ...toolTrackingActions,
        ...messageCompletionActions,
        convertPersistedToMessage,
        setPodMessages,
        setTyping: boundSetTyping,
        clearMessagesByPodIds,
        handleMessagesClearedEvent,
        handleWorkflowAutoCleared
    }
}
