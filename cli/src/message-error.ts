// Classifies the error carried on an OpenCode assistant message. `blocked`
// means a provider content/safety filter refused the turn, so a plain retry of
// the same context will not help.

import type { Message } from '@opencode-ai/sdk/v2'

export type SessionMessageError = {
  name: string
  message: string
  blocked: boolean
  aborted: boolean
}

const BLOCKED_ERROR_PATTERN =
  /content[ _-]?(filter|policy|management)|safety (system|filter|settings)|responsible ai|flagged by|violat\w* (our|the) (usage|content) polic/i

export function getMessageError(info: Message): SessionMessageError | null {
  if (info.role !== 'assistant' || !info.error) return null
  const data: { message?: unknown } = info.error.data
  const message = typeof data.message === 'string' ? data.message : ''
  const name = info.error.name
  return {
    name,
    message,
    blocked: name === 'ContentFilterError' || BLOCKED_ERROR_PATTERN.test(message),
    aborted: name === 'MessageAbortedError',
  }
}
