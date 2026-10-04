// Tests for how explicit prompt agent/model flags affect the stored session model.

import { describe, expect, test } from 'vitest'
import { resolvePromptModelPreference } from './session-model-preference.js'

const pinned = { modelId: 'anthropic/claude-opus-4-6', variant: null, locked: false }
const locked = { ...pinned, locked: true }

describe('resolvePromptModelPreference', () => {
  test('same agent on a follow-up keeps the session model', () => {
    expect(resolvePromptModelPreference({
      requestedAgent: 'build',
      currentAgent: 'build',
      sessionModel: pinned,
    })).toMatchInlineSnapshot(`
      {
        "clearModel": false,
        "ignoredModel": null,
        "model": undefined,
        "setAgent": false,
      }
    `)
  })

  test('switching agent clears an unlocked session model', () => {
    const decision = resolvePromptModelPreference({
      requestedAgent: 'plan',
      currentAgent: 'build',
      sessionModel: pinned,
    })
    expect(decision.setAgent).toBe(true)
    expect(decision.clearModel).toBe(true)
  })

  test('switching agent keeps a locked session model', () => {
    const decision = resolvePromptModelPreference({
      requestedAgent: 'plan',
      currentAgent: 'build',
      sessionModel: locked,
    })
    expect(decision.setAgent).toBe(true)
    expect(decision.clearModel).toBe(false)
  })

  test('first agent preference does not clear a model picked earlier', () => {
    const decision = resolvePromptModelPreference({
      requestedAgent: 'build',
      sessionModel: pinned,
    })
    expect(decision).toMatchObject({ setAgent: true, clearModel: false })
  })

  test('locked session ignores a different per-prompt model', () => {
    expect(resolvePromptModelPreference({
      requestedModel: 'openai/gpt-5',
      sessionModel: locked,
    })).toMatchInlineSnapshot(`
      {
        "clearModel": false,
        "ignoredModel": "openai/gpt-5",
        "model": undefined,
        "setAgent": false,
      }
    `)
  })

  test('locked session accepts the same model and unlocked accepts any', () => {
    expect(resolvePromptModelPreference({
      requestedModel: locked.modelId,
      sessionModel: locked,
    }).model).toBe(locked.modelId)
    expect(resolvePromptModelPreference({
      requestedModel: 'openai/gpt-5',
      sessionModel: pinned,
    }).model).toBe('openai/gpt-5')
  })
})
