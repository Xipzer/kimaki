import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { localWhisperFromEnv, transcribeViaLocalWhisper } from './local-whisper.ts'

describe('localWhisperFromEnv', () => {
  test('unset means no Local Whisper', () => {
    expect(localWhisperFromEnv({})).toBeUndefined()
    expect(localWhisperFromEnv({ KIMAKI_WHISPER_URL: '  ' })).toBeUndefined()
  })

  test('local only by default, with the standard model name', () => {
    expect(localWhisperFromEnv({ KIMAKI_WHISPER_URL: 'http://127.0.0.1:8000/v1/' })).toEqual({
      url: 'http://127.0.0.1:8000/v1',
      model: 'whisper-1',
      fallback: false,
    })
  })

  test('accepts the full endpoint URL, a model, a key and cloud fallback', () => {
    expect(
      localWhisperFromEnv({
        KIMAKI_WHISPER_URL: 'http://gpu.local:8000/v1/audio/transcriptions',
        KIMAKI_WHISPER_MODEL: 'Systran/faster-whisper-large-v3',
        KIMAKI_WHISPER_API_KEY: 'secret',
        KIMAKI_WHISPER_FALLBACK: 'true',
      }),
    ).toEqual({ url: 'http://gpu.local:8000/v1', model: 'Systran/faster-whisper-large-v3', apiKey: 'secret', fallback: true })
  })
})

describe('transcribeViaLocalWhisper', () => {
  const received: Array<{ path: string; authorization: string | null; model: unknown; format: unknown; filename: string; type: string; size: number }> = []
  let reply: { status: number; body: string } = { status: 200, body: JSON.stringify({ text: ' hello world ' }) }
  let server: http.Server
  let url: string

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', async () => {
        const headers = new Headers(Object.entries(request.headers).flatMap(([key, value]) => (typeof value === 'string' ? [[key, value]] : [])))
        const form = await new Request('http://fake/', { method: 'POST', headers, body: Buffer.concat(chunks) }).formData()
        const file = form.get('file') as File
        received.push({
          path: request.url ?? '',
          authorization: headers.get('authorization'),
          model: form.get('model'),
          format: form.get('response_format'),
          filename: file.name,
          type: file.type,
          size: file.size,
        })
        response.statusCode = reply.status
        response.end(reply.body)
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  })

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

  test('posts the raw audio as multipart and steers the text into the thread', async () => {
    const result = await transcribeViaLocalWhisper({ whisper: { url, model: 'whisper-1', fallback: false }, audio: Buffer.from('OggS-bytes'), mediaType: 'audio/ogg' })
    expect(result).toEqual({ transcription: 'hello world', route: 'steer', agent: null })
    expect(received.at(-1)).toEqual({ path: '/v1/audio/transcriptions', authorization: null, model: 'whisper-1', format: 'json', filename: 'voice.ogg', type: 'audio/ogg', size: 10 })
  })

  test('sends the optional key as a bearer token', async () => {
    await transcribeViaLocalWhisper({ whisper: { url, model: 'm', apiKey: 'k', fallback: false }, audio: Buffer.from('x'), mediaType: 'audio/mpeg' })
    expect(received.at(-1)).toMatchObject({ authorization: 'Bearer k', model: 'm', filename: 'voice.mp3' })
  })

  test('server errors, bodies without text and unreachable servers are errors', async () => {
    reply = { status: 503, body: 'model loading' }
    const failed = await transcribeViaLocalWhisper({ whisper: { url, model: 'm', fallback: false }, audio: Buffer.from('x'), mediaType: 'audio/ogg' })
    expect(failed).toBeInstanceOf(Error)
    expect((failed as Error).message).toBe('Transcription API returned 503: model loading')

    reply = { status: 200, body: '{"error":"nope"}' }
    const empty = await transcribeViaLocalWhisper({ whisper: { url, model: 'm', fallback: false }, audio: Buffer.from('x'), mediaType: 'audio/ogg' })
    expect((empty as Error).message).toContain('returned no text')

    const down = await transcribeViaLocalWhisper({ whisper: { url: 'http://127.0.0.1:1/v1', model: 'm', fallback: false }, audio: Buffer.from('x'), mediaType: 'audio/ogg' })
    expect((down as Error).message).toBe('Transcription failed: Local Whisper at http://127.0.0.1:1/v1 not reachable')
  })
})
