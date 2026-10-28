// Fork: Local Whisper transcriber. Voice notes go to any server that speaks the
// standard OpenAI speech-to-text API (speaches, faster-whisper-server,
// whisper.cpp server, LocalAI):
//
//   voice note ─▶ POST <KIMAKI_WHISPER_URL>/audio/transcriptions (multipart file + model)
//              ─▶ { text } ─▶ route steer (plain Whisper cannot pick a route or agent)
//
// No API key needed. Local only by default: when the server fails the voice
// note shows the error instead of quietly going to a cloud provider.
// KIMAKI_WHISPER_FALLBACK=1 lets the cloud transcribers run after it.

import * as errore from 'errore'

import { TranscriptionApiError, TranscriptionError, toTranscriptionResult } from './voice.ts'

export type LocalWhisper = {
  // Base URL including the API version, e.g. http://127.0.0.1:8000/v1.
  url: string
  model: string
  apiKey?: string
  // false: the only transcriber. true: tried first, then the cloud ones.
  fallback: boolean
}

const DEFAULT_MODEL = 'whisper-1'
const EXTENSIONS: Record<string, string> = { 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' }

export function localWhisperFromEnv(env: NodeJS.ProcessEnv = process.env): LocalWhisper | undefined {
  const url = env['KIMAKI_WHISPER_URL']?.trim().replace(/\/+$/, '').replace(/\/audio\/transcriptions$/, '')
  if (!url) return undefined
  const apiKey = env['KIMAKI_WHISPER_API_KEY']?.trim()
  return {
    url,
    model: env['KIMAKI_WHISPER_MODEL']?.trim() || DEFAULT_MODEL,
    ...(apiKey && { apiKey }),
    fallback: /^(1|true|yes)$/i.test(env['KIMAKI_WHISPER_FALLBACK']?.trim() ?? ''),
  }
}

export async function transcribeViaLocalWhisper({ whisper, audio, mediaType }: {
  whisper: LocalWhisper
  audio: Buffer
  mediaType: string
}): Promise<TranscriptionError | TranscriptionApiError | ReturnType<typeof toTranscriptionResult>> {
  const form = new FormData()
  form.append('file', new File([new Uint8Array(audio)], `voice.${EXTENSIONS[mediaType] ?? 'ogg'}`, { type: mediaType }))
  form.append('model', whisper.model)
  form.append('response_format', 'json')
  const response = await fetch(`${whisper.url}/audio/transcriptions`, {
    method: 'POST',
    headers: whisper.apiKey ? { authorization: `Bearer ${whisper.apiKey}` } : {},
    body: form,
  }).catch((cause) => new TranscriptionError({ reason: `Local Whisper at ${whisper.url} not reachable`, cause }))
  if (response instanceof Error) return response
  const body = await response.text().catch(() => '')
  if (!response.ok) return new TranscriptionApiError({ status: String(response.status), body: body.slice(0, 300) })
  const parsed = errore.try(() => JSON.parse(body) as unknown, () => null)
  const text = parsed && typeof parsed === 'object' && 'text' in parsed ? parsed.text : null
  if (typeof text !== 'string') return new TranscriptionError({ reason: `Local Whisper at ${whisper.url} returned no text: ${body.slice(0, 200)}` })
  return toTranscriptionResult({ transcription: text })
}
