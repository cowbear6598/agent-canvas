import type {Message, SubMessage, ToolUseInfo} from '@/types/chat'

function markToolCompleted(tool: ToolUseInfo): ToolUseInfo {
    return {...tool, status: 'completed'}
}

export function appendToolUseToLastSub(subMessages: SubMessage[], toolUseInfo: ToolUseInfo): SubMessage[] {
    const updated = [...subMessages]
    const lastIndex = updated.length - 1
    const lastSub = updated[lastIndex]
    if (!lastSub) return updated

    const subToolUse = lastSub.toolUse || []
    const exists = subToolUse.some(t => t.toolUseId === toolUseInfo.toolUseId)

    updated[lastIndex] = {
        ...lastSub,
        toolUse: exists ? subToolUse : [...subToolUse, toolUseInfo]
    }

    return updated
}

function appendNewSubMessage(subMessages: SubMessage[], messageId: string, delta: string, isPartial: boolean): SubMessage[] {
    const newSubMessage: SubMessage = {
        id: `${messageId}-sub-${subMessages.length}`,
        content: delta,
        isPartial
    }
    return [...subMessages, newSubMessage]
}

function updateLastSubMessage(subMessages: SubMessage[], content: string, isPartial: boolean): SubMessage[] {
    const updatedSubMessages = [...subMessages]
    const lastSubIndex = updatedSubMessages.length - 1
    if (lastSubIndex < 0) return updatedSubMessages

    const sumOfPreviousContents = updatedSubMessages
        .slice(0, lastSubIndex)
        .reduce((sum, sub) => sum + sub.content.length, 0)
    const lastSubContent = content.slice(sumOfPreviousContents)

    const lastSub = updatedSubMessages[lastSubIndex]
    if (!lastSub) return updatedSubMessages

    updatedSubMessages[lastSubIndex] = {
        ...lastSub,
        content: lastSubContent,
        isPartial
    }
    return updatedSubMessages
}

export function updateSubMessageContent(
    subMessages: SubMessage[],
    existingMessage: Message,
    delta: string,
    isPartial: boolean,
    content: string
): SubMessage[] {
    if (existingMessage.expectingNewBlock) {
        return appendNewSubMessage(subMessages, existingMessage.id, delta, isPartial)
    }

    return updateLastSubMessage(subMessages, content, isPartial)
}

export function updateAssistantSubMessages(
    existingMessage: Message,
    delta: string,
    isPartial: boolean,
    content: string
): Pick<Message, 'subMessages' | 'expectingNewBlock'> {
    const subMessages = updateSubMessageContent(
        existingMessage.subMessages!,
        existingMessage,
        delta,
        isPartial,
        content
    )
    const expectingNewBlock = existingMessage.expectingNewBlock ? false : undefined
    return { subMessages, expectingNewBlock }
}

function updateSingleSubToolUse(sub: SubMessage, toolUseId: string, output: string): SubMessage {
    if (!sub.toolUse) return sub

    const updatedSubToolUse = sub.toolUse.map(tool =>
        tool.toolUseId === toolUseId
            ? {...markToolCompleted(tool), output}
            : tool
    )

    const allToolsCompleted = updatedSubToolUse.every(
        tool => tool.status === 'completed' || tool.status === 'error'
    )

    return {
        ...sub,
        toolUse: updatedSubToolUse,
        ...(allToolsCompleted && { isPartial: false })
    }
}

export function updateSubMessagesToolUseResult(
    subMessages: SubMessage[],
    toolUseId: string,
    output: string
): SubMessage[] {
    return subMessages.map(sub => updateSingleSubToolUse(sub, toolUseId, output))
}

export function finalizeToolUse(toolUse: ToolUseInfo[] | undefined): ToolUseInfo[] | undefined {
    if (!toolUse || toolUse.length === 0) {
        return undefined
    }

    return toolUse.map(tool =>
        tool.status === 'running' ? markToolCompleted(tool) : tool
    )
}

function finalizeToolUseInSub(sub: SubMessage): SubMessage {
    const finalizedToolUse = finalizeToolUse(sub.toolUse)
    return {
        ...sub,
        isPartial: false,
        toolUse: finalizedToolUse,
    }
}

export function finalizeSubMessages(subMessages: SubMessage[] | undefined): SubMessage[] | undefined {
    if (!subMessages || subMessages.length === 0) {
        return undefined
    }

    return subMessages.map(sub => finalizeToolUseInSub(sub))
}

export function updateMainMessageState(
    message: Message,
    fullContent: string,
    updatedToolUse: ToolUseInfo[] | undefined,
    finalizedSubMessages: SubMessage[] | undefined
): Message {
    return {
        ...message,
        content: fullContent,
        isPartial: false,
        ...(updatedToolUse && {toolUse: updatedToolUse}),
        ...(finalizedSubMessages && {subMessages: finalizedSubMessages}),
        expectingNewBlock: undefined
    }
}
