import { describe, expect, test } from 'vitest'
import { transcriptionBaseUrlsFromEnv } from './voice-env.ts'

describe('transcriptionBaseUrlsFromEnv', () => {
  test('reads OpenAI and Gemini base URLs without trailing slashes', () => {
    expect(transcriptionBaseUrlsFromEnv({ OPENAI_BASE_URL: 'http://127.0.0.1:7070/v1/', GEMINI_BASE_URL: 'http://g.local/v1beta' })).toEqual({
      openai: 'http://127.0.0.1:7070/v1',
      gemini: 'http://g.local/v1beta',
    })
  })

  test('empty or missing values keep the official endpoints', () => {
    expect(transcriptionBaseUrlsFromEnv({ OPENAI_BASE_URL: '  ' })).toEqual({})
    expect(transcriptionBaseUrlsFromEnv({})).toEqual({})
  })
})
