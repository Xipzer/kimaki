// Fork: voice transcription and `kimaki tts` honour OPENAI_BASE_URL and
// GEMINI_BASE_URL, so an OpenAI-compatible local server (for example a local
// Whisper proxy) handles voice notes instead of api.openai.com.

import type { TranscriptionBaseUrls } from './voice.ts'

const trimSlash = (url: string) => url.replace(/\/+$/, '')

export function transcriptionBaseUrlsFromEnv(env: NodeJS.ProcessEnv = process.env): TranscriptionBaseUrls {
  const openai = env['OPENAI_BASE_URL']?.trim()
  const gemini = env['GEMINI_BASE_URL']?.trim()
  return {
    ...(openai && { openai: trimSlash(openai) }),
    ...(gemini && { gemini: trimSlash(gemini) }),
  }
}
