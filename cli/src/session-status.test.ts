// Tests for session state derivation, structured messages and recover target selection.

import { describe, expect, test } from 'vitest'
import type { AssistantMessage, Part } from '@opencode-ai/sdk/v2'
import {
  deriveSessionState,
  getContextTokens,
  getLastAssistantText,
  hasLiveQuestion,
  RECOVER_CONTINUE_PROMPT,
  selectMessages,
  selectRecoverTarget,
  toStructuredMessage,
  type SessionMessage,
} from './session-status.js'

const sessionID = 'ses_test'

function textPart(messageID: string, text: string, synthetic?: boolean): Part {
  return { id: `${messageID}_text`, sessionID, messageID, type: 'text', text, ...(synthetic && { synthetic }) }
}

function user(id: string, text: string): SessionMessage {
  return {
    info: {
      id,
      sessionID,
      role: 'user',
      time: { created: 1_700_000_000_000 },
      agent: 'build',
      model: { providerID: 'anthropic', modelID: 'claude-opus-4-6' },
    },
    parts: [textPart(id, 'kimaki context', true), textPart(id, text)],
  }
}

function assistant(
  id: string,
  parentID: string,
  { text, error, tool }: { text?: string; error?: AssistantMessage['error']; tool?: boolean } = {},
): SessionMessage {
  const parts: Part[] = []
  if (tool) {
    parts.push({
      id: `${id}_tool`,
      sessionID,
      messageID: id,
      type: 'tool',
      callID: 'call_1',
      tool: 'bash',
      state: {
        status: 'error',
        input: { command: 'pnpm test' },
        error: 'exit code 1',
        time: { start: 1, end: 2 },
      },
    })
  }
  if (text) parts.push(textPart(id, text))
  return {
    info: {
      id,
      sessionID,
      role: 'assistant',
      time: { created: 1_700_000_001_000, completed: 1_700_000_002_000 },
      parentID,
      modelID: 'claude-opus-4-6',
      providerID: 'anthropic',
      mode: 'build',
      agent: 'build',
      path: { cwd: '/repo', root: '/repo' },
      cost: 0,
      tokens: { input: 1000, output: 200, reasoning: 0, cache: { read: 5000, write: 0 } },
      ...(error && { error }),
    },
    parts,
  }
}

const contentFilter: AssistantMessage['error'] = {
  name: 'ContentFilterError',
  data: { message: 'The response was blocked by the provider content filter' },
}
const apiError: AssistantMessage['error'] = {
  name: 'APIError',
  data: { message: 'Overloaded', statusCode: 529, isRetryable: true },
}
const aborted: AssistantMessage['error'] = {
  name: 'MessageAbortedError',
  data: { message: 'aborted' },
}

describe('deriveSessionState', () => {
  test('maps live status and the last message error to a state', () => {
    const ok = [user('msg_1', 'hi'), assistant('msg_2', 'msg_1', { text: 'done' })]
    const blocked = [user('msg_1', 'hi'), assistant('msg_2', 'msg_1', { error: contentFilter })]
    const errored = [user('msg_1', 'hi'), assistant('msg_2', 'msg_1', { error: apiError })]
    const abortedRun = [user('msg_1', 'hi'), assistant('msg_2', 'msg_1', { error: aborted })]
    const resolved = [...blocked, user('msg_3', 'again')]
    const states = {
      idle: deriveSessionState({ messages: ok, busy: false, pendingQuestion: false }).state,
      working: deriveSessionState({ messages: blocked, busy: true, pendingQuestion: false }).state,
      question: deriveSessionState({ messages: ok, busy: true, pendingQuestion: true }).state,
      orphanQuestion: deriveSessionState({ messages: ok, busy: false, pendingQuestion: true }).state,
      blocked: deriveSessionState({ messages: blocked, busy: false, pendingQuestion: false }).state,
      errored: deriveSessionState({ messages: errored, busy: false, pendingQuestion: false }).state,
      aborted: deriveSessionState({ messages: abortedRun, busy: false, pendingQuestion: false }).state,
      newerUserMessage: deriveSessionState({ messages: resolved, busy: false, pendingQuestion: false }).state,
      empty: deriveSessionState({ messages: [], busy: false, pendingQuestion: false }).state,
    }
    expect(states).toMatchInlineSnapshot(`
      {
        "aborted": "idle",
        "blocked": "blocked",
        "empty": "idle",
        "errored": "errored",
        "idle": "idle",
        "newerUserMessage": "idle",
        "orphanQuestion": "idle",
        "question": "question",
        "working": "working",
      }
    `)
  })

  test('reports lastError with blocked classification', () => {
    const messages = [user('msg_1', 'hi'), assistant('msg_2', 'msg_1', { error: contentFilter })]
    expect(deriveSessionState({ messages, busy: false, pendingQuestion: false }).lastError).toMatchInlineSnapshot(`
      {
        "aborted": false,
        "blocked": true,
        "message": "The response was blocked by the provider content filter",
        "name": "ContentFilterError",
      }
    `)
  })

  test('APIError mentioning a content policy counts as blocked', () => {
    const policy: AssistantMessage['error'] = {
      name: 'APIError',
      data: { message: 'Output blocked by content filtering policy', isRetryable: false },
    }
    const messages = [user('msg_1', 'hi'), assistant('msg_2', 'msg_1', { error: policy })]
    expect(deriveSessionState({ messages, busy: false, pendingQuestion: false }).state).toBe('blocked')
  })
})

describe('session status helpers', () => {
  test('context tokens, last reply text and structured message', () => {
    const messages = [
      user('msg_1', 'run the tests'),
      assistant('msg_2', 'msg_1', { text: 'Running them now', tool: true }),
      assistant('msg_3', 'msg_1', { error: apiError }),
    ]
    expect(getContextTokens(messages)).toBe(6200)
    expect(getLastAssistantText({ messages, maxChars: 8 })).toBe('Running…')
    expect(toStructuredMessage({ message: messages[1]!, toolInputMaxChars: 80 })).toMatchInlineSnapshot(`
      {
        "agent": "build",
        "error": null,
        "id": "msg_2",
        "model": "anthropic/claude-opus-4-6",
        "role": "assistant",
        "text": "Running them now",
        "time": {
          "completed": "2023-11-14T22:13:22.000Z",
          "created": "2023-11-14T22:13:21.000Z",
        },
        "tools": [
          {
            "error": "exit code 1",
            "status": "error",
            "summary": "pnpm test",
            "tool": "bash",
          },
        ],
      }
    `)
    expect(toStructuredMessage({ message: messages[0]!, toolInputMaxChars: 80 }).text).toBe('run the tests')
  })

  test('selectMessages applies --since then --last', () => {
    const messages = ['msg_1', 'msg_2', 'msg_3', 'msg_4'].map((id) => user(id, id))
    const ids = (result: SessionMessage[] | Error) => {
      return result instanceof Error ? result.message : result.map((message) => message.info.id)
    }
    expect(ids(selectMessages({ messages, last: 2 }))).toEqual(['msg_3', 'msg_4'])
    expect(ids(selectMessages({ messages, since: 'msg_2' }))).toEqual(['msg_3', 'msg_4'])
    expect(ids(selectMessages({ messages, since: 'msg_1', last: 1 }))).toEqual(['msg_4'])
    expect(selectMessages({ messages, since: 'msg_9' })).toBeInstanceOf(Error)
  })
})

describe('selectRecoverTarget', () => {
  test('healthy sessions need nothing', () => {
    const kinds = [
      [],
      [user('msg_1', 'hi')],
      [user('msg_1', 'hi'), assistant('msg_2', 'msg_1', { text: 'ok' })],
      [user('msg_1', 'hi'), assistant('msg_2', 'msg_1', { error: aborted })],
    ].map((messages) => selectRecoverTarget({ messages }).kind)
    expect(kinds).toEqual(['healthy', 'healthy', 'healthy', 'healthy'])
  })

  test('a fully failed turn reverts the user message and replays its text', () => {
    const messages = [
      user('msg_1', 'first'),
      assistant('msg_2', 'msg_1', { text: 'ok' }),
      user('msg_3', 'write the exploit test'),
      assistant('msg_4', 'msg_3', { error: contentFilter }),
    ]
    expect(selectRecoverTarget({ messages })).toMatchInlineSnapshot(`
      {
        "agent": "build",
        "error": {
          "aborted": false,
          "blocked": true,
          "message": "The response was blocked by the provider content filter",
          "name": "ContentFilterError",
        },
        "failedMessageIds": [
          "msg_4",
        ],
        "kind": "recover",
        "model": "anthropic/claude-opus-4-6",
        "prompt": "write the exploit test",
        "replay": true,
        "revertMessageId": "msg_3",
      }
    `)
  })

  test('never reverts past a successful step of the same turn', () => {
    const messages = [
      user('msg_1', 'refactor the module'),
      assistant('msg_2', 'msg_1', { text: 'step one done', tool: true }),
      assistant('msg_3', 'msg_1', { error: apiError }),
      assistant('msg_4', 'msg_1', { error: contentFilter }),
    ]
    const plan = selectRecoverTarget({ messages })
    expect(plan).toMatchObject({
      kind: 'recover',
      revertMessageId: 'msg_3',
      replay: false,
      prompt: RECOVER_CONTINUE_PROMPT,
      failedMessageIds: ['msg_3', 'msg_4'],
    })
  })

  test('--prompt overrides the replayed prompt', () => {
    const messages = [user('msg_1', 'original'), assistant('msg_2', 'msg_1', { error: apiError })]
    expect(selectRecoverTarget({ messages, prompt: 'try again, shorter' })).toMatchObject({
      kind: 'recover',
      revertMessageId: 'msg_1',
      prompt: 'try again, shorter',
    })
  })

  test('ignores messages already hidden by an active revert', () => {
    const messages = [
      user('msg_1', 'hi'),
      assistant('msg_2', 'msg_1', { text: 'ok' }),
      user('msg_3', 'again'),
      assistant('msg_4', 'msg_3', { error: contentFilter }),
    ]
    expect(selectRecoverTarget({ messages, revertMessageId: 'msg_3' }).kind).toBe('healthy')
  })

  test('a failed turn without prompt text is unrecoverable without --prompt', () => {
    const imageOnly: SessionMessage = { ...user('msg_1', ''), parts: [] }
    const messages = [imageOnly, assistant('msg_2', 'msg_1', { error: apiError })]
    expect(selectRecoverTarget({ messages }).kind).toBe('unrecoverable')
    expect(selectRecoverTarget({ messages, prompt: 'describe the image' }).kind).toBe('recover')
  })
})

describe('hasLiveQuestion', () => {
  const messages = [user('msg_u1', 'go'), assistant('msg_a1', 'msg_u1', { tool: true }), user('msg_u2', 'next'), assistant('msg_a2', 'msg_u2', { text: 'working' })]
  test('ignores a question left behind by an earlier assistant message', () => {
    expect(hasLiveQuestion({ sessionId: sessionID, messages, questions: [{ sessionID, tool: { messageID: 'msg_a1' } }] })).toBe(false)
  })
  test('counts a question from the latest assistant message', () => {
    expect(hasLiveQuestion({ sessionId: sessionID, messages, questions: [{ sessionID, tool: { messageID: 'msg_a2' } }] })).toBe(true)
  })
  test('counts a question without tool info and ignores other sessions', () => {
    expect(hasLiveQuestion({ sessionId: sessionID, messages, questions: [{ sessionID }] })).toBe(true)
    expect(hasLiveQuestion({ sessionId: sessionID, messages, questions: [{ sessionID: 'ses_other' }] })).toBe(false)
  })
})
