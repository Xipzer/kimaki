// Fork: reply `retranscribe` to a voice message to handle it again.
//
// Upstream retries a failed transcription and puts a Retry button on the error
// reply (ingress.ts, voice_retry). A voice message sent while the bot was not
// running gets no reply at all, so there is nothing to click. Replying the word
// covers that case and any older voice message:
//
//   voice message (sent while the bot was down)
//     ↳ "retranscribe"   ─▶ the replied voice message is handled again, as if it had just arrived
//
// The word is never sent to the agent. A reply to a message without audio stays text.

import type { Message } from 'discord.js'

import { isVoiceAttachment } from './voice.ts'

const RETRANSCRIBE = /^\s*retranscribe\s*$/i

// The voice message a `retranscribe` reply points at, else null.
export async function retranscribeTarget(message: Message): Promise<Message | null> {
  if (!message.reference?.messageId || message.attachments.size > 0 || !RETRANSCRIBE.test(message.content)) return null
  const replied = await message.fetchReference().catch(() => null)
  if (!replied) return null
  const voice = replied.attachments.some((attachment) =>
    isVoiceAttachment({ contentType: attachment.contentType, name: attachment.name, duration: attachment.duration, waveform: attachment.waveform, width: attachment.width, height: attachment.height }),
  )
  return voice ? replied : null
}
