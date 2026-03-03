import type {Pod, PodStatus} from '../pod'
import type {SlackApp, SlackChannel, SlackAppConnectionStatus} from '../slack'
import type {OutputStyleNote} from '@/types'
import type {SkillNote} from '@/types'
import type {Repository, RepositoryNote} from '@/types'
import type {SubAgentNote} from '@/types'
import type {CommandNote} from '@/types'
import type {AnchorPosition} from '@/types'
import type {McpServerConfig} from '../mcpServer'
import type {ResultPayload} from './index'

export interface ConnectionReadyPayload {
    socketId: string
}

export interface PodCreatedPayload extends ResultPayload {
    pod?: Pod
}

export interface PodListResultPayload extends ResultPayload {
    pods?: Pod[]
}

export interface PodMovedPayload extends ResultPayload {
    pod?: Pod
}

export interface PodRenamedPayload extends ResultPayload {
    pod?: Pod
}

export interface PodModelSetPayload extends ResultPayload {
    pod?: Pod
}

export interface PodScheduleSetPayload extends ResultPayload {
    pod?: Pod
}

export interface PodDeletedPayload extends ResultPayload {
    podId?: string
    deletedNoteIds?: {
        note?: string[]
        skillNote?: string[]
        repositoryNote?: string[]
        commandNote?: string[]
        subAgentNote?: string[]
        mcpServerNote?: string[]
    }
}

export interface PodChatMessagePayload {
    podId: string
    messageId: string
    content: string
    isPartial: boolean
    role?: 'user' | 'assistant'
}

export interface PodChatToolUsePayload {
    podId: string
    messageId: string
    toolUseId: string
    toolName: string
    input: Record<string, unknown>
}

export interface PodChatToolResultPayload {
    podId: string
    messageId: string
    toolUseId: string
    toolName: string
    output: string
}

export interface PodChatCompletePayload {
    podId: string
    messageId: string
    fullContent: string
}

export interface PodChatAbortedPayload {
    podId: string
    messageId: string
}

export interface PodErrorPayload {
    requestId?: string
    podId?: string
    error: string
    code: string
}

export interface PodStatusChangedPayload {
    podId: string
    status: PodStatus
    previousStatus: PodStatus
}

export interface PersistedMessage {
    id: string
    role: 'user' | 'assistant'
    content: string
    timestamp: string
    subMessages?: Array<{
        id: string
        content: string
        toolUse?: Array<{
            toolUseId: string
            toolName: string
            input: Record<string, unknown>
            output?: string
            status: string
        }>
    }>
}

export interface PodChatHistoryResultPayload extends ResultPayload {
    messages?: PersistedMessage[]
}

export interface OutputStyleCreatedPayload {
    requestId: string
    success: boolean
    outputStyle?: { id: string; name: string }
    error?: string
}

export interface OutputStyleUpdatedPayload {
    requestId: string
    success: boolean
    outputStyle?: { id: string; name: string }
    error?: string
}

export interface OutputStyleReadResultPayload {
    requestId: string
    success: boolean
    outputStyle?: { id: string; name: string; content: string }
    error?: string
}

export interface NoteCreatedPayload extends ResultPayload {
    note?: OutputStyleNote
}

export interface ConnectionCreatedPayload extends ResultPayload {
    connection?: {
        id: string
        sourcePodId?: string
        sourceAnchor: AnchorPosition
        targetPodId: string
        targetAnchor: AnchorPosition
        triggerMode?: 'auto' | 'ai-decide' | 'direct'
        decideStatus?: 'none' | 'pending' | 'approved' | 'rejected' | 'error'
        connectionStatus?: 'idle' | 'active' | 'queued' | 'waiting' | 'ai-deciding' | 'ai-approved' | 'ai-rejected' | 'ai-error'
        decideReason?: string | null
    }
}

export interface ConnectionListResultPayload extends ResultPayload {
    connections?: Array<{
        id: string
        sourcePodId?: string
        sourceAnchor: AnchorPosition
        targetPodId: string
        targetAnchor: AnchorPosition
        triggerMode?: 'auto' | 'ai-decide' | 'direct'
        decideStatus?: 'none' | 'pending' | 'approved' | 'rejected' | 'error'
        connectionStatus?: 'idle' | 'active' | 'queued' | 'waiting' | 'ai-deciding' | 'ai-approved' | 'ai-rejected' | 'ai-error'
        decideReason?: string | null
    }>
}

export interface ConnectionDeletedPayload extends ResultPayload {
    connectionId?: string
}

export interface WorkflowAutoTriggeredPayload {
    connectionId: string
    sourcePodId: string
    targetPodId: string
    transferredContent: string
    isSummarized: boolean
}

export interface WorkflowCompletePayload extends ResultPayload {
    connectionId: string
    targetPodId: string
    triggerMode?: 'auto' | 'ai-decide' | 'direct'
}

export interface WorkflowGetDownstreamPodsResultPayload {
    requestId: string
    success: boolean
    pods?: Array<{ id: string; name: string }>
    error?: string
}

export interface WorkflowClearResultPayload extends ResultPayload {
    clearedPodIds?: string[]
    clearedPodNames?: string[]
}

export interface PasteError {
    type: 'pod' | 'outputStyleNote' | 'skillNote' | 'repositoryNote' | 'subAgentNote' | 'commandNote'
    originalId: string
    error: string
}

export interface CanvasPasteResultPayload extends ResultPayload {
    createdPods: Pod[]
    createdOutputStyleNotes: OutputStyleNote[]
    createdSkillNotes: SkillNote[]
    createdRepositoryNotes: RepositoryNote[]
    createdSubAgentNotes: SubAgentNote[]
    createdCommandNotes: CommandNote[]
    createdConnections: Array<{
        id: string
        sourcePodId: string
        sourceAnchor: AnchorPosition
        targetPodId: string
        targetAnchor: AnchorPosition
        triggerMode?: 'auto' | 'ai-decide' | 'direct'
        decideStatus?: 'none' | 'pending' | 'approved' | 'rejected' | 'error'
        decideReason?: string | null
    }>
    podIdMapping: Record<string, string>
    errors: PasteError[]
}

export interface RepositoryCreatedPayload extends ResultPayload {
    repository?: Repository
}

export interface RepositoryGitCloneProgressPayload {
    requestId: string
    progress: number
    message: string
}

export interface RepositoryGitCloneResultPayload {
    requestId: string
    success: boolean
    repository?: { id: string; name: string }
    error?: string
}

export interface PodMessagesClearedPayload {
    podId: string
}

export interface PodAutoClearSetPayload extends ResultPayload {
    pod?: Pod
}

export interface WorkflowAutoClearedPayload {
    sourcePodId: string
    clearedPodIds: string[]
    clearedPodNames: string[]
}

export interface SubAgentCreatedPayload {
    requestId: string
    success: boolean
    subAgent?: { id: string; name: string }
    error?: string
}

export interface SubAgentUpdatedPayload {
    requestId: string
    success: boolean
    subAgent?: { id: string; name: string }
    error?: string
}

export interface SubAgentReadResultPayload {
    requestId: string
    success: boolean
    subAgent?: { id: string; name: string; content: string }
    error?: string
}

export interface CommandCreatedPayload {
    requestId: string
    success: boolean
    command?: { id: string; name: string }
    error?: string
}

export interface CommandUpdatedPayload {
    requestId: string
    success: boolean
    command?: { id: string; name: string }
    error?: string
}

export interface CommandReadResultPayload {
    requestId: string
    success: boolean
    command?: { id: string; name: string; content: string }
    error?: string
}

export interface CommandNoteCreatedPayload extends ResultPayload {
    note?: CommandNote
}

export interface ScheduleFiredPayload {
    podId: string
    timestamp: string
}

export interface HeartbeatPingPayload {
    timestamp: number
}

export interface RepositoryCheckGitResultPayload extends ResultPayload {
    isGit: boolean
}

export interface RepositoryWorktreeCreatedPayload extends ResultPayload {
    repository?: Repository
}

export interface RepositoryLocalBranchesResultPayload extends ResultPayload {
    branches?: string[]
    currentBranch?: string
    worktreeBranches?: string[]
}

export interface RepositoryDirtyCheckResultPayload extends ResultPayload {
    isDirty?: boolean
}

export interface RepositoryCheckoutBranchProgressPayload {
    requestId: string
    progress: number
    message: string
    branchName: string
}

export interface RepositoryBranchCheckedOutPayload extends ResultPayload {
    repositoryId?: string
    branchName?: string
    action?: 'switched' | 'fetched' | 'created'
}

export interface RepositoryBranchDeletedPayload extends ResultPayload {
    branchName?: string
}

export interface RepositoryPullLatestProgressPayload {
    requestId: string
    progress: number
    message: string
}

export interface RepositoryPullLatestResultPayload extends ResultPayload {
    repositoryId?: string
}

export interface GroupCreatedPayload {
    requestId: string
    success: boolean
    group?: { id: string; name: string; type: 'command' | 'outputStyle' | 'subAgent' }
    error?: string
}

export interface GroupListResultPayload {
    requestId: string
    success: boolean
    groups?: Array<{ id: string; name: string; type: 'command' | 'outputStyle' | 'subAgent' }>
    error?: string
}

export interface GroupDeletedPayload extends ResultPayload {
    groupId?: string
}

export interface MovedToGroupPayload extends ResultPayload {
    itemId?: string
    groupId?: string | null
}

export interface SkillImportedPayload {
    requestId: string
    success: boolean
    skill?: { id: string; name: string; description: string }
    isOverwrite?: boolean
    error?: string
}

export interface WorkflowAiDecidePendingPayload {
    canvasId: string
    connectionIds: string[]
    sourcePodId: string
}

export interface WorkflowAiDecideResultPayload {
    canvasId: string
    connectionId: string
    sourcePodId: string
    targetPodId: string
    shouldTrigger: boolean
    reason: string
}

export interface WorkflowAiDecideErrorPayload {
    canvasId: string
    connectionId: string
    sourcePodId: string
    targetPodId: string
    error: string
}

export interface WorkflowAiDecideClearPayload {
    canvasId: string
    connectionIds: string[]
}

export interface WorkflowAiDecideTriggeredPayload {
    canvasId: string
    connectionId: string
    sourcePodId: string
    targetPodId: string
}

export interface WorkflowDirectTriggeredPayload {
    canvasId: string
    connectionId: string
    sourcePodId: string
    targetPodId: string
    transferredContent: string
    isSummarized: boolean
}

export interface WorkflowDirectWaitingPayload {
    canvasId: string
    connectionId: string
    sourcePodId: string
    targetPodId: string
}

export interface WorkflowQueuedPayload {
    canvasId: string
    connectionId: string
    sourcePodId: string
    targetPodId: string
    position: number
    queueSize: number
    triggerMode: 'auto' | 'ai-decide' | 'direct'
}

export interface WorkflowQueueProcessedPayload {
    canvasId: string
    connectionId: string
    sourcePodId: string
    targetPodId: string
    remainingQueueSize: number
    triggerMode: 'auto' | 'ai-decide' | 'direct'
}

export interface CursorMovedPayload {
    connectionId: string
    x: number
    y: number
    color: string
}

export interface McpServerCreatedPayload {
    requestId: string
    success: boolean
    mcpServer?: { id: string; name: string }
    error?: string
}

export interface McpServerUpdatedPayload {
    requestId: string
    success: boolean
    mcpServer?: { id: string; name: string }
    error?: string
}

export interface McpServerReadResultPayload {
    requestId: string
    success: boolean
    mcpServer?: { id: string; name: string; config: McpServerConfig }
    error?: string
}

export interface CursorLeftPayload {
    connectionId: string
}

export interface PodDirectoryOpenedPayload extends ResultPayload {
    path?: string
}

export interface SlackAppCreatedPayload extends ResultPayload {
    slackApp?: SlackApp
}

export interface SlackAppDeletedPayload extends ResultPayload {
    slackAppId?: string
}

export interface SlackAppListResultPayload extends ResultPayload {
    slackApps?: SlackApp[]
}

export interface SlackAppGetResultPayload extends ResultPayload {
    slackApp?: SlackApp
}

export interface SlackAppChannelsResultPayload extends ResultPayload {
    channels?: SlackChannel[]
}

export interface SlackAppChannelsRefreshedPayload extends ResultPayload {
    channels?: SlackChannel[]
}

export interface SlackConnectionStatusChangedPayload {
    slackAppId: string
    connectionStatus: SlackAppConnectionStatus
    channels?: SlackChannel[]
}

export interface SlackMessageReceivedPayload {
    canvasId: string
    podId: string
    slackAppId: string
    channelId: string
    userName: string
    text: string
}

export interface PodSlackBoundPayload extends ResultPayload {
    canvasId: string
    pod?: Pod
}

export interface PodSlackUnboundPayload extends ResultPayload {
    canvasId: string
    pod?: Pod
}
