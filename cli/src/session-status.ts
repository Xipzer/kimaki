// Pure derivations over OpenCode session messages for `kimaki session read --json`,
// `session status` and `session recover`: message errors, session state and the
// revert target for a failed assistant turn.

import type { Message, Part } from '@opencode-ai/sdk/v2'
import { formatCompactToolSummary, truncateChars } from './markdown.js'
import { getMessageError, type SessionMessageError } from './message-error.js'

export type SessionMessage = { info: Message; parts: Part[] }

export type SessionState = 'idle' | 'working' | 'blocked' | 'errored' | 'question'

function messageText(parts: Part[]): string {
  return parts
    .flatMap((part) => (part.type === 'text' && !part.synthetic && part.text ? [part.text] : []))
    .join('\n')
    .trim()
}

function lastAssistant(messages: SessionMessage[]) {
  return messages.findLast((message) => message.info.role === 'assistant')
}

// Messages at and after an active revert point are hidden from the model and
// cleaned up by OpenCode on the next prompt.
export function visibleMessages({
  messages,
  revertMessageId,
}: {
  messages: SessionMessage[]
  revertMessageId?: string
}): SessionMessage[] {
  const revertIndex = revertMessageId
    ? messages.findIndex((message) => message.info.id === revertMessageId)
    : -1
  return revertIndex >= 0 ? messages.slice(0, revertIndex) : messages
}

// A question only blocks the session when it belongs to the newest assistant
// message. Questions left behind by an interrupted tool call stay registered
// in OpenCode while the session keeps working on later messages.
export function hasLiveQuestion({
  sessionId,
  questions,
  messages,
}: {
  sessionId: string
  questions: Array<{ sessionID: string; tool?: { messageID: string } }>
  messages: SessionMessage[]
}): boolean {
  const latestAssistantId = lastAssistant(messages)?.info.id
  return questions.some((request) => {
    if (request.sessionID !== sessionId) return false
    return !request.tool || request.tool.messageID === latestAssistantId
  })
}

export function deriveSessionState({
  messages,
  busy,
  pendingQuestion,
}: {
  messages: SessionMessage[]
  busy: boolean
  pendingQuestion: boolean
}): { state: SessionState; lastError: SessionMessageError | null } {
  const last = messages.at(-1)
  const lastAssistantMessage = lastAssistant(messages)
  const lastError = lastAssistantMessage ? getMessageError(lastAssistantMessage.info) : null
  if (busy && pendingQuestion) return { state: 'question', lastError }
  if (busy) return { state: 'working', lastError }
  const error = last ? getMessageError(last.info) : null
  if (!error || error.aborted) return { state: 'idle', lastError }
  return { state: error.blocked ? 'blocked' : 'errored', lastError }
}

export function getContextTokens(messages: SessionMessage[]): number | null {
  const message = messages.findLast((entry) => {
    return entry.info.role === 'assistant' && entry.info.tokens.input + entry.info.tokens.cache.read > 0
  })
  if (message?.info.role !== 'assistant') return null
  const { input, output, reasoning, cache } = message.info.tokens
  return input + output + reasoning + cache.read + cache.write
}

export function getLastAssistantText({
  messages,
  maxChars,
}: {
  messages: SessionMessage[]
  maxChars: number
}): string | null {
  const message = messages.findLast((entry) => {
    return entry.info.role === 'assistant' && messageText(entry.parts) !== ''
  })
  if (!message) return null
  const text = messageText(message.parts)
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text
}

export function toStructuredMessage({
  message,
  toolInputMaxChars,
}: {
  message: SessionMessage
  toolInputMaxChars: number
}) {
  const { info, parts } = message
  const tools = parts.flatMap((part) => {
    if (part.type !== 'tool' || part.tool === 'todoread') return []
    const { state } = part
    const summary = formatCompactToolSummary({
      tool: part.tool,
      input: state.input as Parameters<typeof formatCompactToolSummary>[0]['input'],
      maxChars: toolInputMaxChars,
    })
    return [{
      tool: part.tool,
      status: state.status,
      summary,
      ...(state.status === 'error' && { error: truncateChars(state.error || 'Unknown error', 300) }),
    }]
  })
  const files = parts.flatMap((part) => {
    return part.type === 'file' ? [part.filename || part.url] : []
  })
  return {
    id: info.id,
    role: info.role,
    time: {
      created: new Date(info.time.created).toISOString(),
      completed: info.role === 'assistant' && info.time.completed
        ? new Date(info.time.completed).toISOString()
        : null,
    },
    agent: info.agent,
    model: info.role === 'assistant'
      ? `${info.providerID}/${info.modelID}`
      : `${info.model.providerID}/${info.model.modelID}`,
    text: messageText(parts),
    tools,
    ...(files.length > 0 && { files }),
    error: getMessageError(info),
  }
}

export function selectMessages({
  messages,
  last,
  since,
}: {
  messages: SessionMessage[]
  last?: number
  since?: string
}): SessionMessage[] | Error {
  const sinceIndex = since ? messages.findIndex((message) => message.info.id === since) : -1
  if (since && sinceIndex < 0) {
    return new Error(`Message ${since} not found in session. Run without --since to list message ids.`)
  }
  const afterSince = messages.slice(sinceIndex + 1)
  return last && last > 0 ? afterSince.slice(-last) : afterSince
}

export type RecoverPlan =
  | { kind: 'healthy'; reason: string }
  | { kind: 'unrecoverable'; reason: string }
  | {
      kind: 'recover'
      // Messages from this id onward are reverted (OpenCode session.revert).
      revertMessageId: string
      // true: the whole failed turn is reverted and the user prompt is replayed.
      // false: earlier successful steps of the turn are kept and only the
      // failed steps are reverted, so the prompt asks the agent to continue.
      replay: boolean
      prompt: string
      error: SessionMessageError
      failedMessageIds: string[]
      agent: string
      model: string
    }

export const RECOVER_CONTINUE_PROMPT = 'Continue where you left off.'

export function selectRecoverTarget({
  messages,
  revertMessageId,
  prompt,
}: {
  messages: SessionMessage[]
  revertMessageId?: string
  prompt?: string
}): RecoverPlan {
  const visible = visibleMessages({ messages, revertMessageId })
  const last = visible.at(-1)
  if (!last) return { kind: 'healthy', reason: 'session has no messages' }
  if (last.info.role !== 'assistant') {
    return { kind: 'healthy', reason: 'last message is a user message, nothing failed' }
  }
  const error = getMessageError(last.info)
  if (!error) return { kind: 'healthy', reason: 'last assistant message completed without error' }
  if (error.aborted) return { kind: 'healthy', reason: 'last assistant message was aborted, not failed' }

  const parentId = last.info.parentID
  const failedStart = (() => {
    let index = visible.length - 1
    while (index > 0) {
      const previous = visible[index - 1]!.info
      const previousError = getMessageError(previous)
      if (previous.role !== 'assistant' || previous.parentID !== parentId) break
      if (!previousError || previousError.aborted) break
      index--
    }
    return index
  })()
  const failed = visible.slice(failedStart)
  const before = visible[failedStart - 1]
  const firstFailed = failed[0]!
  const base = {
    error,
    failedMessageIds: failed.map((message) => message.info.id),
    agent: last.info.agent,
    model: `${last.info.providerID}/${last.info.modelID}`,
  }

  if (before?.info.role === 'user' && before.info.id === parentId) {
    const userPrompt = prompt || messageText(before.parts)
    if (!userPrompt) {
      return { kind: 'unrecoverable', reason: 'the failed user prompt has no text to replay. Pass --prompt "..."' }
    }
    return { kind: 'recover', revertMessageId: before.info.id, replay: true, prompt: userPrompt, ...base }
  }

  return {
    kind: 'recover',
    revertMessageId: firstFailed.info.id,
    replay: false,
    prompt: prompt || RECOVER_CONTINUE_PROMPT,
    ...base,
  }
}
