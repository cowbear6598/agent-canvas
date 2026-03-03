import type {Message} from '@/types/chat'
import {abortSafetyTimers} from './abortSafetyTimers'

export function getMessages(store: { messagesByPodId: Map<string, Message[]> }, podId: string): Message[] {
    return store.messagesByPodId.get(podId) ?? []
}

export function findMessageIndex(messages: Message[], messageId: string): number {
    return messages.findIndex(message => message.id === messageId)
}

export function updateMessageInStore(
    store: { messagesByPodId: Map<string, Message[]> },
    podId: string,
    messages: Message[],
    messageIndex: number,
    updater: (message: Message) => Message
): void {
    const updatedMessages = [...messages]
    const message = updatedMessages[messageIndex]
    if (!message) return
    updatedMessages[messageIndex] = updater(message)
    store.messagesByPodId.set(podId, updatedMessages)
}

export function setTyping(store: { isTypingByPodId: Map<string, boolean> }, podId: string, isTyping: boolean): void {
    store.isTypingByPodId.set(podId, isTyping)

    if (!isTyping) {
        const timer = abortSafetyTimers.get(podId)
        if (timer) {
            clearTimeout(timer)
            abortSafetyTimers.delete(podId)
        }
    }
}
